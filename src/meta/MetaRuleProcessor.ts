import type { Rule } from '@run-iq/core';
import type { FiscalRule } from '../types/fiscal-rule.js';
import type { InhibitionParams, SubstitutionParams, ShortCircuitParams } from '../types/meta-params.js';

export interface MetaAction {
  readonly metaRuleId: string;
  readonly type: 'INHIBITION' | 'SUBSTITUTION' | 'SHORT_CIRCUIT';
  readonly targetIds: readonly string[];
  readonly reason?: string;
  readonly value?: number;
}

export interface MetaRuleResult {
  /** Remaining rules after meta-rule processing */
  readonly rules: ReadonlyArray<Rule>;
  /** Granular actions performed by meta-rules */
  readonly actions: readonly MetaAction[];
  /** Shortcut for short-circuit result */
  readonly shortCircuit?: { readonly value: number; readonly reason: string; readonly ruleId: string };
}

const META_MODELS = new Set(['META_INHIBITION', 'META_SUBSTITUTION', 'META_SHORT_CIRCUIT']);

export class MetaRuleProcessor {
  static process(
    rules: ReadonlyArray<Rule>,
    conditionResults: ReadonlyMap<string, boolean>,
  ): MetaRuleResult {
    const fiscalRules = rules as ReadonlyArray<FiscalRule>;
    const metaRules = fiscalRules.filter((r) => META_MODELS.has(r.model));
    let regularRules = fiscalRules.filter((r) => !META_MODELS.has(r.model));

    const actions: MetaAction[] = [];

    // 1. SHORT_CIRCUIT
    for (const meta of metaRules.filter((r) => r.model === 'META_SHORT_CIRCUIT')) {
      if (conditionResults.get(meta.id)) {
        const params = meta.params as unknown as ShortCircuitParams;
        return {
          rules: [],
          actions: [{
            metaRuleId: meta.id,
            type: 'SHORT_CIRCUIT',
            targetIds: regularRules.map(r => r.id),
            reason: params.reason,
            value: params.value
          }],
          shortCircuit: { value: params.value, reason: params.reason, ruleId: meta.id },
        };
      }
    }

    // 2. INHIBITION
    for (const meta of metaRules.filter((r) => r.model === 'META_INHIBITION')) {
      if (!conditionResults.get(meta.id)) continue;

      const params = meta.params as unknown as InhibitionParams;
      const inhibitedInThisStep: string[] = [];
      
      regularRules = regularRules.filter((rule) => {
        const shouldInhibit = MetaRuleProcessor.matchesTarget(rule, params);
        if (shouldInhibit) inhibitedInThisStep.push(rule.id);
        return !shouldInhibit;
      });

      if (inhibitedInThisStep.length > 0) {
        actions.push({
          metaRuleId: meta.id,
          type: 'INHIBITION',
          targetIds: inhibitedInThisStep
        });
      }
    }

    // 3. SUBSTITUTION
    for (const meta of metaRules.filter((r) => r.model === 'META_SUBSTITUTION')) {
      if (!conditionResults.get(meta.id)) continue;

      const params = meta.params as unknown as SubstitutionParams;
      const substitutedInThisStep: string[] = [];

      regularRules = regularRules.map((rule) => {
        if (MetaRuleProcessor.matchesSubstitutionTarget(rule, params)) {
          substitutedInThisStep.push(rule.id);
          return { ...rule, params: params.newParams } as unknown as FiscalRule;
        }
        return rule;
      });

      if (substitutedInThisStep.length > 0) {
        actions.push({
          metaRuleId: meta.id,
          type: 'SUBSTITUTION',
          targetIds: substitutedInThisStep
        });
      }
    }

    return {
      rules: regularRules as unknown as Rule[],
      actions,
    };
  }

  private static matchesTarget(rule: FiscalRule, params: InhibitionParams): boolean {
    if (params.targetIds?.includes(rule.id)) return true;
    if (params.targetTags?.some((tag) => rule.tags.includes(tag))) return true;
    if (params.targetCategories?.includes(rule.category)) return true;
    return false;
  }

  private static matchesSubstitutionTarget(rule: FiscalRule, params: SubstitutionParams): boolean {
    if (rule.model !== params.targetModel) return false;
    if (params.targetIds?.length) return params.targetIds.includes(rule.id);
    if (params.targetTags?.length) return params.targetTags.some((tag) => rule.tags.includes(tag));
    return true;
  }
}
