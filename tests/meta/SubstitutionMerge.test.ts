import { describe, it, expect } from 'vitest';
import type { Rule } from '@run-iq/core';
import { MetaRuleProcessor } from '../../src/meta/MetaRuleProcessor.js';
import type { FiscalRule } from '../../src/types/fiscal-rule.js';

function makeFiscalRule(overrides: Partial<FiscalRule> & { id: string }): Rule {
  const params = overrides.params ?? { rate: 0.18, base: 'amount' };
  return {
    version: 1,
    model: 'FLAT_RATE',
    priority: 100,
    effectiveFrom: new Date('2024-01-01'),
    effectiveUntil: null,
    tags: [],
    checksum: 'test-checksum',
    params,
    jurisdiction: 'NATIONAL',
    scope: 'GLOBAL',
    country: 'TG',
    category: 'TVA',
    ...overrides,
  } as unknown as Rule;
}

function getParams(rule: Rule): Record<string, unknown> {
  return (rule as FiscalRule).params as Record<string, unknown>;
}

describe('MetaRuleProcessor - Substitution Deep Merge', () => {
  // ─── Basic deep merge: scalar field updated, rest preserved ─────

  it('deep merges: updates scalar field, preserves untouched fields', () => {
    const rules = [
      makeFiscalRule({
        id: 'is-progressive',
        model: 'PROGRESSIVE_BRACKET',
        params: {
          base: 'profit',
          brackets: [
            { from: 0, to: 5000000, rate: 0.1 },
            { from: 5000000, to: null, rate: 0.2 },
          ],
        },
      }),
      makeFiscalRule({
        id: 'sub-base-only',
        model: 'META_SUBSTITUTION',
        params: {
          targetModel: 'PROGRESSIVE_BRACKET',
          targetIds: ['is-progressive'],
          newParams: { base: 'revenue' },
        },
      }),
    ];

    const result = MetaRuleProcessor.process(rules, new Map());

    expect(result.rules).toHaveLength(1);
    const p = getParams(result.rules[0]!);
    expect(p.base).toBe('revenue');
    const brackets = p.brackets as Array<Record<string, unknown>>;
    expect(brackets).toHaveLength(2);
    expect(brackets[0]?.rate).toBe(0.1);
  });

  // ─── Arrays are REPLACED, not merged ────────────────────────────

  it('deep merge: arrays are replaced entirely, not concatenated', () => {
    const rules = [
      makeFiscalRule({
        id: 'bracket-rule',
        model: 'PROGRESSIVE_BRACKET',
        params: {
          base: 'income',
          brackets: [
            { from: 0, to: 1000000, rate: 0.05 },
            { from: 1000000, to: 5000000, rate: 0.15 },
            { from: 5000000, to: null, rate: 0.30 },
          ],
        },
      }),
      makeFiscalRule({
        id: 'sub-new-brackets',
        model: 'META_SUBSTITUTION',
        params: {
          targetModel: 'PROGRESSIVE_BRACKET',
          newParams: {
            brackets: [
              { from: 0, to: 2000000, rate: 0.0 },
              { from: 2000000, to: null, rate: 0.10 },
            ],
          },
        },
      }),
    ];

    const result = MetaRuleProcessor.process(rules, new Map());

    const p = getParams(result.rules[0]!);
    expect(p.base).toBe('income'); // preserved
    const brackets = p.brackets as Array<Record<string, unknown>>;
    // REPLACED: 2 new brackets, NOT 5 merged
    expect(brackets).toHaveLength(2);
    expect(brackets[0]?.rate).toBe(0.0);
    expect(brackets[1]?.rate).toBe(0.10);
  });

  // ─── Adding NEW fields that didn't exist ────────────────────────

  it('deep merge: adds new fields that did not exist before', () => {
    const rules = [
      makeFiscalRule({
        id: 'flat-1',
        model: 'FLAT_RATE',
        params: { rate: 0.18, base: 'revenue' },
      }),
      makeFiscalRule({
        id: 'sub-add-min',
        model: 'META_SUBSTITUTION',
        params: {
          targetModel: 'FLAT_RATE',
          newParams: { minimum: 500000, currency: 'XOF' },
        },
      }),
    ];

    const result = MetaRuleProcessor.process(rules, new Map());

    const p = getParams(result.rules[0]!);
    expect(p.rate).toBe(0.18); // preserved
    expect(p.base).toBe('revenue'); // preserved
    expect(p.minimum).toBe(500000); // added
    expect(p.currency).toBe('XOF'); // added
  });

  // ─── Nested objects are deep merged ─────────────────────────────

  it('deep merge: nested objects are recursively merged', () => {
    const rules = [
      makeFiscalRule({
        id: 'complex-rule',
        model: 'COMPOSITE',
        params: {
          aggregation: 'SUM',
          options: { rounding: 'floor', precision: 2 },
          steps: [{ model: 'FLAT_RATE', params: { rate: 0.04 } }],
        },
      }),
      makeFiscalRule({
        id: 'sub-options',
        model: 'META_SUBSTITUTION',
        params: {
          targetModel: 'COMPOSITE',
          newParams: {
            options: { precision: 4, mode: 'strict' },
          },
        },
      }),
    ];

    const result = MetaRuleProcessor.process(rules, new Map());

    const p = getParams(result.rules[0]!);
    expect(p.aggregation).toBe('SUM'); // preserved
    const opts = p.options as Record<string, unknown>;
    expect(opts.rounding).toBe('floor'); // preserved (nested)
    expect(opts.precision).toBe(4); // overridden (nested)
    expect(opts.mode).toBe('strict'); // added (nested)
  });

  // ─── Multiple substitutions on the SAME rule ────────────────────

  it('multiple substitutions stack on the same rule', () => {
    const rules = [
      makeFiscalRule({
        id: 'flat-1',
        model: 'FLAT_RATE',
        params: { rate: 0.18, base: 'revenue' },
      }),
      // First sub: change rate (higher priority, runs first)
      makeFiscalRule({
        id: 'sub-rate',
        model: 'META_SUBSTITUTION',
        params: {
          targetModel: 'FLAT_RATE',
          targetIds: ['flat-1'],
          newParams: { rate: 0.10 },
        },
        priority: 9000,
      }),
      // Second sub: change base (lower priority, runs after)
      makeFiscalRule({
        id: 'sub-base',
        model: 'META_SUBSTITUTION',
        params: {
          targetModel: 'FLAT_RATE',
          targetIds: ['flat-1'],
          newParams: { base: 'profit' },
        },
        priority: 5000,
      }),
    ];

    const result = MetaRuleProcessor.process(rules, new Map());

    const p = getParams(result.rules[0]!);
    // Both substitutions applied: rate from first, base from second
    expect(p.rate).toBe(0.10);
    expect(p.base).toBe('profit');
    expect(result.substitutedIds).toContain('flat-1');
  });

  it('later substitution can override earlier one on same key', () => {
    const rules = [
      makeFiscalRule({
        id: 'flat-1',
        model: 'FLAT_RATE',
        params: { rate: 0.18, base: 'revenue' },
      }),
      makeFiscalRule({
        id: 'sub-1',
        model: 'META_SUBSTITUTION',
        params: {
          targetModel: 'FLAT_RATE',
          newParams: { rate: 0.10 },
        },
        priority: 9000,
      }),
      makeFiscalRule({
        id: 'sub-2',
        model: 'META_SUBSTITUTION',
        params: {
          targetModel: 'FLAT_RATE',
          newParams: { rate: 0.05 },
        },
        priority: 5000,
      }),
    ];

    const result = MetaRuleProcessor.process(rules, new Map());

    // sub-1 runs first (prio 9000 → rate=0.10), then sub-2 overrides (prio 5000 → rate=0.05)
    const p = getParams(result.rules[0]!);
    expect(p.rate).toBe(0.05);
  });

  // ─── Immutability: original rule is not mutated ─────────────────

  it('substitution does NOT mutate the original rule object', () => {
    const originalParams = { rate: 0.18, base: 'revenue' };
    const originalRule = makeFiscalRule({
      id: 'flat-1',
      model: 'FLAT_RATE',
      params: { ...originalParams },
    });

    const rules = [
      originalRule,
      makeFiscalRule({
        id: 'sub-1',
        model: 'META_SUBSTITUTION',
        params: {
          targetModel: 'FLAT_RATE',
          newParams: { rate: 0.05 },
        },
      }),
    ];

    const result = MetaRuleProcessor.process(rules, new Map());

    // Substituted rule has new rate
    expect(getParams(result.rules[0]!).rate).toBe(0.05);

    // Original rule is untouched
    expect((originalRule as unknown as FiscalRule).params).toEqual(originalParams);
  });

  // ─── Substitution by tags ───────────────────────────────────────

  it('substitution by tags: only matching tag rules are affected', () => {
    const rules = [
      makeFiscalRule({
        id: 'flat-essential',
        model: 'FLAT_RATE',
        tags: ['essential', 'food'],
        params: { rate: 0.18, base: 'revenue' },
      }),
      makeFiscalRule({
        id: 'flat-luxury',
        model: 'FLAT_RATE',
        tags: ['luxury'],
        params: { rate: 0.25, base: 'revenue' },
      }),
      makeFiscalRule({
        id: 'flat-standard',
        model: 'FLAT_RATE',
        tags: [],
        params: { rate: 0.18, base: 'revenue' },
      }),
      makeFiscalRule({
        id: 'sub-essential',
        model: 'META_SUBSTITUTION',
        params: {
          targetModel: 'FLAT_RATE',
          targetTags: ['essential'],
          newParams: { rate: 0.05 },
        },
      }),
    ];

    const result = MetaRuleProcessor.process(rules, new Map());

    expect(result.rules).toHaveLength(3);
    // essential matched (has 'essential' tag)
    expect(getParams(result.rules[0]!).rate).toBe(0.05);
    // luxury untouched
    expect(getParams(result.rules[1]!).rate).toBe(0.25);
    // standard untouched
    expect(getParams(result.rules[2]!).rate).toBe(0.18);
    expect(result.substitutedIds).toEqual(['flat-essential']);
  });

  it('substitution by tags: rule with multiple tags matches if ANY tag matches', () => {
    const rules = [
      makeFiscalRule({
        id: 'multi-tag-rule',
        model: 'FLAT_RATE',
        tags: ['food', 'essential', 'local'],
        params: { rate: 0.18, base: 'revenue' },
      }),
      makeFiscalRule({
        id: 'sub-local',
        model: 'META_SUBSTITUTION',
        params: {
          targetModel: 'FLAT_RATE',
          targetTags: ['local'],
          newParams: { rate: 0.02 },
        },
      }),
    ];

    const result = MetaRuleProcessor.process(rules, new Map());

    expect(getParams(result.rules[0]!).rate).toBe(0.02);
  });

  // ─── Substitution with condition false → no change ──────────────

  it('substitution with condition=false leaves rules untouched', () => {
    const rules = [
      makeFiscalRule({
        id: 'flat-1',
        model: 'FLAT_RATE',
        params: { rate: 0.18, base: 'revenue' },
      }),
      makeFiscalRule({
        id: 'sub-conditional',
        model: 'META_SUBSTITUTION',
        params: {
          targetModel: 'FLAT_RATE',
          newParams: { rate: 0.05 },
        },
      }),
    ];

    const conditionResults = new Map([['sub-conditional', false]]);
    const result = MetaRuleProcessor.process(rules, conditionResults);

    expect(getParams(result.rules[0]!).rate).toBe(0.18);
    expect(result.substitutedIds).toHaveLength(0);
  });

  // ─── Substitution with empty newParams ──────────────────────────

  it('substitution with empty newParams object: rule params unchanged', () => {
    const rules = [
      makeFiscalRule({
        id: 'flat-1',
        model: 'FLAT_RATE',
        params: { rate: 0.18, base: 'revenue' },
      }),
      makeFiscalRule({
        id: 'sub-empty',
        model: 'META_SUBSTITUTION',
        params: {
          targetModel: 'FLAT_RATE',
          newParams: {},
        },
      }),
    ];

    const result = MetaRuleProcessor.process(rules, new Map());

    // Deep merge with {} changes nothing
    expect(getParams(result.rules[0]!)).toEqual({ rate: 0.18, base: 'revenue' });
    // But the substitution IS reported (it matched and ran)
    expect(result.substitutedIds).toContain('flat-1');
  });

  // ─── Substitution on different model types ──────────────────────

  it('substitution on COMPOSITE: replaces steps array', () => {
    const rules = [
      makeFiscalRule({
        id: 'cnss',
        model: 'COMPOSITE',
        category: 'CNSS',
        params: {
          aggregation: 'SUM',
          steps: [
            { model: 'FLAT_RATE', params: { base: 'gross_salary', rate: 0.04 } },
            { model: 'FLAT_RATE', params: { base: 'gross_salary', rate: 0.18 } },
          ],
        },
      }),
      makeFiscalRule({
        id: 'sub-cnss-steps',
        model: 'META_SUBSTITUTION',
        params: {
          targetModel: 'COMPOSITE',
          newParams: {
            steps: [
              { model: 'FLAT_RATE', params: { base: 'gross_salary', rate: 0.05 } },
              { model: 'FLAT_RATE', params: { base: 'gross_salary', rate: 0.20 } },
              { model: 'FLAT_RATE', params: { base: 'gross_salary', rate: 0.01 } },
            ],
          },
        },
      }),
    ];

    const result = MetaRuleProcessor.process(rules, new Map());

    const p = getParams(result.rules[0]!);
    expect(p.aggregation).toBe('SUM'); // preserved
    const steps = p.steps as Array<Record<string, unknown>>;
    // Array REPLACED: 3 new steps, not 5
    expect(steps).toHaveLength(3);
    expect((steps[0] as Record<string, unknown>).params).toEqual({
      base: 'gross_salary',
      rate: 0.05,
    });
    expect((steps[2] as Record<string, unknown>).params).toEqual({
      base: 'gross_salary',
      rate: 0.01,
    });
  });

  it('substitution on MINIMUM_TAX: changes rate and minimum', () => {
    const rules = [
      makeFiscalRule({
        id: 'is-min-tax',
        model: 'MINIMUM_TAX',
        category: 'IS',
        params: { rate: 0.27, base: 'taxable_profit', minimum: 500000 },
      }),
      makeFiscalRule({
        id: 'sub-min-tax',
        model: 'META_SUBSTITUTION',
        params: {
          targetModel: 'MINIMUM_TAX',
          newParams: { rate: 0.15, minimum: 200000 },
        },
      }),
    ];

    const result = MetaRuleProcessor.process(rules, new Map());

    const p = getParams(result.rules[0]!);
    expect(p.rate).toBe(0.15);
    expect(p.minimum).toBe(200000);
    expect(p.base).toBe('taxable_profit'); // preserved
  });

  // ─── Substitution + targetIds that partially match ──────────────

  it('substitution with targetIds: only specified IDs are affected', () => {
    const rules = [
      makeFiscalRule({ id: 'flat-1', model: 'FLAT_RATE', params: { rate: 0.18 } }),
      makeFiscalRule({ id: 'flat-2', model: 'FLAT_RATE', params: { rate: 0.25 } }),
      makeFiscalRule({ id: 'flat-3', model: 'FLAT_RATE', params: { rate: 0.10 } }),
      makeFiscalRule({
        id: 'sub-specific',
        model: 'META_SUBSTITUTION',
        params: {
          targetModel: 'FLAT_RATE',
          targetIds: ['flat-1', 'flat-3'],
          newParams: { rate: 0.01 },
        },
      }),
    ];

    const result = MetaRuleProcessor.process(rules, new Map());

    expect(getParams(result.rules[0]!).rate).toBe(0.01); // flat-1 changed
    expect(getParams(result.rules[1]!).rate).toBe(0.25); // flat-2 untouched
    expect(getParams(result.rules[2]!).rate).toBe(0.01); // flat-3 changed
    expect(result.substitutedIds).toEqual(['flat-1', 'flat-3']);
  });

  // ─── Substitution with targetIds pointing to nonexistent rules ──

  it('substitution with targetIds pointing to nonexistent rules: no crash, no action', () => {
    const rules = [
      makeFiscalRule({ id: 'flat-1', model: 'FLAT_RATE', params: { rate: 0.18 } }),
      makeFiscalRule({
        id: 'sub-ghost',
        model: 'META_SUBSTITUTION',
        params: {
          targetModel: 'FLAT_RATE',
          targetIds: ['nonexistent-1', 'nonexistent-2'],
          newParams: { rate: 0.01 },
        },
      }),
    ];

    const result = MetaRuleProcessor.process(rules, new Map());

    // flat-1 is FLAT_RATE but not in targetIds → untouched
    expect(getParams(result.rules[0]!).rate).toBe(0.18);
    expect(result.substitutedIds).toHaveLength(0);
  });
});
