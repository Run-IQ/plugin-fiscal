import type { Rule } from '@run-iq/core';
import type { FiscalRule } from '../types/fiscal-rule.js';
import type { InhibitionParams, SubstitutionParams, ShortCircuitParams } from '../types/meta-params.js';

export interface MetaRuleResult {
  /** Remaining rules after meta-rule processing (meta-rules removed) */
  readonly rules: ReadonlyArray<Rule>;
  /** Short-circuit result if META_SHORT_CIRCUIT matched */
  readonly shortCircuit?: { readonly value: number; readonly reason: string };
  /** IDs of rules that were inhibited */
  readonly inhibitedIds: readonly string[];
  /** IDs of rules whose params were substituted */
  readonly substitutedIds: readonly string[];
}

const META_MODELS = new Set(['META_INHIBITION', 'META_SUBSTITUTION', 'META_SHORT_CIRCUIT']);

/**
 * Stateless processor for meta-rules.
 * Meta-rules are processed in a deterministic order:
 * 1. META_SHORT_CIRCUIT — stops everything if condition matches
 * 2. META_INHIBITION — removes matching rules
 * 3. META_SUBSTITUTION — replaces params of matching rules
 *
 * All meta-rules are then removed from the rules array — they are not calculation models.
 */
export class MetaRuleProcessor {
  /**
   * Process meta-rules and return modified rule set.
   * This is a pure function with no side effects.
   */
  static process(
    rules: ReadonlyArray<Rule>,
    conditionResults: ReadonlyMap<string, boolean>,
  ): MetaRuleResult {
    const fiscalRules = rules as ReadonlyArray<FiscalRule>;

    // Separate meta-rules from regular rules
    const metaRules = fiscalRules.filter((r) => META_MODELS.has(r.model));
    let regularRules = fiscalRules.filter((r) => !META_MODELS.has(r.model));

    const inhibitedIds: string[] = [];
    const substitutedIds: string[] = [];

    // 1. SHORT_CIRCUIT — if any active short-circuit matches, stop everything
    for (const meta of metaRules.filter((r) => r.model === 'META_SHORT_CIRCUIT')) {
      const conditionMet = conditionResults.get(meta.id) ?? true;
      if (conditionMet) {
        const params = meta.params as unknown as ShortCircuitParams;
        return {
          rules: [],
          shortCircuit: { value: params.value, reason: params.reason },
          inhibitedIds: regularRules.map((r) => r.id),
          substitutedIds: [],
        };
      }
    }

    // 2. INHIBITION — remove matching regular rules
    for (const meta of metaRules.filter((r) => r.model === 'META_INHIBITION')) {
      const conditionMet = conditionResults.get(meta.id) ?? true;
      if (!conditionMet) continue;

      const params = meta.params as unknown as InhibitionParams;
      regularRules = regularRules.filter((rule) => {
        const shouldInhibit = MetaRuleProcessor.matchesTarget(rule, params);
        if (shouldInhibit) {
          inhibitedIds.push(rule.id);
        }
        return !shouldInhibit;
      });
    }

    // 3. SUBSTITUTION — replace params of matching regular rules
    for (const meta of metaRules.filter((r) => r.model === 'META_SUBSTITUTION')) {
      const conditionMet = conditionResults.get(meta.id) ?? true;
      if (!conditionMet) continue;

      const params = meta.params as unknown as SubstitutionParams;
      regularRules = regularRules.map((rule) => {
        const shouldSubstitute = MetaRuleProcessor.matchesSubstitutionTarget(rule, params);
        if (shouldSubstitute) {
          substitutedIds.push(rule.id);
          return { ...rule, params: params.newParams } as unknown as FiscalRule;
        }
        return rule;
      });
    }

    return {
      rules: regularRules as unknown as Rule[],
      inhibitedIds,
      substitutedIds,
    };
  }

  /** Check if a rule matches inhibition targeting criteria */
  private static matchesTarget(
    rule: FiscalRule,
    params: InhibitionParams,
  ): boolean {
    if (params.targetIds && params.targetIds.includes(rule.id)) {
      return true;
    }
    if (params.targetTags && params.targetTags.some((tag) => rule.tags.includes(tag))) {
      return true;
    }
    if (params.targetCategories && params.targetCategories.includes(rule.category)) {
      return true;
    }
    return false;
  }

  /** Check if a rule matches substitution targeting criteria */
  private static matchesSubstitutionTarget(
    rule: FiscalRule,
    params: SubstitutionParams,
  ): boolean {
    // Must match target model
    if (rule.model !== params.targetModel) {
      return false;
    }
    // If specific IDs/tags given, match at least one
    if (params.targetIds && params.targetIds.length > 0) {
      return params.targetIds.includes(rule.id);
    }
    if (params.targetTags && params.targetTags.length > 0) {
      return params.targetTags.some((tag) => rule.tags.includes(tag));
    }
    // No further filter — all rules with matching model are substituted
    return true;
  }
}
