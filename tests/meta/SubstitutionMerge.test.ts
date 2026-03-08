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

describe('MetaRuleProcessor - Substitution Merge', () => {
  it('deep merges substituted params instead of replacing them', () => {
    const rules = [
      makeFiscalRule({ 
        id: 'is-progressive', 
        model: 'PROGRESSIVE_BRACKET', 
        params: { 
          base: 'profit', 
          brackets: [
            { from: 0, to: 5000000, rate: 0.1 }, 
            { from: 5000000, to: null, rate: 0.2 }
          ] 
        } 
      }),
      makeFiscalRule({
        id: 'sub-base-only',
        model: 'META_SUBSTITUTION',
        params: { 
          targetModel: 'PROGRESSIVE_BRACKET', 
          targetIds: ['is-progressive'], 
          newParams: { base: 'revenue' } 
        },
      }),
    ];

    const result = MetaRuleProcessor.process(rules, new Map());

    expect(result.rules).toHaveLength(1);
    const substituted = result.rules[0] as FiscalRule;
    
    // Check that base was updated
    expect((substituted.params as any).base).toBe('revenue');
    
    // Check that brackets were preserved (Deep Merge behavior)
    expect((substituted.params as any).brackets).toHaveLength(2);
    expect((substituted.params as any).brackets[0].rate).toBe(0.1);
  });
});
