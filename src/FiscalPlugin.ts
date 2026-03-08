import type { 
  BeforeEvaluateResult, 
  EvaluationInput, 
  EvaluationResult, 
  Rule, 
  CalculationModel,
  SkippedRule,
  SkipReason
} from '@run-iq/core';
import type { FiscalRule } from './types/fiscal-rule.js';
import { BasePlugin } from '@run-iq/plugin-sdk';
import { JurisdictionResolver } from './jurisdiction/JurisdictionResolver.js';
import { MetaRuleProcessor } from './meta/MetaRuleProcessor.js';
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
    const skipped: SkippedRule[] = [];

    // 1. Meta-rules evaluation
    for (const rule of fiscalRules) {
      if (META_MODELS.has(rule.model) && rule.condition) {
        conditionResults.set(rule.id, this.evaluateSimpleCondition(rule.condition, input.data));
      }
    }

    const metaResult = MetaRuleProcessor.process(rules, conditionResults);
    
    // Report Inhibitions
    for (const action of metaResult.actions) {
      if (action.type === 'INHIBITION') {
        const rulesToSkip = rules.filter(r => action.targetIds.includes(r.id));
        for (const r of rulesToSkip) {
          skipped.push({ rule: r, reason: 'INHIBITED_BY_META_RULE' as SkipReason });
        }
      }
    }

    // Handle Short-Circuit
    if (metaResult.shortCircuit) {
      const others = rules.filter(r => r.id !== metaResult.shortCircuit!.ruleId);
      for (const r of others) {
        skipped.push({ rule: r, reason: 'SHORT_CIRCUITED' as SkipReason });
      }
      
      return {
        input: { ...input, data: { ...input.data, __fiscal_short_circuit: metaResult.shortCircuit } },
        rules: [], 
        skipped,
      };
    }

    // 2. Priorities and Country Filtering
    const country = input.meta.context?.['country'] as string | undefined;

    const processedRules = (metaResult.rules as FiscalRule[]).map((f) => {
      const priority = (f.priority && f.priority > 0) 
        ? f.priority 
        : (JurisdictionResolver.resolve(f.jurisdiction, f.scope) || 1000);
      
      // Map category to dominanceGroup for engine-level conflict resolution
      return { ...f, priority, dominanceGroup: f.category } as Rule;
    }).filter(r => {
      const fr = r as unknown as FiscalRule;
      if (!fr.country) return true;
      if (fr.country !== country) {
        skipped.push({ rule: r, reason: 'COUNTRY_MISMATCH' as SkipReason });
        return false;
      }
      return true;
    });

    return {
      input: { ...input, data: { ...input.data, __fiscal_meta_actions: metaResult.actions } },
      rules: processedRules,
      skipped,
    };
  }

  override afterEvaluate(input: EvaluationInput, result: EvaluationResult): EvaluationResult {
    const shortCircuit = input.data.__fiscal_short_circuit as any;
    const actions = (input.data.__fiscal_meta_actions as any[]) || [];
    
    let finalResult = { ...result };

    if (shortCircuit) {
      finalResult = {
        ...finalResult,
        value: shortCircuit.value,
        appliedRules: [
          ...finalResult.appliedRules,
          { id: shortCircuit.ruleId, model: 'META_SHORT_CIRCUIT', priority: 9999 } as any
        ]
      };
    }

    // Trace enrichment (Immutable approach)
    if (actions.length > 0) {
      const metaSteps = actions.map(action => ({
        ruleId: action.metaRuleId,
        modelUsed: `META_${action.type}`,
        contribution: action.value ?? 0,
        durationMs: 0,
        reason: `${action.type} applied`,
      }));
      
      finalResult = {
        ...finalResult,
        trace: {
          ...finalResult.trace,
          steps: [...metaSteps as any, ...finalResult.trace.steps]
        }
      };
    }

    // Fiscal breakdown by category
    const fiscalBreakdown: Record<string, number> = {};
    for (const item of finalResult.breakdown) {
      const rule = finalResult.appliedRules.find((r) => r.id === item.ruleId) as FiscalRule | undefined;
      const category = rule?.category ?? 'unknown';
      fiscalBreakdown[category] = (fiscalBreakdown[category] ?? 0) + (item.contribution as number);
    }

    return { ...finalResult, meta: { ...finalResult.meta, fiscalBreakdown } };
  }

  private evaluateSimpleCondition(condition: { dsl: string; value: unknown }, data: Record<string, unknown>): boolean {
    const expr = condition.value as any;
    try {
      if (expr['===']) {
        const [left, right] = expr['==='];
        const val = (left && typeof left === 'object' && 'var' in left) ? data[left.var] : left;
        return val === right;
      }
      if (expr['in']) {
        const [left, right] = expr['in'];
        const val = (left && typeof left === 'object' && 'var' in left) ? data[left.var] : left;
        return Array.isArray(right) && right.includes(val);
      }
      // Support basic comparison operators for thresholds
      if (expr['<']) {
        const [left, right] = expr['<'];
        const val = (left && typeof left === 'object' && 'var' in left) ? data[left.var] : left;
        return (val as number) < (right as number);
      }
      if (expr['>']) {
        const [left, right] = expr['>'];
        const val = (left && typeof left === 'object' && 'var' in left) ? data[left.var] : left;
        return (val as number) > (right as number);
      }
      if (expr['<=']) {
        const [left, right] = expr['<='];
        const val = (left && typeof left === 'object' && 'var' in left) ? data[left.var] : left;
        return (val as number) <= (right as number);
      }
      if (expr['>=']) {
        const [left, right] = expr['>='];
        const val = (left && typeof left === 'object' && 'var' in left) ? data[left.var] : left;
        return (val as number) >= (right as number);
      }
    } catch (e) { return false; }
    return true; // Default behavior if operator not supported (safe fail-open)
  }
}
