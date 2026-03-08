import { BasePlugin } from '@run-iq/plugin-sdk';
import type { BeforeEvaluateResult, EvaluationInput, EvaluationResult, Rule, CalculationModel } from '@run-iq/core';
import type { FiscalRule } from './types/fiscal-rule.js';
import { JurisdictionResolver } from './jurisdiction/JurisdictionResolver.js';
import { MetaRuleProcessor } from './meta/MetaRuleProcessor.js';
import { FlatRateModel } from './models/FlatRateModel.js';
import { ProgressiveBracketModel } from './models/ProgressiveBracketModel.js';
import { MinimumTaxModel } from './models/MinimumTaxModel.js';
import { ThresholdModel } from './models/ThresholdModel.js';
import { FixedAmountModel } from './models/FixedAmountModel.js';
import { CompositeModel } from './models/CompositeModel.js';

const META_MODELS = new Set(['META_INHIBITION', 'META_SUBSTITUTION', 'META_SHORT_CIRCUIT']);

export class FiscalPlugin extends BasePlugin {
  readonly name = '@run-iq/plugin-fiscal' as const;
  readonly version = '0.1.0';

  readonly models: CalculationModel[] = [
    new FlatRateModel(),
    new ProgressiveBracketModel(),
    new MinimumTaxModel(),
    new ThresholdModel(),
    new FixedAmountModel(),
    new CompositeModel(),
  ];

  override beforeEvaluate(input: EvaluationInput, rules: ReadonlyArray<Rule>): BeforeEvaluateResult {
    const fiscalRules = rules as ReadonlyArray<FiscalRule>;

    // 1. Evaluate meta-rule conditions using input data
    //    (simplified: we check conditions inline since we don't have DSL access here)
    const conditionResults = new Map<string, boolean>();
    for (const rule of fiscalRules) {
      if (META_MODELS.has(rule.model) && rule.condition) {
        // Meta-rule conditions are evaluated later by the core engine.
        // For now, we evaluate simple equality conditions inline.
        conditionResults.set(rule.id, this.evaluateSimpleCondition(rule.condition, input.data));
      }
    }

    // 2. Process meta-rules (short-circuit, inhibit, substitute)
    const metaResult = MetaRuleProcessor.process(rules, conditionResults);

    // 3. Handle short-circuit: return empty rules with special marker
    if (metaResult.shortCircuit) {
      return {
        input: {
          ...input,
          data: {
            ...input.data,
            _shortCircuit: metaResult.shortCircuit,
          },
        },
        rules: [],
      };
    }

    // 4. Resolve priorities from jurisdiction + scope on remaining rules
    const remainingFiscalRules = metaResult.rules as ReadonlyArray<FiscalRule>;
    const resolvedRules = remainingFiscalRules.map((rule) => ({
      ...rule,
      priority: JurisdictionResolver.resolve(rule.jurisdiction, rule.scope),
    }));

    // 5. Filter by country if provided in context
    const country = input.meta.context?.['country'] as string | undefined;
    const filteredRules = country
      ? resolvedRules.filter((r) => r.country === country)
      : resolvedRules;

    // IMMUTABLE — return new values
    return {
      input: {
        ...input,
        data: {
          ...input.data,
          _inhibitedRuleIds: metaResult.inhibitedIds,
          _substitutedRuleIds: metaResult.substitutedIds,
        },
      },
      rules: filteredRules as unknown as Rule[],
    };
  }

  override afterEvaluate(_input: EvaluationInput, result: EvaluationResult): EvaluationResult {
    // Enrich result with fiscal breakdown by category
    const fiscalBreakdown: Record<string, number> = {};

    for (const item of result.breakdown) {
      const rule = result.appliedRules.find((r) => r.id === item.ruleId) as FiscalRule | undefined;
      const category = rule?.category ?? 'unknown';
      fiscalBreakdown[category] = (fiscalBreakdown[category] ?? 0) + (item.contribution as number);
    }

    return {
      ...result,
      meta: { ...result.meta, fiscalBreakdown },
    };
  }

  /**
   * Evaluate simple conditions for meta-rules without DSL.
   * Supports basic equality checks via `{ "===": [{ "var": "field" }, value] }`
   * and `{ "in": [{ "var": "field" }, [values]] }` patterns.
   */
  private evaluateSimpleCondition(
    condition: { dsl: string; value: unknown },
    data: Record<string, unknown>,
  ): boolean {
    const expr = condition.value as Record<string, unknown>;

    // Handle { "===": [{ "var": "field" }, value] }
    if (expr['===']) {
      const args = expr['==='] as unknown[];
      if (Array.isArray(args) && args.length === 2) {
        const left = args[0] as Record<string, string>;
        if (left?.['var']) {
          return data[left['var']] === args[1];
        }
      }
    }

    // Handle { "in": [{ "var": "field" }, [values]] }
    if (expr['in']) {
      const args = expr['in'] as unknown[];
      if (Array.isArray(args) && args.length === 2) {
        const left = args[0] as Record<string, string>;
        if (left?.['var'] && Array.isArray(args[1])) {
          return (args[1] as unknown[]).includes(data[left['var']]);
        }
      }
    }

    // Default: condition not evaluated → treat as true
    return true;
  }
}

