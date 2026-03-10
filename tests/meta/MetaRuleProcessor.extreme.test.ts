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

describe('MetaRuleProcessor — Extreme Edge Cases', () => {
  // ─── P0.1: Meta-rules NEVER target other meta-rules ─────────────────

  describe('Meta-rule isolation', () => {
    it('inhibition does NOT remove other meta-rules', () => {
      const rules = [
        makeFiscalRule({ id: 'tva-1', category: 'TVA' }),
        makeFiscalRule({
          id: 'meta-inhibit-1',
          model: 'META_INHIBITION',
          params: { targetCategories: ['TVA'] },
          priority: 9000,
        }),
        makeFiscalRule({
          id: 'meta-inhibit-2',
          model: 'META_INHIBITION',
          params: { targetCategories: ['IS'] },
          priority: 8000,
        }),
      ];

      const result = MetaRuleProcessor.process(rules, new Map());

      // tva-1 inhibited, but meta-inhibit-2 is NOT inhibited
      expect(result.inhibitedIds).toContain('tva-1');
      expect(result.inhibitedIds).not.toContain('meta-inhibit-2');
    });

    it('inhibition targeting a meta-rule ID has no effect', () => {
      const rules = [
        makeFiscalRule({ id: 'tva-1', category: 'TVA' }),
        makeFiscalRule({
          id: 'meta-sc',
          model: 'META_SHORT_CIRCUIT',
          params: { value: 0, reason: 'test' },
          priority: 9000,
        }),
        makeFiscalRule({
          id: 'meta-inhibit-meta',
          model: 'META_INHIBITION',
          params: { targetIds: ['meta-sc'] },
          priority: 9500,
        }),
      ];

      // SHORT_CIRCUIT runs first (sorted by priority), so it wins
      // Even if inhibition ran, it would only target regular rules
      const conditionResults = new Map([['meta-sc', false]]); // disable SC so inhibition runs
      const result = MetaRuleProcessor.process(rules, conditionResults);

      // The SC meta-rule was not inhibited (meta-rules don't target each other)
      expect(result.rules).toHaveLength(1);
      expect((result.rules[0] as FiscalRule).id).toBe('tva-1');
    });

    it('substitution targeting META_INHIBITION model has no effect', () => {
      const rules = [
        makeFiscalRule({ id: 'tva-1', category: 'TVA' }),
        makeFiscalRule({
          id: 'meta-inhibit',
          model: 'META_INHIBITION',
          params: { targetCategories: ['TVA'] },
        }),
        makeFiscalRule({
          id: 'meta-sub',
          model: 'META_SUBSTITUTION',
          params: { targetModel: 'META_INHIBITION', newParams: { targetCategories: [] } },
        }),
      ];

      const result = MetaRuleProcessor.process(rules, new Map());

      // Inhibition still applied (substitution didn't modify it)
      expect(result.inhibitedIds).toContain('tva-1');
      expect(result.rules).toHaveLength(0);
    });
  });

  // ─── P0.2: Meta-rules without conditions default to true ────────────

  describe('Condition defaults', () => {
    it('meta-rule with no condition entry in conditionResults defaults to true', () => {
      const rules = [
        makeFiscalRule({ id: 'tva-1', category: 'TVA' }),
        makeFiscalRule({
          id: 'inhibit-unconditional',
          model: 'META_INHIBITION',
          params: { targetCategories: ['TVA'] },
        }),
      ];

      // Empty conditionResults — no condition was evaluated for this meta-rule
      const result = MetaRuleProcessor.process(rules, new Map());

      expect(result.inhibitedIds).toContain('tva-1');
      expect(result.rules).toHaveLength(0);
    });

    it('short-circuit with no condition defaults to true', () => {
      const rules = [
        makeFiscalRule({ id: 'tva-1' }),
        makeFiscalRule({
          id: 'sc-unconditional',
          model: 'META_SHORT_CIRCUIT',
          params: { value: 42, reason: 'Universal exemption' },
        }),
      ];

      const result = MetaRuleProcessor.process(rules, new Map());

      expect(result.shortCircuit).toBeDefined();
      expect(result.shortCircuit!.value).toBe(42);
    });

    it('substitution with no condition defaults to true', () => {
      const rules = [
        makeFiscalRule({
          id: 'tva-1',
          model: 'FLAT_RATE',
          params: { rate: 0.18, base: 'revenue' },
        }),
        makeFiscalRule({
          id: 'sub-unconditional',
          model: 'META_SUBSTITUTION',
          params: { targetModel: 'FLAT_RATE', newParams: { rate: 0.05 } },
        }),
      ];

      const result = MetaRuleProcessor.process(rules, new Map());

      expect((result.rules[0] as FiscalRule).params).toEqual({ rate: 0.05, base: 'revenue' });
    });
  });

  // ─── P0.3: Invalid meta-rule params are skipped ──────────────────────

  describe('Invalid params handling', () => {
    it('short-circuit with null params is skipped', () => {
      const rules = [
        makeFiscalRule({ id: 'tva-1' }),
        makeFiscalRule({
          id: 'sc-bad',
          model: 'META_SHORT_CIRCUIT',
          params: null as unknown as Record<string, unknown>,
        }),
      ];

      const result = MetaRuleProcessor.process(rules, new Map());

      expect(result.shortCircuit).toBeUndefined();
      expect(result.rules).toHaveLength(1);
      expect(result.invalidMetaRuleIds).toContain('sc-bad');
    });

    it('short-circuit with missing value is skipped', () => {
      const rules = [
        makeFiscalRule({ id: 'tva-1' }),
        makeFiscalRule({
          id: 'sc-no-value',
          model: 'META_SHORT_CIRCUIT',
          params: { reason: 'no value field' },
        }),
      ];

      const result = MetaRuleProcessor.process(rules, new Map());

      expect(result.shortCircuit).toBeUndefined();
      expect(result.invalidMetaRuleIds).toContain('sc-no-value');
    });

    it('short-circuit with missing reason is skipped', () => {
      const rules = [
        makeFiscalRule({ id: 'tva-1' }),
        makeFiscalRule({
          id: 'sc-no-reason',
          model: 'META_SHORT_CIRCUIT',
          params: { value: 0 },
        }),
      ];

      const result = MetaRuleProcessor.process(rules, new Map());

      expect(result.shortCircuit).toBeUndefined();
      expect(result.invalidMetaRuleIds).toContain('sc-no-reason');
    });

    it('inhibition with empty selectors is skipped', () => {
      const rules = [
        makeFiscalRule({ id: 'tva-1', category: 'TVA' }),
        makeFiscalRule({
          id: 'inhibit-empty',
          model: 'META_INHIBITION',
          params: { targetIds: [], targetTags: [], targetCategories: [] },
        }),
      ];

      const result = MetaRuleProcessor.process(rules, new Map());

      // Rule survives because inhibition had no valid selectors
      expect(result.rules).toHaveLength(1);
      expect(result.invalidMetaRuleIds).toContain('inhibit-empty');
    });

    it('inhibition with null params is skipped', () => {
      const rules = [
        makeFiscalRule({ id: 'tva-1' }),
        makeFiscalRule({
          id: 'inhibit-null',
          model: 'META_INHIBITION',
          params: null as unknown as Record<string, unknown>,
        }),
      ];

      const result = MetaRuleProcessor.process(rules, new Map());

      expect(result.rules).toHaveLength(1);
      expect(result.invalidMetaRuleIds).toContain('inhibit-null');
    });

    it('inhibition with no selectors at all is skipped', () => {
      const rules = [
        makeFiscalRule({ id: 'tva-1' }),
        makeFiscalRule({
          id: 'inhibit-no-selectors',
          model: 'META_INHIBITION',
          params: {},
        }),
      ];

      const result = MetaRuleProcessor.process(rules, new Map());

      expect(result.rules).toHaveLength(1);
      expect(result.invalidMetaRuleIds).toContain('inhibit-no-selectors');
    });

    it('substitution with missing targetModel is skipped', () => {
      const rules = [
        makeFiscalRule({ id: 'tva-1', model: 'FLAT_RATE', params: { rate: 0.18 } }),
        makeFiscalRule({
          id: 'sub-no-target',
          model: 'META_SUBSTITUTION',
          params: { newParams: { rate: 0.05 } },
        }),
      ];

      const result = MetaRuleProcessor.process(rules, new Map());

      // Original params untouched
      expect((result.rules[0] as FiscalRule).params).toEqual({ rate: 0.18 });
      expect(result.invalidMetaRuleIds).toContain('sub-no-target');
    });

    it('substitution with missing newParams is skipped', () => {
      const rules = [
        makeFiscalRule({ id: 'tva-1', model: 'FLAT_RATE', params: { rate: 0.18 } }),
        makeFiscalRule({
          id: 'sub-no-new-params',
          model: 'META_SUBSTITUTION',
          params: { targetModel: 'FLAT_RATE' },
        }),
      ];

      const result = MetaRuleProcessor.process(rules, new Map());

      expect((result.rules[0] as FiscalRule).params).toEqual({ rate: 0.18 });
      expect(result.invalidMetaRuleIds).toContain('sub-no-new-params');
    });

    it('substitution with null params is skipped', () => {
      const rules = [
        makeFiscalRule({ id: 'tva-1', model: 'FLAT_RATE', params: { rate: 0.18 } }),
        makeFiscalRule({
          id: 'sub-null',
          model: 'META_SUBSTITUTION',
          params: null as unknown as Record<string, unknown>,
        }),
      ];

      const result = MetaRuleProcessor.process(rules, new Map());

      expect(result.rules).toHaveLength(1);
      expect(result.invalidMetaRuleIds).toContain('sub-null');
    });

    it('invalid short-circuit is skipped but valid short-circuit still applies', () => {
      const rules = [
        makeFiscalRule({ id: 'tva-1' }),
        makeFiscalRule({
          id: 'sc-invalid',
          model: 'META_SHORT_CIRCUIT',
          params: { value: 'not-a-number' },
          priority: 9999,
        }),
        makeFiscalRule({
          id: 'sc-valid',
          model: 'META_SHORT_CIRCUIT',
          params: { value: 0, reason: 'valid' },
          priority: 5000,
        }),
      ];

      const result = MetaRuleProcessor.process(rules, new Map());

      // Invalid SC skipped, valid SC applies
      expect(result.shortCircuit).toBeDefined();
      expect(result.shortCircuit!.ruleId).toBe('sc-valid');
      expect(result.invalidMetaRuleIds).toContain('sc-invalid');
    });
  });

  // ─── P1.6: Multiple short-circuits — priority-based determinism ─────

  describe('Multiple short-circuits', () => {
    it('highest priority short-circuit wins', () => {
      const rules = [
        makeFiscalRule({ id: 'tva-1' }),
        makeFiscalRule({
          id: 'sc-low-prio',
          model: 'META_SHORT_CIRCUIT',
          params: { value: 100, reason: 'Low priority exemption' },
          priority: 1000,
        }),
        makeFiscalRule({
          id: 'sc-high-prio',
          model: 'META_SHORT_CIRCUIT',
          params: { value: 0, reason: 'High priority exemption' },
          priority: 9999,
        }),
      ];

      const result = MetaRuleProcessor.process(rules, new Map());

      expect(result.shortCircuit!.ruleId).toBe('sc-high-prio');
      expect(result.shortCircuit!.value).toBe(0);
      expect(result.shortCircuit!.reason).toBe('High priority exemption');
    });

    it('if highest priority SC condition is false, next SC takes over', () => {
      const rules = [
        makeFiscalRule({ id: 'tva-1' }),
        makeFiscalRule({
          id: 'sc-high-disabled',
          model: 'META_SHORT_CIRCUIT',
          params: { value: 0, reason: 'Disabled' },
          priority: 9999,
        }),
        makeFiscalRule({
          id: 'sc-mid',
          model: 'META_SHORT_CIRCUIT',
          params: { value: 50, reason: 'Fallback' },
          priority: 5000,
        }),
      ];

      const conditionResults = new Map([['sc-high-disabled', false]]);
      const result = MetaRuleProcessor.process(rules, conditionResults);

      expect(result.shortCircuit!.ruleId).toBe('sc-mid');
      expect(result.shortCircuit!.value).toBe(50);
    });

    it('all short-circuits disabled → no short-circuit, normal flow', () => {
      const rules = [
        makeFiscalRule({ id: 'tva-1' }),
        makeFiscalRule({
          id: 'sc-1',
          model: 'META_SHORT_CIRCUIT',
          params: { value: 0, reason: 'A' },
        }),
        makeFiscalRule({
          id: 'sc-2',
          model: 'META_SHORT_CIRCUIT',
          params: { value: 0, reason: 'B' },
        }),
      ];

      const conditionResults = new Map([
        ['sc-1', false],
        ['sc-2', false],
      ]);
      const result = MetaRuleProcessor.process(rules, conditionResults);

      expect(result.shortCircuit).toBeUndefined();
      expect(result.rules).toHaveLength(1);
    });
  });

  // ─── P1.5: Inhibition runs before substitution ──────────────────────

  describe('Processing order: INHIBITION before SUBSTITUTION', () => {
    it('inhibited rule cannot be substituted', () => {
      const rules = [
        makeFiscalRule({
          id: 'tva-1',
          model: 'FLAT_RATE',
          category: 'TVA',
          params: { rate: 0.18, base: 'revenue' },
        }),
        makeFiscalRule({
          id: 'inhibit-tva',
          model: 'META_INHIBITION',
          params: { targetCategories: ['TVA'] },
          priority: 5000,
        }),
        makeFiscalRule({
          id: 'sub-flat-rate',
          model: 'META_SUBSTITUTION',
          params: { targetModel: 'FLAT_RATE', newParams: { rate: 0.05 } },
          priority: 5000,
        }),
      ];

      const result = MetaRuleProcessor.process(rules, new Map());

      // tva-1 was inhibited first, so substitution has no targets
      expect(result.rules).toHaveLength(0);
      expect(result.inhibitedIds).toContain('tva-1');
      expect(result.substitutedIds).toHaveLength(0);
    });

    it('substitution applies only to rules that survived inhibition', () => {
      const rules = [
        makeFiscalRule({
          id: 'tva-1',
          model: 'FLAT_RATE',
          category: 'TVA',
          params: { rate: 0.18, base: 'revenue' },
        }),
        makeFiscalRule({
          id: 'is-1',
          model: 'FLAT_RATE',
          category: 'IS',
          params: { rate: 0.27, base: 'profit' },
        }),
        makeFiscalRule({
          id: 'inhibit-tva',
          model: 'META_INHIBITION',
          params: { targetCategories: ['TVA'] },
        }),
        makeFiscalRule({
          id: 'sub-all-flat-rate',
          model: 'META_SUBSTITUTION',
          params: { targetModel: 'FLAT_RATE', newParams: { rate: 0.10 } },
        }),
      ];

      const result = MetaRuleProcessor.process(rules, new Map());

      // TVA inhibited, IS survived and got substituted
      expect(result.rules).toHaveLength(1);
      expect(result.inhibitedIds).toContain('tva-1');
      expect(result.substitutedIds).toContain('is-1');
      expect((result.rules[0] as FiscalRule).params).toEqual({ rate: 0.10, base: 'profit' });
    });
  });

  // ─── P2.7: Substitution without selectors matches all of targetModel

  describe('Substitution scope', () => {
    it('no targetIds/targetTags matches ALL rules with targetModel', () => {
      const rules = [
        makeFiscalRule({
          id: 'flat-1',
          model: 'FLAT_RATE',
          params: { rate: 0.18, base: 'a' },
        }),
        makeFiscalRule({
          id: 'flat-2',
          model: 'FLAT_RATE',
          params: { rate: 0.25, base: 'b' },
        }),
        makeFiscalRule({
          id: 'bracket-1',
          model: 'PROGRESSIVE_BRACKET',
          params: { base: 'x', brackets: [] },
        }),
        makeFiscalRule({
          id: 'sub-all-flat',
          model: 'META_SUBSTITUTION',
          params: { targetModel: 'FLAT_RATE', newParams: { rate: 0.10 } },
        }),
      ];

      const result = MetaRuleProcessor.process(rules, new Map());

      expect(result.substitutedIds).toContain('flat-1');
      expect(result.substitutedIds).toContain('flat-2');
      expect(result.substitutedIds).not.toContain('bracket-1');
      expect((result.rules[0] as FiscalRule).params).toEqual({ rate: 0.10, base: 'a' });
      expect((result.rules[1] as FiscalRule).params).toEqual({ rate: 0.10, base: 'b' });
    });

    it('targetIds restricts substitution to specific rules', () => {
      const rules = [
        makeFiscalRule({
          id: 'flat-1',
          model: 'FLAT_RATE',
          params: { rate: 0.18, base: 'a' },
        }),
        makeFiscalRule({
          id: 'flat-2',
          model: 'FLAT_RATE',
          params: { rate: 0.25, base: 'b' },
        }),
        makeFiscalRule({
          id: 'sub-specific',
          model: 'META_SUBSTITUTION',
          params: {
            targetModel: 'FLAT_RATE',
            targetIds: ['flat-1'],
            newParams: { rate: 0.05 },
          },
        }),
      ];

      const result = MetaRuleProcessor.process(rules, new Map());

      expect(result.substitutedIds).toEqual(['flat-1']);
      expect((result.rules[0] as FiscalRule).params).toEqual({ rate: 0.05, base: 'a' });
      expect((result.rules[1] as FiscalRule).params).toEqual({ rate: 0.25, base: 'b' });
    });
  });

  // ─── Priority-based determinism for inhibitions ─────────────────────

  describe('Inhibition priority ordering', () => {
    it('higher priority inhibition runs first', () => {
      const rules = [
        makeFiscalRule({ id: 'r1', category: 'TVA', tags: ['tag-a'] }),
        makeFiscalRule({ id: 'r2', category: 'IS', tags: ['tag-a'] }),
        // Low-prio inhibition by tag (would hit r1 and r2)
        makeFiscalRule({
          id: 'inhibit-by-tag',
          model: 'META_INHIBITION',
          params: { targetTags: ['tag-a'] },
          priority: 1000,
        }),
        // High-prio inhibition by category (hits only TVA)
        makeFiscalRule({
          id: 'inhibit-by-cat',
          model: 'META_INHIBITION',
          params: { targetCategories: ['TVA'] },
          priority: 9000,
        }),
      ];

      const result = MetaRuleProcessor.process(rules, new Map());

      // Both r1 and r2 end up inhibited, but the order of actions matters
      expect(result.inhibitedIds).toContain('r1');
      expect(result.inhibitedIds).toContain('r2');

      // First action is the high-priority one
      expect(result.actions[0]!.metaRuleId).toBe('inhibit-by-cat');
      expect(result.actions[1]!.metaRuleId).toBe('inhibit-by-tag');
    });
  });

  // ─── Extreme: many meta-rules, complex interactions ─────────────────

  describe('Complex scenarios', () => {
    it('10+ meta-rules interact correctly', () => {
      const rules = [
        // Regular rules
        makeFiscalRule({ id: 'tva-std', category: 'TVA', model: 'FLAT_RATE', params: { rate: 0.18 } }),
        makeFiscalRule({ id: 'tva-lux', category: 'TVA_LUXURY', model: 'FLAT_RATE', params: { rate: 0.25 } }),
        makeFiscalRule({ id: 'is-1', category: 'IS', model: 'FLAT_RATE', params: { rate: 0.27 } }),
        makeFiscalRule({ id: 'is-2', category: 'IS_SPECIAL', model: 'FLAT_RATE', params: { rate: 0.05 } }),
        makeFiscalRule({ id: 'irpp', category: 'IRPP', model: 'PROGRESSIVE_BRACKET', params: { brackets: [] } }),
        makeFiscalRule({ id: 'cnss', category: 'CNSS', model: 'COMPOSITE', params: { steps: [] } }),
        makeFiscalRule({ id: 'timbre', category: 'TIMBRE', model: 'FIXED_AMOUNT', params: { amount: 5000 } }),

        // Meta: inhibit TVA and IS_SPECIAL
        makeFiscalRule({
          id: 'meta-inhibit-1',
          model: 'META_INHIBITION',
          params: { targetCategories: ['TVA', 'IS_SPECIAL'] },
          priority: 9000,
        }),
        // Meta: inhibit TVA_LUXURY (separate meta-rule)
        makeFiscalRule({
          id: 'meta-inhibit-2',
          model: 'META_INHIBITION',
          params: { targetCategories: ['TVA_LUXURY'] },
          priority: 8000,
        }),
        // Meta: substitute IS rate
        makeFiscalRule({
          id: 'meta-sub-is',
          model: 'META_SUBSTITUTION',
          params: { targetModel: 'FLAT_RATE', targetIds: ['is-1'], newParams: { rate: 0.15 } },
          priority: 7000,
        }),
      ];

      const result = MetaRuleProcessor.process(rules, new Map());

      // Inhibited: tva-std, tva-lux, is-2
      expect(result.inhibitedIds).toContain('tva-std');
      expect(result.inhibitedIds).toContain('tva-lux');
      expect(result.inhibitedIds).toContain('is-2');

      // Surviving: is-1 (substituted), irpp, cnss, timbre
      expect(result.rules).toHaveLength(4);
      const ids = result.rules.map((r) => (r as FiscalRule).id);
      expect(ids).toContain('is-1');
      expect(ids).toContain('irpp');
      expect(ids).toContain('cnss');
      expect(ids).toContain('timbre');

      // IS rate substituted
      const isRule = result.rules.find((r) => (r as FiscalRule).id === 'is-1') as FiscalRule;
      expect((isRule.params as Record<string, unknown>).rate).toBe(0.15);
    });

    it('chain: inhibition removes all FLAT_RATE targets before substitution', () => {
      const rules = [
        makeFiscalRule({
          id: 'flat-1',
          model: 'FLAT_RATE',
          category: 'TVA',
          params: { rate: 0.18 },
        }),
        makeFiscalRule({
          id: 'flat-2',
          model: 'FLAT_RATE',
          category: 'IS',
          params: { rate: 0.27 },
        }),
        // Inhibit ALL TVA + IS
        makeFiscalRule({
          id: 'inhibit-all',
          model: 'META_INHIBITION',
          params: { targetCategories: ['TVA', 'IS'] },
        }),
        // Substitution has nothing to act on
        makeFiscalRule({
          id: 'sub-flat',
          model: 'META_SUBSTITUTION',
          params: { targetModel: 'FLAT_RATE', newParams: { rate: 0 } },
        }),
      ];

      const result = MetaRuleProcessor.process(rules, new Map());

      expect(result.rules).toHaveLength(0);
      expect(result.substitutedIds).toHaveLength(0);
      expect(result.inhibitedIds).toHaveLength(2);
    });

    it('multiple substitutions stack (later subs override earlier ones)', () => {
      const rules = [
        makeFiscalRule({
          id: 'flat-1',
          model: 'FLAT_RATE',
          params: { rate: 0.18, base: 'revenue' },
        }),
        // First sub: rate → 0.10 (high priority)
        makeFiscalRule({
          id: 'sub-1',
          model: 'META_SUBSTITUTION',
          params: { targetModel: 'FLAT_RATE', newParams: { rate: 0.10 } },
          priority: 9000,
        }),
        // Second sub: rate → 0.05 (lower priority, runs after)
        makeFiscalRule({
          id: 'sub-2',
          model: 'META_SUBSTITUTION',
          params: { targetModel: 'FLAT_RATE', newParams: { rate: 0.05 } },
          priority: 5000,
        }),
      ];

      const result = MetaRuleProcessor.process(rules, new Map());

      // sub-1 runs first (higher prio), then sub-2 overrides
      expect((result.rules[0] as FiscalRule).params).toEqual({ rate: 0.05, base: 'revenue' });
      expect(result.substitutedIds).toContain('flat-1');
    });

    it('only the first valid short-circuit matters (rest are irrelevant)', () => {
      const rules = [
        makeFiscalRule({ id: 'tva-1' }),
        makeFiscalRule({
          id: 'sc-winner',
          model: 'META_SHORT_CIRCUIT',
          params: { value: 0, reason: 'Winner' },
          priority: 9999,
        }),
        makeFiscalRule({
          id: 'sc-loser',
          model: 'META_SHORT_CIRCUIT',
          params: { value: 999, reason: 'Loser' },
          priority: 1000,
        }),
        // These never run because short-circuit stops everything
        makeFiscalRule({
          id: 'inhibit-something',
          model: 'META_INHIBITION',
          params: { targetCategories: ['TVA'] },
        }),
        makeFiscalRule({
          id: 'sub-something',
          model: 'META_SUBSTITUTION',
          params: { targetModel: 'FLAT_RATE', newParams: { rate: 0 } },
        }),
      ];

      const result = MetaRuleProcessor.process(rules, new Map());

      expect(result.shortCircuit!.ruleId).toBe('sc-winner');
      expect(result.actions).toHaveLength(1); // Only the SC action
      expect(result.actions[0]!.type).toBe('SHORT_CIRCUIT');
    });
  });

  // ─── Edge cases ─────────────────────────────────────────────────────

  describe('Edge cases', () => {
    it('empty rules array → empty result', () => {
      const result = MetaRuleProcessor.process([], new Map());

      expect(result.rules).toHaveLength(0);
      expect(result.actions).toHaveLength(0);
      expect(result.shortCircuit).toBeUndefined();
      expect(result.invalidMetaRuleIds).toHaveLength(0);
    });

    it('only meta-rules, no regular rules → empty result', () => {
      const rules = [
        makeFiscalRule({
          id: 'inhibit-something',
          model: 'META_INHIBITION',
          params: { targetCategories: ['TVA'] },
        }),
        makeFiscalRule({
          id: 'sub-something',
          model: 'META_SUBSTITUTION',
          params: { targetModel: 'FLAT_RATE', newParams: { rate: 0 } },
        }),
      ];

      const result = MetaRuleProcessor.process(rules, new Map());

      expect(result.rules).toHaveLength(0);
      expect(result.inhibitedIds).toHaveLength(0);
      expect(result.substitutedIds).toHaveLength(0);
    });

    it('short-circuit with value=0 is valid (NGO exemption)', () => {
      const rules = [
        makeFiscalRule({ id: 'tva-1' }),
        makeFiscalRule({ id: 'is-1' }),
        makeFiscalRule({
          id: 'ngo-exempt',
          model: 'META_SHORT_CIRCUIT',
          params: { value: 0, reason: 'NGO fully exempt' },
        }),
      ];

      const result = MetaRuleProcessor.process(rules, new Map());

      expect(result.shortCircuit!.value).toBe(0);
      expect(result.inhibitedIds).toHaveLength(2);
    });

    it('short-circuit with negative value is valid', () => {
      const rules = [
        makeFiscalRule({ id: 'tva-1' }),
        makeFiscalRule({
          id: 'refund',
          model: 'META_SHORT_CIRCUIT',
          params: { value: -50000, reason: 'Tax refund' },
        }),
      ];

      const result = MetaRuleProcessor.process(rules, new Map());

      expect(result.shortCircuit!.value).toBe(-50000);
    });

    it('inhibition by ID that does not exist → no action emitted', () => {
      const rules = [
        makeFiscalRule({ id: 'tva-1' }),
        makeFiscalRule({
          id: 'inhibit-ghost',
          model: 'META_INHIBITION',
          params: { targetIds: ['nonexistent-rule'] },
        }),
      ];

      const result = MetaRuleProcessor.process(rules, new Map());

      expect(result.rules).toHaveLength(1);
      expect(result.actions).toHaveLength(0); // No action because nothing was actually inhibited
    });

    it('substitution targeting nonexistent model → no action emitted', () => {
      const rules = [
        makeFiscalRule({ id: 'tva-1', model: 'FLAT_RATE', params: { rate: 0.18 } }),
        makeFiscalRule({
          id: 'sub-ghost-model',
          model: 'META_SUBSTITUTION',
          params: { targetModel: 'DOES_NOT_EXIST', newParams: { rate: 0 } },
        }),
      ];

      const result = MetaRuleProcessor.process(rules, new Map());

      expect(result.rules).toHaveLength(1);
      expect(result.substitutedIds).toHaveLength(0);
    });

    it('all conditions false → all meta-rules disabled, regular rules untouched', () => {
      const rules = [
        makeFiscalRule({ id: 'tva-1', category: 'TVA' }),
        makeFiscalRule({
          id: 'sc',
          model: 'META_SHORT_CIRCUIT',
          params: { value: 0, reason: 'test' },
        }),
        makeFiscalRule({
          id: 'inhibit',
          model: 'META_INHIBITION',
          params: { targetCategories: ['TVA'] },
        }),
        makeFiscalRule({
          id: 'sub',
          model: 'META_SUBSTITUTION',
          params: { targetModel: 'FLAT_RATE', newParams: { rate: 0 } },
        }),
      ];

      const conditionResults = new Map([
        ['sc', false],
        ['inhibit', false],
        ['sub', false],
      ]);
      const result = MetaRuleProcessor.process(rules, conditionResults);

      expect(result.rules).toHaveLength(1);
      expect(result.shortCircuit).toBeUndefined();
      expect(result.inhibitedIds).toHaveLength(0);
      expect(result.substitutedIds).toHaveLength(0);
    });
  });
});
