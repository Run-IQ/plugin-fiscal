import { describe, it, expect } from 'vitest';
import { PPEEngine, computeRuleChecksum } from '@run-iq/core';
import type { Rule } from '@run-iq/core';
import { FiscalPlugin } from '../../src/FiscalPlugin.js';
import { JsonLogicEvaluator } from '@run-iq/dsl-jsonlogic';

// Helper to generate valid rules on the fly
function createRule(
  id: string,
  model: string,
  params: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Rule {
  const priority = (extra.priority as number) ?? 100;
  const condition = extra.condition;
  const ruleWithoutChecksum = {
    id,
    model,
    version: 1,
    params,
    priority,
    effectiveFrom: new Date('2025-01-01'),
    effectiveUntil: null,
    tags: [],
    country: 'TG',
    ...extra,
  };
  const checksum = computeRuleChecksum({
    model: ruleWithoutChecksum.model,
    params: ruleWithoutChecksum.params,
    condition,
    priority: ruleWithoutChecksum.priority as number,
  });
  return {
    ...ruleWithoutChecksum,
    checksum,
  } as unknown as Rule;
}

describe('THE FINAL BOSS: Gigafactory Togo Simulation', () => {
  const engine = new PPEEngine({
    plugins: [new FiscalPlugin()],
    dsls: [new JsonLogicEvaluator()],
    onChecksumMismatch: 'throw', // Strict security for the boss
    strict: false,
    dryRun: true,
  });

  const rules = [
    // 1. META: Startup Exemption (Short-Circuit)
    // Should NOT trigger because revenue is high
    createRule(
      'meta-startup',
      'META_SHORT_CIRCUIT',
      { value: 0, reason: 'Startup Exemption' },
      {
        priority: 9999,
        category: 'META',
        condition: { dsl: 'jsonlogic', value: { '<': [{ var: 'revenue' }, 1000000] } },
      },
    ),

    // 2. META: Zone Franche (Inhibition)
    // Inhibits standard TVA and IS
    createRule(
      'meta-zf',
      'META_INHIBITION',
      { targetCategories: ['TVA', 'IS_STANDARD'] },
      {
        priority: 9000,
        category: 'META',
        condition: { dsl: 'jsonlogic', value: { '===': [{ var: 'zone' }, 'zone_franche'] } },
      },
    ),

    // 3. TVA Standard (Will be inhibited)
    createRule(
      'tva-std',
      'FLAT_RATE',
      { base: 'revenue', rate: 0.18 },
      {
        priority: 3000,
        category: 'TVA',
      },
    ),

    // 4. IS Standard (Will be inhibited)
    createRule(
      'is-std',
      'FLAT_RATE',
      { base: 'profit', rate: 0.27 },
      {
        priority: 3000,
        category: 'IS_STANDARD',
      },
    ),

    // 5. Special Tax ZF (Replaces IS)
    // Should run because it has a different category 'IS_SPECIAL'
    createRule(
      'is-special-zf',
      'FLAT_RATE',
      { base: 'profit', rate: 0.05 },
      {
        priority: 3000,
        category: 'IS_SPECIAL',
      },
    ),

    // 6. IRPP (Progressive)
    createRule(
      'irpp',
      'PROGRESSIVE_BRACKET',
      {
        base: 'taxable_salary',
        brackets: [
          { from: 0, to: 500000, rate: 0 },
          { from: 500000, to: 1000000, rate: 0.1 },
          { from: 1000000, to: null, rate: 0.2 },
        ],
      },
      {
        priority: 3000,
        category: 'IRPP',
      },
    ),

    // 7. CNSS (Composite)
    createRule(
      'cnss',
      'COMPOSITE',
      {
        aggregation: 'SUM',
        steps: [
          { model: 'FLAT_RATE', params: { base: 'gross_salary', rate: 0.04 } }, // Employee
          { model: 'FLAT_RATE', params: { base: 'gross_salary', rate: 0.18 } }, // Employer
        ],
      },
      {
        priority: 3000,
        category: 'CNSS',
      },
    ),

    // 8 & 9. Additive Taxes (Training & Apprenticeship)
    // Both should run because they are in DIFFERENT categories (or same cat but different ID if no conflict logic)
    // Let's put them in 'TAXE_PRO' category.
    // Wait! If they are both 'TAXE_PRO' at 2000, one will be killed by DominanceResolver!
    // To keep both, we must give them distinct categories OR different priorities.
    // Let's test the CONFLIT: We want to keep ONLY ONE Taxe Pro (the highest rate).

    // 8. Low Rate (Loser)
    createRule(
      'tax-pro-low',
      'FLAT_RATE',
      { base: 'revenue', rate: 0.01 },
      {
        priority: 2000,
        category: 'TAXE_PRO',
      },
    ),

    // 9. High Rate (Winner) - Same priority, same category.
    // But how to make it win? DominanceResolver is stable sort or ID based.
    // Let's give it priority 2001 to be sure it wins and kills the other? No, let's test strict conflict.
    // We'll put them both at 2000. The engine will pick ONE.
    // Let's call it 'tax-pro-high'
    createRule(
      'tax-pro-high',
      'FLAT_RATE',
      { base: 'revenue', rate: 0.015 },
      {
        priority: 2000,
        category: 'TAXE_PRO',
      },
    ),

    // 10. Timbre (Fixed)
    createRule(
      'timbre',
      'FIXED_AMOUNT',
      { amount: 5000, currency: 'XOF' },
      {
        priority: 1000,
        category: 'TIMBRE',
      },
    ),

    // 11. Ghost Rule (Wrong Country)
    createRule(
      'ghost-rule',
      'FIXED_AMOUNT',
      { amount: 1000000, currency: 'XOF' },
      {
        priority: 5000,
        country: 'BJ', // Benin
        category: 'TIMBRE',
      },
    ),
  ];

  const input = {
    requestId: 'final-boss-001',
    data: {
      revenue: 100000000, // 100M
      profit: 20000000, // 20M
      gross_salary: 50000000, // 50M
      taxable_salary: 40000000, // 40M
      zone: 'zone_franche',
    },
    meta: {
      tenantId: 'gigafactory',
      context: { country: 'TG' },
    },
  };

  it('runs the Full Simulation correctly', async () => {
    const result = await engine.evaluate(rules, input);

    // 1. CHECK SHORT-CIRCUIT
    // Startup rule should NOT apply
    expect(result.appliedRules.some((r) => r.id === 'meta-startup')).toBe(false);

    // 2. CHECK INHIBITION
    // TVA & IS Standard should be SKIPPED
    const skippedIds = result.skippedRules.map((s) => s.rule.id);
    expect(skippedIds).toContain('tva-std');
    expect(skippedIds).toContain('is-std');

    // 3. CHECK COUNTRY FILTER
    expect(skippedIds).toContain('ghost-rule');
    const ghostSkip = result.skippedRules.find((s) => s.rule.id === 'ghost-rule');
    expect(ghostSkip?.reason).toContain('COUNTRY_MISMATCH');

    // 4. CHECK DOMINANCE CONFLICT (TAXE_PRO)
    // Only one of 'tax-pro-low' or 'tax-pro-high' should be applied.
    // The other should be skipped with RULE_CONFLICT.
    const taxProApplied = result.appliedRules.filter((r) => r.category === 'TAXE_PRO');
    expect(taxProApplied).toHaveLength(1);
    const taxProSkipped = result.skippedRules.find(
      (s) => s.rule.category === 'TAXE_PRO' && s.reason === 'RULE_CONFLICT',
    );
    expect(taxProSkipped).toBeDefined();

    // 5. CHECK CALCULATIONS

    // IS Special: 20M * 5% = 1,000,000
    const isSpecial = result.breakdown.find((b) => b.ruleId === 'is-special-zf')?.contribution;
    expect(isSpecial).toBe(1000000);

    // IRPP:
    // 0-500k (0)
    // 500k-1M (500k * 10% = 50k)
    // 1M-40M (39M * 20% = 7.8M)
    // Total = 7,850,000
    const irpp = result.breakdown.find((b) => b.ruleId === 'irpp')?.contribution;
    expect(irpp).toBe(7850000);

    // CNSS: 50M * (4% + 18%) = 50M * 22% = 11,000,000
    const cnss = result.breakdown.find((b) => b.ruleId === 'cnss')?.contribution;
    expect(cnss).toBe(11000000);

    // TIMBRE: 5000
    const timbre = result.breakdown.find((b) => b.ruleId === 'timbre')?.contribution;
    expect(timbre).toBe(5000);

    // TOTAL EXPECTED
    // 1M + 7.85M + 11M + 5000 + (Either 1M or 1.5M for Tax Pro)
    // If High wins (1.5M): 21,355,000
    // If Low wins (1M): 20,855,000

    // We just check that the total > 20M to be safe on the sort order
    expect(result.value).toBeGreaterThan(20000000);
  });
});
