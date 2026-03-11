import { describe, it, expect } from 'vitest';
import { PPEEngine, computeRuleChecksum } from '@run-iq/core';
import type { Rule } from '@run-iq/core';
import { FiscalPlugin } from '../../src/FiscalPlugin.js';
import { JsonLogicEvaluator } from '@run-iq/dsl-jsonlogic';

function createRule(
  id: string,
  model: string,
  params: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Rule {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { checksum: _discarded, ...cleanExtra } = extra;
  const ruleWithoutChecksum = {
    id,
    model,
    version: 1,
    params,
    priority: (cleanExtra['priority'] as number) ?? 100,
    effectiveFrom: new Date('2025-01-01'),
    effectiveUntil: null,
    tags: [],
    country: 'TG',
    ...cleanExtra,
  };
  const checksum = computeRuleChecksum(ruleWithoutChecksum);
  return {
    ...ruleWithoutChecksum,
    checksum,
  } as unknown as Rule;
}

describe('Complex Combined Scenario: Multi-Jurisdiction Full Tax Simulation', () => {
  const engine = new PPEEngine({
    plugins: [new FiscalPlugin()],
    dsls: [new JsonLogicEvaluator()],
    onChecksumMismatch: 'throw',
    strict: false,
    dryRun: true,
    onConflict: 'first',
  });

  /**
   * Scenario: Togolese business with:
   *   - TVA 18% on revenue (NATIONAL, GLOBAL)
   *   - IRPP progressive on salary (NATIONAL, GLOBAL)
   *   - IS 27% with min 500k on profit (NATIONAL, GLOBAL)
   *   - Municipal business license 50k XOF (MUNICIPAL, GLOBAL)
   *   - META: inhibit municipal tax if revenue < 10M (should NOT trigger)
   *   - CNSS composite (employee + employer)
   *   - Threshold tax on revenue above 50M at 2%
   *   - Training tax 1% on gross salary
   */
  const rules = [
    // 1. TVA 18% — NATIONAL priority 3000
    createRule(
      'tva-tg',
      'FLAT_RATE',
      { base: 'revenue', rate: 0.18 },
      { priority: 3000, category: 'TVA' },
    ),

    // 2. IRPP progressive brackets
    createRule(
      'irpp-tg',
      'PROGRESSIVE_BRACKET',
      {
        base: 'net_taxable_income',
        brackets: [
          { from: 0, to: 900000, rate: 0 },
          { from: 900000, to: 1800000, rate: 0.1 },
          { from: 1800000, to: 3600000, rate: 0.15 },
          { from: 3600000, to: null, rate: 0.35 },
        ],
      },
      { priority: 3000, category: 'IRPP' },
    ),

    // 3. IS 27% with minimum 500k
    createRule(
      'is-tg',
      'MINIMUM_TAX',
      { base: 'taxable_profit', rate: 0.27, minimum: 500000 },
      { priority: 3000, category: 'IS' },
    ),

    // 4. Municipal business license — MUNICIPAL priority 1000
    createRule(
      'license-municipal',
      'FIXED_AMOUNT',
      { amount: 50000, currency: 'XOF' },
      { priority: 1000, category: 'LICENSE' },
    ),

    // 5. META: inhibit municipal tax if revenue < 10M (should NOT trigger here)
    createRule(
      'meta-small-biz',
      'META_INHIBITION',
      { targetCategories: ['LICENSE'] },
      {
        priority: 9000,
        category: 'META',
        condition: { dsl: 'jsonlogic', value: { '<': [{ var: 'revenue' }, 10000000] } },
      },
    ),

    // 6. CNSS composite (employee 3.6% + employer 17.5%)
    createRule(
      'cnss-tg',
      'COMPOSITE',
      {
        aggregation: 'SUM',
        steps: [
          { label: 'employee', model: 'FLAT_RATE', params: { base: 'gross_salary', rate: 0.036 } },
          { label: 'employer', model: 'FLAT_RATE', params: { base: 'gross_salary', rate: 0.175 } },
        ],
      },
      { priority: 3000, category: 'CNSS' },
    ),

    // 7. Threshold tax: 2% on revenue above 50M
    createRule(
      'threshold-tg',
      'THRESHOLD_BASED',
      { base: 'revenue', threshold: 50000000, rate: 0.02, above_only: true },
      { priority: 2000, category: 'THRESHOLD_TAX' },
    ),

    // 8. Training tax 1% on gross salary
    createRule(
      'training-tax',
      'FLAT_RATE',
      { base: 'gross_salary', rate: 0.01 },
      { priority: 2000, category: 'TRAINING' },
    ),
  ];

  const input = {
    requestId: 'combined-scenario-001',
    data: {
      revenue: 80000000, // 80M XOF
      taxable_profit: 15000000, // 15M XOF
      net_taxable_income: 2500000, // 2.5M XOF
      gross_salary: 30000000, // 30M XOF
    },
    meta: {
      tenantId: 'togo-enterprise',
      context: { country: 'TG' },
    },
  };

  it('applies all 8 rules across multiple jurisdictions with correct totals', async () => {
    const result = await engine.evaluate(rules, input);

    // META rule should NOT fire (revenue 80M > 10M threshold)
    expect(result.appliedRules.some((r) => r.id === 'meta-small-biz')).toBe(false);

    // All 7 non-meta rules should be applied
    expect(result.appliedRules).toHaveLength(7);

    // Verify individual contributions
    // 1. TVA: 80M * 18% = 14,400,000
    const tva = result.breakdown.find((b) => b.ruleId === 'tva-tg');
    expect(tva?.contribution).toBe(14400000);

    // 2. IRPP: 0-900k(0) + 900k-1800k(90k) + 1800k-2500k(105k) = 195,000
    const irpp = result.breakdown.find((b) => b.ruleId === 'irpp-tg');
    expect(irpp?.contribution).toBe(195000);

    // 3. IS: 15M * 27% = 4,050,000 > 500k minimum
    const is = result.breakdown.find((b) => b.ruleId === 'is-tg');
    expect(is?.contribution).toBe(4050000);

    // 4. Municipal license: fixed 50,000
    const license = result.breakdown.find((b) => b.ruleId === 'license-municipal');
    expect(license?.contribution).toBe(50000);

    // 5. CNSS: 30M * (3.6% + 17.5%) = 30M * 21.1% = 6,330,000
    const cnss = result.breakdown.find((b) => b.ruleId === 'cnss-tg');
    expect(cnss?.contribution).toBe(6330000);

    // 6. Threshold: (80M - 50M) * 2% = 600,000
    const threshold = result.breakdown.find((b) => b.ruleId === 'threshold-tg');
    expect(threshold?.contribution).toBe(600000);

    // 7. Training: 30M * 1% = 300,000
    const training = result.breakdown.find((b) => b.ruleId === 'training-tax');
    expect(training?.contribution).toBe(300000);

    // TOTAL: 14,400,000 + 195,000 + 4,050,000 + 50,000 + 6,330,000 + 600,000 + 300,000
    //      = 25,925,000
    expect(result.value).toBe(25925000);
  });

  it('fiscal breakdown groups by category correctly', async () => {
    const result = await engine.evaluate(rules, {
      ...input,
      requestId: 'combined-scenario-002',
    });

    const breakdown = result.meta?.fiscalBreakdown as Record<string, number>;
    expect(breakdown).toBeDefined();
    expect(breakdown['TVA']).toBe(14400000);
    expect(breakdown['IRPP']).toBe(195000);
    expect(breakdown['IS']).toBe(4050000);
    expect(breakdown['LICENSE']).toBe(50000);
    expect(breakdown['CNSS']).toBe(6330000);
    expect(breakdown['THRESHOLD_TAX']).toBe(600000);
    expect(breakdown['TRAINING']).toBe(300000);
  });

  it('determinism: same scenario x3 = same result', async () => {
    const results = await Promise.all(
      Array.from({ length: 3 }, (_, i) =>
        engine.evaluate(rules, {
          ...input,
          requestId: `combined-determinism-${i}`,
        }),
      ),
    );

    for (let i = 1; i < results.length; i++) {
      expect(results[i]!.value).toBe(results[0]!.value);
    }
    expect(results[0]!.value).toBe(25925000);
  });
});
