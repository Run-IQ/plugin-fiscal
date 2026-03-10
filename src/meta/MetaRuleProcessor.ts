import type { Rule } from '@run-iq/core';
import type { FiscalRule } from '../types/fiscal-rule.js';
import type {
  InhibitionParams,
  SubstitutionParams,
  ShortCircuitParams,
} from '../types/meta-params.js';
import { deepMerge } from '../utils/index.js';

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
  readonly shortCircuit?: {
    readonly value: number;
    readonly reason: string;
    readonly ruleId: string;
  };
  /** IDs of rules that were inhibited (for compatibility) */
  readonly inhibitedIds: string[];
  /** IDs of rules that were substituted (for compatibility) */
  readonly substitutedIds: string[];
  /** IDs of meta-rules that were skipped due to invalid params */
  readonly invalidMetaRuleIds: string[];
}

const META_MODELS = new Set(['META_INHIBITION', 'META_SUBSTITUTION', 'META_SHORT_CIRCUIT']);

/**
 * Processes meta-rules in a strict deterministic order:
 *   1. SHORT_CIRCUIT  (highest priority wins — sorted descending by priority)
 *   2. INHIBITION     (sorted descending by priority — removes rules from pool)
 *   3. SUBSTITUTION   (sorted descending by priority — merges params into remaining rules)
 *
 * Meta-rules NEVER target other meta-rules — they only operate on regular rules.
 * Meta-rules with invalid params are silently skipped and reported in `invalidMetaRuleIds`.
 * A meta-rule without a condition defaults to `true` (always applies).
 */
