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

    // 1. Evaluate meta-rule conditions using input data
    for (const rule of fiscalRules) {
      if (META_MODELS.has(rule.model) && rule.condition) {
        conditionResults.set(rule.id, this.evaluateSimpleCondition(rule.condition, input.data));
      }
    }

    // 2. Process meta-rules (short-circuit, inhibit, substitute)
    const metaResult = MetaRuleProcessor.process(rules, conditionResults);

    // 3. Resolve priorities and handle country filtering (Strictly from meta.context)
    const country = input.meta.context?.['country'] as string | undefined;

    const processedRules = metaResult.rules.map((rule) => {
      const f = rule as FiscalRule;
      return {
        ...f,
        priority: JurisdictionResolver.resolve(f.jurisdiction, f.scope) || f.priority,
      };
    }).filter(r => {
      const fr = r as unknown as FiscalRule;
      // Strict filtering: if rule has a country, it MUST match meta.context.country
      if (fr.country && country && fr.country !== country) return false;
      return true;
    });

    return {
      input: {
        ...input,
        data: {
          ...input.data,
          __fiscal_meta_actions: metaResult.actions,
          __fiscal_short_circuit: metaResult.shortCircuit,
          __fiscal_original_rules: rules,
        },
      },
      rules: processedRules as unknown as Rule[],
    };
  }

  override afterEvaluate(input: EvaluationInput, result: EvaluationResult): EvaluationResult {
    const actions = (input.data.__fiscal_meta_actions as MetaAction[]) || [];
    const shortCircuit = input.data.__fiscal_short_circuit as any;
    const originalRules = (input.data.__fiscal_original_rules as Rule[]) || [];

    let finalResult = { ...result };

    // Inject Short-Circuit result if active
    if (shortCircuit) {
      finalResult.value = shortCircuit.value;
      if (!finalResult.appliedRules.some(r => r.id === shortCircuit.ruleId)) {
        finalResult.appliedRules = [
          ...finalResult.appliedRules,
          { id: shortCircuit.ruleId, model: 'META_SHORT_CIRCUIT', priority: 9999 } as any
        ];
      }
    }

    // Process each meta-action for visibility in trace and result
    for (const action of actions) {
      // 1. Add to trace
      finalResult.trace.steps.push({
        ruleId: action.metaRuleId,
        modelUsed: `META_${action.type}`,
        contribution: action.value ?? 0,
        durationMs: 0,
        reason: action.type === 'SHORT_CIRCUIT' 
          ? `STOP: ${action.reason}` 
          : `${action.type} applied to: ${action.targetIds.join(', ')}`,
      } as any);

      // 2. Add to appliedRules for visibility
      if (!finalResult.appliedRules.some(r => r.id === action.metaRuleId)) {
        finalResult.appliedRules.push({ id: action.metaRuleId, model: `META_${action.type}`, priority: 9999 } as any);
      }

      // 3. Add inhibited rules to skippedRules for clarity
      if (action.type === 'INHIBITION') {
        const inhibitedRules = originalRules.filter(r => action.targetIds.includes(r.id));
        for (const r of inhibitedRules) {
          if (!finalResult.skippedRules.some(s => s.rule.id === r.id)) {
            finalResult.skippedRules.push({ rule: r, reason: `INHIBITED_BY_${action.metaRuleId}` });
          }
        }
      }
    }

    // 4. Enrich result with fiscal breakdown by category
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
    const expr = condition.value as any;
    if (expr['===']) {
      const [left, right] = expr['==='];
      const val = left?.var ? data[left.var] : left;
      return val === right;
    }
    if (expr['in']) {
      const [left, right] = expr['in'];
      const val = left?.var ? data[left.var] : left;
      return Array.isArray(right) && right.includes(val);
    }
    return true;
  }
}
