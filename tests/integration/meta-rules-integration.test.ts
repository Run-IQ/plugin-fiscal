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
  const { checksum: _ignored, ...cleanExtra } = extra;
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
  return { ...ruleWithoutChecksum, checksum } as unknown as Rule;
}

describe('Meta-Rules Integration (Engine + FiscalPlugin + DSL)', () => {
  const engine = new PPEEngine({
    plugins: [new FiscalPlugin()],
    dsls: [new JsonLogicEvaluator()],
    onChecksumMismatch: 'throw',
    strict: false,
    dryRun: true,
  });

  const baseInput = {
    requestId: 'meta-int-001',
    data: { revenue: 5000000, profit: 1000000 },
    meta: { tenantId: 'test', context: { country: 'TG' } },
  };

  // ─── SHORT_CIRCUIT with real DSL condition ──────────────────────

  it('short-circuit fires when DSL condition is true', async () => {
    const rules = [
      createRule('tva-1', 'FLAT_RATE', { base: 'revenue', rate: 0.18 }, { category: 'TVA', priority: 3000 }),
      createRule(
        'sc-low-revenue',
        'META_SHORT_CIRCUIT',
        { value: 0, reason: 'Low revenue exemption' },
        {
          priority: 9999,
          category: 'META',
          condition: { dsl: 'jsonlogic', value: { '<': [{ var: 'revenue' }, 10000000] } },
        },
      ),
    ];

    const result = await engine.evaluate(rules, {
      ...baseInput,
      requestId: 'sc-true-001',
    });

    expect(result.value).toBe(0);
    expect(result.appliedRules.some((r) => r.model === 'META_SHORT_CIRCUIT')).toBe(true);
  });

  it('short-circuit does NOT fire when DSL condition is false', async () => {
    const rules = [
      createRule('tva-1', 'FLAT_RATE', { base: 'revenue', rate: 0.18 }, { category: 'TVA', priority: 3000 }),
      createRule(
        'sc-low-revenue',
        'META_SHORT_CIRCUIT',
        { value: 0, reason: 'Low revenue exemption' },
        {
          priority: 9999,
          category: 'META',
          condition: { dsl: 'jsonlogic', value: { '<': [{ var: 'revenue' }, 100] } },
        },
      ),
    ];

    const result = await engine.evaluate(rules, {
      ...baseInput,
      requestId: 'sc-false-001',
    });

    // SC condition is false, TVA applies normally
    expect(result.value).toBe(900000); // 5M * 18%
    expect(result.appliedRules.some((r) => r.model === 'META_SHORT_CIRCUIT')).toBe(false);
  });

  // ─── INHIBITION with real DSL condition ─────────────────────────

  it('conditional inhibition inhibits when condition is true', async () => {
    const rules = [
      createRule('tva-1', 'FLAT_RATE', { base: 'revenue', rate: 0.18 }, { category: 'TVA', priority: 3000 }),
      createRule('is-1', 'FLAT_RATE', { base: 'profit', rate: 0.27 }, { category: 'IS', priority: 3000 }),
      createRule(
        'meta-zf',
        'META_INHIBITION',
        { targetCategories: ['TVA'] },
        {
          priority: 9000,
          category: 'META',
          condition: { dsl: 'jsonlogic', value: { '>': [{ var: 'revenue' }, 1000000] } },
        },
      ),
    ];

    const result = await engine.evaluate(rules, {
      ...baseInput,
      requestId: 'inhibit-true-001',
    });

    // TVA inhibited, only IS applies
    expect(result.value).toBe(270000); // 1M * 27%
    expect(result.skippedRules.some((s) => s.reason === 'INHIBITED_BY_META_RULE')).toBe(true);
    expect(result.appliedRules).toHaveLength(1);
  });

  it('conditional inhibition does NOT inhibit when condition is false', async () => {
    const rules = [
      createRule('tva-1', 'FLAT_RATE', { base: 'revenue', rate: 0.18 }, { category: 'TVA', priority: 3000 }),
      createRule('is-1', 'FLAT_RATE', { base: 'profit', rate: 0.27 }, { category: 'IS', priority: 3000 }),
      createRule(
        'meta-zf',
        'META_INHIBITION',
        { targetCategories: ['TVA'] },
        {
          priority: 9000,
          category: 'META',
          condition: { dsl: 'jsonlogic', value: { '>': [{ var: 'revenue' }, 999999999] } },
        },
      ),
    ];

    const result = await engine.evaluate(rules, {
      ...baseInput,
      requestId: 'inhibit-false-001',
    });

    // Both apply
    expect(result.value).toBe(1170000); // 900k + 270k
    expect(result.appliedRules).toHaveLength(2);
  });

  // ─── Multiple short-circuits: highest priority wins ─────────────

  it('multiple short-circuits: highest priority wins deterministically', async () => {
    const rules = [
      createRule('tva-1', 'FLAT_RATE', { base: 'revenue', rate: 0.18 }, { category: 'TVA', priority: 3000 }),
      createRule(
        'sc-low',
        'META_SHORT_CIRCUIT',
        { value: 100, reason: 'Low prio' },
        { priority: 1000, category: 'META' },
      ),
      createRule(
        'sc-high',
        'META_SHORT_CIRCUIT',
        { value: 0, reason: 'High prio' },
        { priority: 9999, category: 'META' },
      ),
    ];

    const result = await engine.evaluate(rules, {
      ...baseInput,
      requestId: 'multi-sc-001',
    });

    expect(result.value).toBe(0);
  });

  // ─── Invalid meta-rule params are silently skipped ──────────────

  it('invalid short-circuit params are skipped, normal rules still execute', async () => {
    const rules = [
      createRule('tva-1', 'FLAT_RATE', { base: 'revenue', rate: 0.18 }, { category: 'TVA', priority: 3000 }),
      createRule(
        'sc-bad',
        'META_SHORT_CIRCUIT',
        { invalid: true } as unknown as Record<string, unknown>,
        { priority: 9999, category: 'META' },
      ),
    ];

    const result = await engine.evaluate(rules, {
      ...baseInput,
      requestId: 'invalid-sc-001',
    });

    // SC was invalid, so TVA runs normally
    expect(result.value).toBe(900000);

    // Warning surfaced in trace
    const warningStep = result.trace.steps.find((s) => s.modelUsed === 'META_WARNING');
    expect(warningStep).toBeDefined();
    expect(warningStep!.detail).toContain('sc-bad');
  });

  it('invalid inhibition params are skipped, rules survive', async () => {
    const rules = [
      createRule('tva-1', 'FLAT_RATE', { base: 'revenue', rate: 0.18 }, { category: 'TVA', priority: 3000 }),
      createRule(
        'inhibit-bad',
        'META_INHIBITION',
        {} as unknown as Record<string, unknown>,
        { priority: 9000, category: 'META' },
      ),
    ];

    const result = await engine.evaluate(rules, {
      ...baseInput,
      requestId: 'invalid-inhibit-001',
    });

    expect(result.value).toBe(900000);
    expect(result.appliedRules).toHaveLength(1);

    const warningStep = result.trace.steps.find((s) => s.modelUsed === 'META_WARNING');
    expect(warningStep).toBeDefined();
  });

  // ─── Inhibition + Substitution ordering ─────────────────────────

  it('inhibited rules are NOT substituted (inhibition runs first)', async () => {
    const rules = [
      createRule('tva-1', 'FLAT_RATE', { base: 'revenue', rate: 0.18 }, { category: 'TVA', priority: 3000 }),
      createRule('is-1', 'FLAT_RATE', { base: 'profit', rate: 0.27 }, { category: 'IS', priority: 3000 }),
      // Inhibit TVA
      createRule(
        'inhibit-tva',
        'META_INHIBITION',
        { targetCategories: ['TVA'] },
        { priority: 9000, category: 'META' },
      ),
      // Try to substitute all FLAT_RATE (but TVA is already gone)
      createRule(
        'sub-flat',
        'META_SUBSTITUTION',
        { targetModel: 'FLAT_RATE', newParams: { rate: 0.05 } },
        { priority: 8000, category: 'META' },
      ),
    ];

    const result = await engine.evaluate(rules, {
      ...baseInput,
      requestId: 'order-001',
    });

    // TVA inhibited, IS substituted to 5%
    expect(result.value).toBe(50000); // 1M * 5%
    expect(result.appliedRules).toHaveLength(1);
    expect(result.skippedRules.some((s) => s.reason === 'INHIBITED_BY_META_RULE')).toBe(true);
  });

  // ─── Meta-rule without condition defaults to true ───────────────

  it('unconditional meta-rule always applies', async () => {
    const rules = [
      createRule('tva-1', 'FLAT_RATE', { base: 'revenue', rate: 0.18 }, { category: 'TVA', priority: 3000 }),
      // No condition on this meta-rule
      createRule(
        'inhibit-all-tva',
        'META_INHIBITION',
        { targetCategories: ['TVA'] },
        { priority: 9000, category: 'META' },
      ),
    ];

    const result = await engine.evaluate(rules, {
      ...baseInput,
      requestId: 'unconditional-001',
    });

    expect(result.value).toBe(0);
    expect(result.skippedRules.some((s) => s.reason === 'INHIBITED_BY_META_RULE')).toBe(true);
  });

  // ─── Zone Franche scenario (real-world) ─────────────────────────

  it('Zone Franche: inhibits standard taxes, special tax still applies', async () => {
    const rules = [
      createRule('tva-std', 'FLAT_RATE', { base: 'revenue', rate: 0.18 }, { category: 'TVA', priority: 3000 }),
      createRule('is-std', 'FLAT_RATE', { base: 'profit', rate: 0.27 }, { category: 'IS_STANDARD', priority: 3000 }),
      createRule('is-special', 'FLAT_RATE', { base: 'profit', rate: 0.05 }, { category: 'IS_SPECIAL', priority: 3000 }),
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
    ];

    const result = await engine.evaluate(rules, {
      requestId: 'zf-001',
      data: { ...baseInput.data, zone: 'zone_franche' },
      meta: baseInput.meta,
    });

    // Only IS_SPECIAL applies
    expect(result.value).toBe(50000); // 1M * 5%
    expect(result.appliedRules).toHaveLength(1);
    expect(result.skippedRules.filter((s) => s.reason === 'INHIBITED_BY_META_RULE')).toHaveLength(2);
  });

  // ─── NGO exemption (short-circuit with value=0) ─────────────────

  it('NGO exemption: short-circuit returns 0, all rules skipped', async () => {
    const rules = [
      createRule('tva-1', 'FLAT_RATE', { base: 'revenue', rate: 0.18 }, { category: 'TVA', priority: 3000 }),
      createRule('is-1', 'FLAT_RATE', { base: 'profit', rate: 0.27 }, { category: 'IS', priority: 3000 }),
      createRule(
        'ngo-exempt',
        'META_SHORT_CIRCUIT',
        { value: 0, reason: 'NGO fully exempt from all taxes' },
        {
          priority: 9999,
          category: 'META',
          condition: { dsl: 'jsonlogic', value: { '===': [{ var: 'entity_type' }, 'NGO'] } },
        },
      ),
    ];

    const result = await engine.evaluate(rules, {
      requestId: 'ngo-001',
      data: { ...baseInput.data, entity_type: 'NGO' },
      meta: baseInput.meta,
    });

    expect(result.value).toBe(0);
    expect(result.appliedRules.some((r) => r.model === 'META_SHORT_CIRCUIT')).toBe(true);
  });

  // ─── Trace contains meta-actions ────────────────────────────────

  it('trace contains meta-action steps', async () => {
    const rules = [
      createRule('tva-1', 'FLAT_RATE', { base: 'revenue', rate: 0.18 }, { category: 'TVA', priority: 3000 }),
      createRule('is-1', 'FLAT_RATE', { base: 'profit', rate: 0.27 }, { category: 'IS', priority: 3000 }),
      createRule(
        'inhibit-tva',
        'META_INHIBITION',
        { targetCategories: ['TVA'] },
        { priority: 9000, category: 'META' },
      ),
    ];

    const result = await engine.evaluate(rules, {
      ...baseInput,
      requestId: 'trace-001',
    });

    const metaStep = result.trace.steps.find((s) => s.modelUsed === 'META_INHIBITION');
    expect(metaStep).toBeDefined();
    expect(metaStep!.ruleId).toBe('inhibit-tva');
  });

  // ═══════════════════════════════════════════════════════════════════
  // ─── SUBSTITUTION — Full Integration Tests ─────────────────────
  // ═══════════════════════════════════════════════════════════════════

  describe('Substitution — end-to-end with real calculations', () => {
    it('substitution changes FLAT_RATE rate → different computed value', async () => {
      const rules = [
        createRule('tva-1', 'FLAT_RATE', { base: 'revenue', rate: 0.18 }, { category: 'TVA', priority: 3000 }),
        createRule(
          'sub-tva-reduced',
          'META_SUBSTITUTION',
          { targetModel: 'FLAT_RATE', targetIds: ['tva-1'], newParams: { rate: 0.05 } },
          { priority: 9000, category: 'META' },
        ),
      ];

      const result = await engine.evaluate(rules, {
        ...baseInput,
        requestId: 'sub-calc-001',
      });

      // 5M * 5% = 250,000 (not 900,000 at 18%)
      expect(result.value).toBe(250000);
      expect(result.appliedRules).toHaveLength(1);
    });

    it('substitution changes PROGRESSIVE_BRACKET brackets → different computed value', async () => {
      const originalBrackets = [
        { from: 0, to: 900000, rate: 0 },
        { from: 900000, to: 1800000, rate: 0.1 },
        { from: 1800000, to: 3600000, rate: 0.15 },
        { from: 3600000, to: null, rate: 0.35 },
      ];

      const newBrackets = [
        { from: 0, to: 1000000, rate: 0 },
        { from: 1000000, to: null, rate: 0.10 },
      ];

      const rules = [
        createRule(
          'irpp-1',
          'PROGRESSIVE_BRACKET',
          { base: 'taxable_salary', brackets: originalBrackets },
          { category: 'IRPP', priority: 3000 },
        ),
        createRule(
          'sub-irpp-brackets',
          'META_SUBSTITUTION',
          { targetModel: 'PROGRESSIVE_BRACKET', newParams: { brackets: newBrackets } },
          { priority: 9000, category: 'META' },
        ),
      ];

      const input = {
        requestId: 'sub-bracket-001',
        data: { taxable_salary: 5000000 },
        meta: { tenantId: 'test', context: { country: 'TG' } },
      };

      const result = await engine.evaluate(rules, input);

      // With new brackets: 0-1M (0%) + 1M-5M (10%) = 400,000
      expect(result.value).toBe(400000);
    });

    it('conditional substitution with DSL: applies only when condition is true', async () => {
      const rules = [
        createRule('tva-1', 'FLAT_RATE', { base: 'revenue', rate: 0.18 }, { category: 'TVA', priority: 3000 }),
        createRule(
          'sub-zf-tva',
          'META_SUBSTITUTION',
          { targetModel: 'FLAT_RATE', targetIds: ['tva-1'], newParams: { rate: 0.05 } },
          {
            priority: 9000,
            category: 'META',
            condition: { dsl: 'jsonlogic', value: { '===': [{ var: 'zone' }, 'zone_franche'] } },
          },
        ),
      ];

      // Without zone_franche → substitution disabled
      const resultNormal = await engine.evaluate(rules, {
        requestId: 'sub-cond-false-001',
        data: { revenue: 5000000, zone: 'standard' },
        meta: { tenantId: 'test', context: { country: 'TG' } },
      });
      expect(resultNormal.value).toBe(900000); // 5M * 18%

      // With zone_franche → substitution applied
      const resultZF = await engine.evaluate(rules, {
        requestId: 'sub-cond-true-001',
        data: { revenue: 5000000, zone: 'zone_franche' },
        meta: { tenantId: 'test', context: { country: 'TG' } },
      });
      expect(resultZF.value).toBe(250000); // 5M * 5%
    });

    it('substitution on COMPOSITE model: replaces steps, changes computation', async () => {
      const rules = [
        createRule(
          'cnss',
          'COMPOSITE',
          {
            aggregation: 'SUM',
            steps: [
              { model: 'FLAT_RATE', params: { base: 'gross_salary', rate: 0.04 } },
              { model: 'FLAT_RATE', params: { base: 'gross_salary', rate: 0.18 } },
            ],
          },
          { category: 'CNSS', priority: 3000 },
        ),
        createRule(
          'sub-cnss',
          'META_SUBSTITUTION',
          {
            targetModel: 'COMPOSITE',
            newParams: {
              steps: [
                { model: 'FLAT_RATE', params: { base: 'gross_salary', rate: 0.05 } },
                { model: 'FLAT_RATE', params: { base: 'gross_salary', rate: 0.20 } },
              ],
            },
          },
          { priority: 9000, category: 'META' },
        ),
      ];

      const input = {
        requestId: 'sub-composite-001',
        data: { gross_salary: 1000000 },
        meta: { tenantId: 'test', context: { country: 'TG' } },
      };

      const result = await engine.evaluate(rules, input);

      // New steps: 1M * 5% + 1M * 20% = 50k + 200k = 250k
      expect(result.value).toBe(250000);
    });

    it('substitution changes base field → computes from different input field', async () => {
      const rules = [
        createRule(
          'tva-1',
          'FLAT_RATE',
          { base: 'revenue', rate: 0.18 },
          { category: 'TVA', priority: 3000 },
        ),
        createRule(
          'sub-change-base',
          'META_SUBSTITUTION',
          { targetModel: 'FLAT_RATE', targetIds: ['tva-1'], newParams: { base: 'profit' } },
          { priority: 9000, category: 'META' },
        ),
      ];

      const result = await engine.evaluate(rules, {
        ...baseInput,
        requestId: 'sub-base-change-001',
      });

      // Computes on profit (1M) instead of revenue (5M)
      // 1M * 18% = 180,000
      expect(result.value).toBe(180000);
    });

    it('multiple substitutions on same rule in full engine: last one wins on conflicting keys', async () => {
      const rules = [
        createRule('tva-1', 'FLAT_RATE', { base: 'revenue', rate: 0.18 }, { category: 'TVA', priority: 3000 }),
        // First sub (high prio): rate → 0.10
        createRule(
          'sub-1',
          'META_SUBSTITUTION',
          { targetModel: 'FLAT_RATE', newParams: { rate: 0.10 } },
          { priority: 9000, category: 'META' },
        ),
        // Second sub (lower prio): rate → 0.02
        createRule(
          'sub-2',
          'META_SUBSTITUTION',
          { targetModel: 'FLAT_RATE', newParams: { rate: 0.02 } },
          { priority: 5000, category: 'META' },
        ),
      ];

      const result = await engine.evaluate(rules, {
        ...baseInput,
        requestId: 'sub-stack-001',
      });

      // sub-1 runs first (prio 9000), sub-2 overrides (prio 5000)
      // Final rate = 0.02 → 5M * 2% = 100,000
      expect(result.value).toBe(100000);
    });

    it('substitution trace step is present in result', async () => {
      const rules = [
        createRule('tva-1', 'FLAT_RATE', { base: 'revenue', rate: 0.18 }, { category: 'TVA', priority: 3000 }),
        createRule(
          'sub-tva',
          'META_SUBSTITUTION',
          { targetModel: 'FLAT_RATE', newParams: { rate: 0.05 } },
          { priority: 9000, category: 'META' },
        ),
      ];

      const result = await engine.evaluate(rules, {
        ...baseInput,
        requestId: 'sub-trace-001',
      });

      const subStep = result.trace.steps.find((s) => s.modelUsed === 'META_SUBSTITUTION');
      expect(subStep).toBeDefined();
      expect(subStep!.ruleId).toBe('sub-tva');
      expect(subStep!.detail).toContain('tva-1');
    });

    it('Zone Franche real-world: inhibit TVA+IS, substitute IRPP brackets', async () => {
      const rules = [
        createRule('tva', 'FLAT_RATE', { base: 'revenue', rate: 0.18 }, { category: 'TVA', priority: 3000 }),
        createRule('is', 'FLAT_RATE', { base: 'profit', rate: 0.27 }, { category: 'IS', priority: 3000 }),
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
          { category: 'IRPP', priority: 3000 },
        ),
        // Inhibit TVA and IS
        createRule(
          'meta-zf-inhibit',
          'META_INHIBITION',
          { targetCategories: ['TVA', 'IS'] },
          {
            priority: 9500,
            category: 'META',
            condition: { dsl: 'jsonlogic', value: { '===': [{ var: 'zone' }, 'zone_franche'] } },
          },
        ),
        // Substitute IRPP with reduced brackets
        createRule(
          'meta-zf-sub',
          'META_SUBSTITUTION',
          {
            targetModel: 'PROGRESSIVE_BRACKET',
            newParams: {
              brackets: [
                { from: 0, to: 1000000, rate: 0 },
                { from: 1000000, to: null, rate: 0.05 },
              ],
            },
          },
          {
            priority: 9000,
            category: 'META',
            condition: { dsl: 'jsonlogic', value: { '===': [{ var: 'zone' }, 'zone_franche'] } },
          },
        ),
      ];

      const result = await engine.evaluate(rules, {
        requestId: 'zf-combined-001',
        data: { revenue: 10000000, profit: 3000000, taxable_salary: 5000000, zone: 'zone_franche' },
        meta: { tenantId: 'test', context: { country: 'TG' } },
      });

      // TVA inhibited, IS inhibited, IRPP brackets substituted
      // IRPP: 0-1M (0%) + 1M-5M (5%) = 200,000
      expect(result.value).toBe(200000);
      expect(result.appliedRules).toHaveLength(1);
      expect(result.skippedRules.filter((s) => s.reason === 'INHIBITED_BY_META_RULE')).toHaveLength(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // ─── Integrity & Safety Fixes ──────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  describe('Substitution — checksum recalculation', () => {
    it('substituted rule in snapshot has valid checksum matching its new params', async () => {
      const rules = [
        createRule('tva-1', 'FLAT_RATE', { base: 'revenue', rate: 0.18 }, { category: 'TVA', priority: 3000 }),
        createRule(
          'sub-tva',
          'META_SUBSTITUTION',
          { targetModel: 'FLAT_RATE', targetIds: ['tva-1'], newParams: { rate: 0.05 } },
          { priority: 9000, category: 'META' },
        ),
      ];

      const result = await engine.evaluate(rules, {
        ...baseInput,
        requestId: 'checksum-recalc-001',
      });

      // The applied rule should have a valid checksum that matches its substituted params
      const appliedRule = result.appliedRules.find((r) => r.id === 'tva-1');
      expect(appliedRule).toBeDefined();
      const expectedChecksum = computeRuleChecksum(appliedRule!);
      expect(appliedRule!.checksum).toBe(expectedChecksum);
    });

    it('substituted rule checksum differs from original rule checksum', async () => {
      const originalRule = createRule(
        'tva-1', 'FLAT_RATE', { base: 'revenue', rate: 0.18 }, { category: 'TVA', priority: 3000 },
      );
      const originalChecksum = originalRule.checksum;

      const rules = [
        originalRule,
        createRule(
          'sub-tva',
          'META_SUBSTITUTION',
          { targetModel: 'FLAT_RATE', targetIds: ['tva-1'], newParams: { rate: 0.05 } },
          { priority: 9000, category: 'META' },
        ),
      ];

      const result = await engine.evaluate(rules, {
        ...baseInput,
        requestId: 'checksum-diff-001',
      });

      const appliedRule = result.appliedRules.find((r) => r.id === 'tva-1');
      expect(appliedRule).toBeDefined();
      // Checksum changed because params changed
      expect(appliedRule!.checksum).not.toBe(originalChecksum);
    });
  });

  describe('Substitution — params validation warning', () => {
    it('substitution producing invalid params emits warning in trace', async () => {
      const rules = [
        createRule('tva-1', 'FLAT_RATE', { base: 'revenue', rate: 0.18 }, { category: 'TVA', priority: 3000 }),
        createRule(
          'sub-invalid-rate',
          'META_SUBSTITUTION',
          { targetModel: 'FLAT_RATE', targetIds: ['tva-1'], newParams: { rate: -0.5 } },
          { priority: 9000, category: 'META' },
        ),
      ];

      const result = await engine.evaluate(rules, {
        ...baseInput,
        requestId: 'invalid-sub-params-001',
      });

      // Warning should be in trace
      const warningStep = result.trace.steps.find(
        (s) => s.modelUsed === 'META_WARNING' && s.detail?.includes('tva-1'),
      );
      expect(warningStep).toBeDefined();
      expect(warningStep!.detail).toContain('invalid params');
    });
  });
});