export class MetaRuleProcessor {
  static process(
    rules: ReadonlyArray<Rule>,
    conditionResults: ReadonlyMap<string, boolean>,
  ): MetaRuleResult {
    const fiscalRules = rules as ReadonlyArray<FiscalRule>;
    const metaRules = fiscalRules.filter((r) => META_MODELS.has(r.model));
    let regularRules = fiscalRules.filter((r) => !META_MODELS.has(r.model));

    const actions: MetaAction[] = [];
    const invalidMetaRuleIds: string[] = [];

    // Sort helper: descending by priority for deterministic processing
    const byPriorityDesc = (a: FiscalRule, b: FiscalRule): number =>
      (b.priority ?? 0) - (a.priority ?? 0);

    // ─── 1. SHORT_CIRCUIT ──────────────────────────────────────────────
    // Multiple short-circuits possible: sort by priority, highest wins
    const shortCircuits = metaRules
      .filter((r) => r.model === 'META_SHORT_CIRCUIT')
      .sort(byPriorityDesc);

    for (const meta of shortCircuits) {
      const shouldApply = conditionResults.has(meta.id) ? conditionResults.get(meta.id) : true;
      if (!shouldApply) continue;

      const params = meta.params as unknown as ShortCircuitParams;
      if (!MetaRuleProcessor.isValidShortCircuitParams(params)) {
        invalidMetaRuleIds.push(meta.id);
        continue;
      }

      const inhibitedIds = regularRules.map((r) => r.id);
      return {
        rules: [],
        actions: [
          {
            metaRuleId: meta.id,
            type: 'SHORT_CIRCUIT',
            targetIds: inhibitedIds,
            reason: params.reason,
            value: params.value,
          },
        ],
        shortCircuit: { value: params.value, reason: params.reason, ruleId: meta.id },
        inhibitedIds,
        substitutedIds: [],
        invalidMetaRuleIds,
      };
    }

    // ─── 2. INHIBITION ─────────────────────────────────────────────────
    // Runs before substitution: inhibited rules are removed from the pool
    // before substitution can touch them.
    const inhibitions = metaRules
      .filter((r) => r.model === 'META_INHIBITION')
      .sort(byPriorityDesc);

    for (const meta of inhibitions) {
      const shouldApply = conditionResults.has(meta.id) ? conditionResults.get(meta.id) : true;
      if (!shouldApply) continue;

      const params = meta.params as unknown as InhibitionParams;
      if (!MetaRuleProcessor.isValidInhibitionParams(params)) {
        invalidMetaRuleIds.push(meta.id);
        continue;
      }

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
          targetIds: inhibitedInThisStep,
        });
      }
    }

    // ─── 3. SUBSTITUTION ───────────────────────────────────────────────
    // Runs after inhibition: only surviving rules can be substituted.
    const substitutions = metaRules
      .filter((r) => r.model === 'META_SUBSTITUTION')
      .sort(byPriorityDesc);

    for (const meta of substitutions) {
      const shouldApply = conditionResults.has(meta.id) ? conditionResults.get(meta.id) : true;
      if (!shouldApply) continue;

      const params = meta.params as unknown as SubstitutionParams;
      if (!MetaRuleProcessor.isValidSubstitutionParams(params)) {
        invalidMetaRuleIds.push(meta.id);
        continue;
      }

      const substitutedInThisStep: string[] = [];

      regularRules = regularRules.map((rule) => {
        if (MetaRuleProcessor.matchesSubstitutionTarget(rule, params)) {
          substitutedInThisStep.push(rule.id);
          const mergedParams = deepMerge(rule.params as Record<string, unknown>, params.newParams);
          return { ...rule, params: mergedParams } as unknown as FiscalRule;
        }
        return rule;
      });

      if (substitutedInThisStep.length > 0) {
        actions.push({
          metaRuleId: meta.id,
          type: 'SUBSTITUTION',
          targetIds: substitutedInThisStep,
        });
      }
    }

    const inhibitedIds = actions
      .filter((a) => a.type === 'INHIBITION' || a.type === 'SHORT_CIRCUIT')
      .flatMap((a) => a.targetIds);

    const substitutedIds = actions
      .filter((a) => a.type === 'SUBSTITUTION')
      .flatMap((a) => a.targetIds);

    return {
      rules: regularRules as unknown as Rule[],
      actions,
      inhibitedIds,
      substitutedIds,
      invalidMetaRuleIds,
    };
  }

  // ─── Param validators ──────────────────────────────────────────────

  private static isValidShortCircuitParams(params: unknown): params is ShortCircuitParams {
    if (!params || typeof params !== 'object') return false;
    const p = params as Record<string, unknown>;
    return typeof p['value'] === 'number' && typeof p['reason'] === 'string';
  }

  private static isValidInhibitionParams(params: unknown): params is InhibitionParams {
    if (!params || typeof params !== 'object') return false;
    const p = params as Record<string, unknown>;
    const hasTargetIds = Array.isArray(p['targetIds']) && p['targetIds'].length > 0;
    const hasTargetTags = Array.isArray(p['targetTags']) && p['targetTags'].length > 0;
    const hasTargetCategories =
      Array.isArray(p['targetCategories']) && p['targetCategories'].length > 0;
    // At least one selector must be present
    return hasTargetIds || hasTargetTags || hasTargetCategories;
  }

  private static isValidSubstitutionParams(params: unknown): params is SubstitutionParams {
    if (!params || typeof params !== 'object') return false;
    const p = params as Record<string, unknown>;
    if (typeof p['targetModel'] !== 'string' || p['targetModel'].length === 0) return false;
    if (!p['newParams'] || typeof p['newParams'] !== 'object') return false;
    return true;
  }

  // ─── Targeting ─────────────────────────────────────────────────────

  private static matchesTarget(rule: FiscalRule, params: InhibitionParams): boolean {
    if (params.targetIds?.includes(rule.id)) return true;
    if (params.targetTags?.some((tag) => rule.tags?.includes(tag))) return true;
    if (params.targetCategories?.includes(rule.category)) return true;
    return false;
  }

  private static matchesSubstitutionTarget(rule: FiscalRule, params: SubstitutionParams): boolean {
    if (rule.model !== params.targetModel) return false;
    if (params.targetIds?.length) return params.targetIds.includes(rule.id);
    if (params.targetTags?.length) return params.targetTags.some((tag) => rule.tags?.includes(tag));
    // No specific selectors: matches ALL rules with this model
    return true;
  }
}
