import type { 
  BeforeEvaluateResult, 
  EvaluationInput, 
  EvaluationResult, 
  Rule, 
  CalculationModel,
  SkippedRule 
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
    const skippedRules: SkippedRule[] = [];

    // 1. Evaluate meta-rule conditions using input data
    for (const rule of fiscalRules) {
      if (META_MODELS.has(rule.model) && rule.condition) {
        conditionResults.set(rule.id, this.evaluateSimpleCondition(rule.condition, input.data));
      }
    }

    // 2. Process meta-rules
    const metaResult = MetaRuleProcessor.process(rules, conditionResults);
    
    // Reporting: Inhibition actions
    for (const action of metaResult.actions) {
      if (action.type === 'INHIBITION') {
        const rulesToSkip = rules.filter(r => action.targetIds.includes(r.id));
        skippedRules.push(...rulesToSkip.map(r => ({ 
          rule: r, 
          reason: `INHIBITED_BY_META_RULE: ${action.metaRuleId}` 
        })));
      }
    }

    // Reporting: Short-circuit action (stops everything else)
    if (metaResult.shortCircuit) {
      const others = rules.filter(r => r.id !== metaResult.shortCircuit!.ruleId);
      skippedRules.push(...others.map(r => ({ 
        rule: r, 
        reason: `SHORT_CIRCUITED: Stopped by ${metaResult.shortCircuit!.ruleId} (${metaResult.shortCircuit!.reason})` 
      })));
      
      return {
        input: { ...input, data: { ...input.data, __fiscal_short_circuit: metaResult.shortCircuit } },
        rules: [], 
        skipped: skippedRules,
      };
    }

    // 3. Resolve priorities and handle country filtering
    const country = input.meta.context?.['country'] as string | undefined;

    const processedRules = metaResult.rules.map((rule) => {
      const f = rule as FiscalRule;
      return { ...f, priority: JurisdictionResolver.resolve(f.jurisdiction, f.scope) || f.priority };
    }).filter(r => {
      const fr = r as unknown as FiscalRule;
      if (!fr.country) return true;
      if (fr.country !== country) {
        skippedRules.push({ 
          rule: r as unknown as Rule, 
          reason: `COUNTRY_MISMATCH: Required '${fr.country}', got '${country || 'none'}'` 
        });
        return false;
      }
      return true;
    });

    return {
      input: { ...input, data: { ...input.data, __fiscal_meta_actions: metaResult.actions } },
      rules: processedRules as unknown as Rule[],
      skipped: skippedRules,
    };
  }

  override afterEvaluate(input: EvaluationInput, result: EvaluationResult): EvaluationResult {
    const shortCircuit = input.data.__fiscal_short_circuit as any;
    const actions = (input.data.__fiscal_meta_actions as any[]) || [];
    
    let finalResult = { ...result };

    if (shortCircuit) {
      finalResult.value = shortCircuit.value;
      // Ensure the short-circuit rule itself appears as applied
      if (!finalResult.appliedRules.some(r => r.id === shortCircuit.ruleId)) {
        finalResult.appliedRules = [
          ...finalResult.appliedRules,
          { id: shortCircuit.ruleId, model: 'META_SHORT_CIRCUIT', priority: 9999 } as any
        ];
      }
    }

    // Add meta-actions to trace
    for (const action of actions) {
      finalResult.trace.steps.unshift({
        ruleId: action.metaRuleId,
        modelUsed: `META_${action.type}`,
        contribution: action.value ?? 0,
        durationMs: 0,
        reason: `${action.type} applied to ${action.targetIds.length} rules`,
      } as any);
    }

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
    } catch (e) {
      return false;
    }
    return true;
  }
}
