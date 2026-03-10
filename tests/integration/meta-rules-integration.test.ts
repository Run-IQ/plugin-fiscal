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
});
