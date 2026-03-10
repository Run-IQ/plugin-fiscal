import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import type { Rule } from '@run-iq/core';
import { MetaRuleProcessor } from '../../src/meta/MetaRuleProcessor.js';
import type { FiscalRule } from '../../src/types/fiscal-rule.js';

function checksum(params: unknown): string {
  return createHash('sha256').update(JSON.stringify(params)).digest('hex');
}

function makeFiscalRule(overrides: Partial<FiscalRule> & { id: string }): Rule {
  const params = overrides.params ?? { rate: 0.18, base: 'amount' };
  return {
    version: 1,
    model: 'FLAT_RATE',
    priority: 100,
    effectiveFrom: new Date('2024-01-01'),
    effectiveUntil: null,
    tags: [],
    checksum: checksum(params),
    params,
    jurisdiction: 'NATIONAL',
    scope: 'GLOBAL',
    country: 'TG',
    category: 'TVA',
    ...overrides,
  } as unknown as Rule;
}

describe('MetaRuleProcessor', () => {
  describe('META_INHIBITION', () => {
    it('inhibits rules by tags', () => {
      const rules = [
        makeFiscalRule({ id: 'tva-1', tags: ['tva'], category: 'TVA' }),
        makeFiscalRule({
          id: 'irpp-1',
          tags: ['irpp'],
          category: 'IRPP',
          model: 'PROGRESSIVE_BRACKET',
        }),
        makeFiscalRule({
          id: 'inhibit-tva',
          model: 'META_INHIBITION',
          params: { targetTags: ['tva'] },
        }),
      ];

      const result = MetaRuleProcessor.process(rules, new Map());

      expect(result.rules).toHaveLength(1);
      expect((result.rules[0] as FiscalRule).id).toBe('irpp-1');
      expect(result.inhibitedIds).toContain('tva-1');
    });

    it('inhibits rules by IDs', () => {
      const rules = [
        makeFiscalRule({ id: 'tva-1' }),
        makeFiscalRule({ id: 'tva-2' }),
        makeFiscalRule({
          id: 'inhibit-specific',
          model: 'META_INHIBITION',
          params: { targetIds: ['tva-1'] },
        }),
      ];

      const result = MetaRuleProcessor.process(rules, new Map());

      expect(result.rules).toHaveLength(1);
      expect((result.rules[0] as FiscalRule).id).toBe('tva-2');
      expect(result.inhibitedIds).toEqual(['tva-1']);
    });

    it('inhibits rules by categories', () => {
      const rules = [
        makeFiscalRule({ id: 'tva-1', category: 'TVA' }),
        makeFiscalRule({ id: 'is-1', category: 'IS' }),
        makeFiscalRule({
          id: 'inhibit-tva-cat',
          model: 'META_INHIBITION',
          params: { targetCategories: ['TVA'] },
        }),
      ];

      const result = MetaRuleProcessor.process(rules, new Map());

      expect(result.rules).toHaveLength(1);
      expect((result.rules[0] as FiscalRule).category).toBe('IS');
    });

    it('skips inhibition when condition is false', () => {
      const rules = [
        makeFiscalRule({ id: 'tva-1', tags: ['tva'] }),
        makeFiscalRule({
          id: 'conditional-inhibit',
          model: 'META_INHIBITION',
          params: { targetTags: ['tva'] },
        }),
      ];

      const conditionResults = new Map([['conditional-inhibit', false]]);
      const result = MetaRuleProcessor.process(rules, conditionResults);

      expect(result.rules).toHaveLength(1);
      expect((result.rules[0] as FiscalRule).id).toBe('tva-1');
      expect(result.inhibitedIds).toHaveLength(0);
    });

    it('handles no matching targets gracefully', () => {
      const rules = [
        makeFiscalRule({ id: 'tva-1', tags: ['tva'] }),
        makeFiscalRule({
          id: 'inhibit-nonexistent',
          model: 'META_INHIBITION',
          params: { targetTags: ['luxury'] },
        }),
      ];

      const result = MetaRuleProcessor.process(rules, new Map());

      expect(result.rules).toHaveLength(1);
      expect(result.inhibitedIds).toHaveLength(0);
    });
  });

  describe('META_SUBSTITUTION', () => {
    it('substitutes params of matching rules by model', () => {
      const rules = [
        makeFiscalRule({
          id: 'tva-standard',
          model: 'FLAT_RATE',
          params: { rate: 0.18, base: 'revenue' },
        }),
        makeFiscalRule({
          id: 'sub-essential',
          model: 'META_SUBSTITUTION',
          params: { targetModel: 'FLAT_RATE', newParams: { rate: 0.05, base: 'revenue' } },
        }),
      ];

      const result = MetaRuleProcessor.process(rules, new Map());

      expect(result.rules).toHaveLength(1);
      const substituted = result.rules[0] as FiscalRule;
      expect(substituted.id).toBe('tva-standard');
      expect((substituted.params as { rate: number }).rate).toBe(0.05);
      expect(result.substitutedIds).toContain('tva-standard');
    });

    it('substitutes only rules matching target tags', () => {
      const rules = [
        makeFiscalRule({
          id: 'tva-standard',
          model: 'FLAT_RATE',
          tags: ['tva'],
          params: { rate: 0.18, base: 'revenue' },
        }),
        makeFiscalRule({
          id: 'tva-luxury',
          model: 'FLAT_RATE',
          tags: ['luxury'],
          params: { rate: 0.25, base: 'revenue' },
        }),
        makeFiscalRule({
          id: 'sub-tva-only',
          model: 'META_SUBSTITUTION',
          params: {
            targetModel: 'FLAT_RATE',
            targetTags: ['tva'],
            newParams: { rate: 0.1, base: 'revenue' },
          },
        }),
      ];

      const result = MetaRuleProcessor.process(rules, new Map());

      expect(result.rules).toHaveLength(2);
      const tvaRule = result.rules.find(
        (r) => (r as FiscalRule).id === 'tva-standard',
      ) as FiscalRule;
      const luxuryRule = result.rules.find(
        (r) => (r as FiscalRule).id === 'tva-luxury',
      ) as FiscalRule;
      expect((tvaRule.params as { rate: number }).rate).toBe(0.1);
      expect((luxuryRule.params as { rate: number }).rate).toBe(0.25); // untouched
    });
  });

  describe('META_SHORT_CIRCUIT', () => {
    it('short-circuits and returns empty rules', () => {
      const rules = [
        makeFiscalRule({ id: 'tva-1' }),
        makeFiscalRule({ id: 'irpp-1' }),
        makeFiscalRule({
          id: 'exempt-ngo',
          model: 'META_SHORT_CIRCUIT',
          params: { value: 0, reason: 'NGO exempt from all taxes' },
        }),
      ];

      const result = MetaRuleProcessor.process(rules, new Map());

      expect(result.rules).toHaveLength(0);
      expect(result.shortCircuit).toBeDefined();
      expect(result.shortCircuit!.value).toBe(0);
      expect(result.shortCircuit!.reason).toBe('NGO exempt from all taxes');
      expect(result.inhibitedIds).toContain('tva-1');
      expect(result.inhibitedIds).toContain('irpp-1');
    });

    it('skips short-circuit when condition is false', () => {
      const rules = [
        makeFiscalRule({ id: 'tva-1' }),
        makeFiscalRule({
          id: 'conditional-sc',
          model: 'META_SHORT_CIRCUIT',
          params: { value: 0, reason: 'Not applicable' },
        }),
      ];

      const conditionResults = new Map([['conditional-sc', false]]);
      const result = MetaRuleProcessor.process(rules, conditionResults);

      expect(result.rules).toHaveLength(1);
      expect(result.shortCircuit).toBeUndefined();
    });
  });

  describe('Combined meta-rules', () => {
    it('processes inhibition + substitution together', () => {
      const rules = [
        makeFiscalRule({
          id: 'tva-1',
          tags: ['tva'],
          category: 'TVA',
          model: 'FLAT_RATE',
          params: { rate: 0.18, base: 'revenue' },
        }),
        makeFiscalRule({
          id: 'is-1',
          tags: ['is'],
          category: 'IS',
          model: 'FLAT_RATE',
          params: { rate: 0.27, base: 'profit' },
        }),
        makeFiscalRule({
          id: 'inhibit-tva',
          model: 'META_INHIBITION',
          params: { targetCategories: ['TVA'] },
        }),
        makeFiscalRule({
          id: 'reduce-is',
          model: 'META_SUBSTITUTION',
          params: { targetModel: 'FLAT_RATE', newParams: { rate: 0.15, base: 'profit' } },
        }),
      ];

      const result = MetaRuleProcessor.process(rules, new Map());

      // TVA inhibited, IS substituted
      expect(result.rules).toHaveLength(1);
      const isRule = result.rules[0] as FiscalRule;
      expect(isRule.id).toBe('is-1');
      expect((isRule.params as { rate: number }).rate).toBe(0.15);
      expect(result.inhibitedIds).toContain('tva-1');
      expect(result.substitutedIds).toContain('is-1');
    });

    it('short-circuit takes precedence over inhibition and substitution', () => {
      const rules = [
        makeFiscalRule({ id: 'tva-1' }),
        makeFiscalRule({
          id: 'inhibit-something',
          model: 'META_INHIBITION',
          params: { targetTags: ['tva'] },
        }),
        makeFiscalRule({
          id: 'short-circuit',
          model: 'META_SHORT_CIRCUIT',
          params: { value: 0, reason: 'Total exemption' },
        }),
      ];

      const result = MetaRuleProcessor.process(rules, new Map());

      // Short-circuit found first => everything stops
      expect(result.rules).toHaveLength(0);
      expect(result.shortCircuit).toBeDefined();
      expect(result.shortCircuit!.value).toBe(0);
    });

    it('handles empty rules', () => {
      const result = MetaRuleProcessor.process([], new Map());

      expect(result.rules).toHaveLength(0);
      expect(result.shortCircuit).toBeUndefined();
      expect(result.inhibitedIds).toHaveLength(0);
      expect(result.substitutedIds).toHaveLength(0);
    });

    it('handles rules with no meta-rules', () => {
      const rules = [makeFiscalRule({ id: 'tva-1' }), makeFiscalRule({ id: 'irpp-1' })];

      const result = MetaRuleProcessor.process(rules, new Map());

      expect(result.rules).toHaveLength(2);
      expect(result.inhibitedIds).toHaveLength(0);
      expect(result.substitutedIds).toHaveLength(0);
    });
  });
});
