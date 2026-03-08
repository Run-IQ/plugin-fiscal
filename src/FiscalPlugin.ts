import type { BeforeEvaluateResult, EvaluationInput, EvaluationResult, Rule, CalculationModel } from '@run-iq/core';
import type { FiscalRule } from './types/fiscal-rule.js';
import { BasePlugin } from '@run-iq/plugin-sdk';
import { JurisdictionResolver } from './jurisdiction/JurisdictionResolver.js';
import { MetaRuleProcessor, type MetaAction } from './meta/MetaRuleProcessor.js';
import { FlatRateModel } from './models/FlatRateModel.js';
import { ProgressiveBracketModel } from './models/ProgressiveBracketModel.js';
import { MinimumTaxModel } from './models/MinimumTaxModel.js';
import { ThresholdModel } from './models/ThresholdModel.js';
import { FixedAmountModel } from './models/FixedAmountModel.js';
import { CompositeModel } from './models/CompositeModel.js';
import { VERSION } from './utils';

const META_MODELS = new Set(['META_INHIBITION', 'META_SUBSTITUTION', 'META_SHORT_CIRCUIT']);

export class FiscalPlugin extends BasePlugin {
  readonly name = '@run-iq/plugin-fiscal' as const;
  readonly version = VERSION;

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
    const conditionResults = new Map<string, boolean>();

    for (const rule of fiscalRules) {
      if (META_MODELS.has(rule.model) && rule.condition) {
        conditionResults.set(rule.id, this.evaluateSimpleCondition(rule.condition, input.data));
      }
    }

    const metaResult = MetaRuleProcessor.process(rules, conditionResults);

    // Filter by country context
    const country = input.meta.context?.['country'] as string | undefined;
    const filteredRules = metaResult.rules.map((rule) => {
      const f = rule as FiscalRule;
      return {
        ...f,
        priority: JurisdictionResolver.resolve(f.jurisdiction, f.scope),
      };
    }).filter(r => !country || (r as unknown as FiscalRule).country === country);

    return {
      input: {
        ...input,
        data: {
          ...input.data,
          __fiscal_meta_actions: metaResult.actions,
          __fiscal_short_circuit: metaResult.shortCircuit,
          __fiscal_original_rules: rules, // Preserve original rules for reporting inhibited ones
        },
      },
      rules: filteredRules as unknown as Rule[],
    };
  }

  override afterEvaluate(input: EvaluationInput, result: EvaluationResult): EvaluationResult {
    const actions = (input.data.__fiscal_meta_actions as MetaAction[]) || [];
    const shortCircuit = input.data.__fiscal_short_circuit as any;
    const originalRules = (input.data.__fiscal_original_rules as Rule[]) || [];

    let finalResult = { ...result };

    // 1. Process Meta Actions for Trace and Results
    for (const action of actions) {
      // Add meta-rule to applied rules to show it was active
      finalResult.appliedRules = [
        ...finalResult.appliedRules,
        { id: action.metaRuleId, model: `META_${action.type}`, priority: 9999 } as any,
      ];

      // Add to execution trace
      finalResult.trace.steps.push({
        ruleId: action.metaRuleId,
        modelUsed: `META_${action.type}`,
        contribution: action.value ?? 0,
        durationMs: 0,
        reason: action.type === 'SHORT_CIRCUIT' 
          ? `STOP: ${action.reason}` 
          : `${action.type} applied to: ${action.targetIds.join(', ')}`,
      } as any);

      // For INHIBITION, add targeted rules to skippedRules for better visibility
      if (action.type === 'INHIBITION') {
        const inhibitedRules = originalRules.filter(r => action.targetIds.includes(r.id));
        finalResult.skippedRules = [
          ...finalResult.skippedRules,
          ...inhibitedRules.map(r => ({ rule: r, reason: `INHIBITED_BY_${action.metaRuleId}` }))
        ];
      }
    }

    // Special handling for short-circuit value
    if (shortCircuit) {
      finalResult.value = shortCircuit.value;
    }

    // 2. Enrich result with fiscal breakdown by category
    const fiscalBreakdown: Record<string, number> = {};
    for (const item of finalResult.breakdown) {
      const rule = finalResult.appliedRules.find((r) => r.id === item.ruleId) as FiscalRule | undefined;
      const category = rule?.category ?? 'unknown';
      fiscalBreakdown[category] = (fiscalBreakdown[category] ?? 0) + (item.contribution as number);
    }

    return {
      ...finalResult,
      meta: { ...finalResult.meta, fiscalBreakdown },
    };
  }

  private evaluateSimpleCondition(condition: { dsl: string; value: unknown }, data: Record<string, unknown>): boolean {
    const expr = condition.value as Record<string, unknown>;
    if (expr['===']) {
      const args = expr['==='] as unknown[];
      if (Array.isArray(args) && args.length === 2) {
        const left = args[0] as Record<string, string>;
        return left?.['var'] ? data[left['var']] === args[1] : false;
      }
    }
    if (expr['in']) {
      const args = expr['in'] as unknown[];
      if (Array.isArray(args) && args.length === 2) {
        const left = args[0] as Record<string, string>;
        return (left?.['var'] && Array.isArray(args[1])) ? (args[1] as unknown[]).includes(data[left['var']]) : false;
      }
    }
    return true;
  }
}
