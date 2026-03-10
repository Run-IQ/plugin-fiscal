import type {
  BeforeEvaluateResult,
  EvaluationInput,
  EvaluationResult,
  Rule,
  CalculationModel,
  SkippedRule,
  SkipReason,
  PluginContext,
  TraceStep,
} from '@run-iq/core';
import type { FiscalRule } from './types/fiscal-rule.js';
import { BasePlugin } from '@run-iq/plugin-sdk';
import Decimal from 'decimal.js';
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

interface ShortCircuitData {
  readonly value: number;
  readonly reason: string;
  readonly ruleId: string;
}

export class FiscalPlugin extends BasePlugin {
  readonly name = '@run-iq/plugin-fiscal' as const;
  readonly version = VERSION;
  private context?: PluginContext;
  private metaWarnings: string[] = [];

  readonly models: CalculationModel[] = [
    new FlatRateModel(),
    new ProgressiveBracketModel(),
    new MinimumTaxModel(),
    new ThresholdModel(),
    new FixedAmountModel(),
    new CompositeModel(),
  ];

  override onInit(context: PluginContext): void {
    super.onInit(context);
    this.context = context;
  }

  override beforeEvaluate(
    input: EvaluationInput,
    rules: ReadonlyArray<Rule>,
  ): BeforeEvaluateResult {
    const conditionResults = new Map<string, boolean>();
    const skipped: SkippedRule[] = [];
    this.metaWarnings = [];

    // 1. Meta-rules condition evaluation
    // Meta-rules without conditions default to true (handled by MetaRuleProcessor).
    // Only evaluate conditions that are explicitly set.
    for (const rule of rules) {
      if (META_MODELS.has(rule.model) && rule.condition) {
        const cond = rule.condition as { dsl: string; value: unknown };
        const result = this.evaluateConditionSync(cond, { ...input.data }, rule.id);
        conditionResults.set(rule.id, result);
      }
    }

    const metaResult = MetaRuleProcessor.process(rules, conditionResults);

    // Report Inhibitions
    for (const action of metaResult.actions) {
      if (action.type === 'INHIBITION') {
        const rulesToSkip = rules.filter((r) => action.targetIds.includes(r.id));
        for (const r of rulesToSkip) {
          skipped.push({ rule: r, reason: 'INHIBITED_BY_META_RULE' as SkipReason });
        }
      }
    }

    // Collect warnings from invalid meta-rules
    for (const id of metaResult.invalidMetaRuleIds) {
      this.metaWarnings.push(`Meta-rule "${id}": skipped due to invalid params`);
    }

    // Handle Short-Circuit
    if (metaResult.shortCircuit) {
      const others = rules.filter((r) => r.id !== metaResult.shortCircuit!.ruleId);
      for (const r of others) {
        skipped.push({ rule: r, reason: 'SHORT_CIRCUITED' as SkipReason });
      }

      const shortCircuitData: ShortCircuitData = metaResult.shortCircuit;
      return {
        input: {
          ...input,
          data: {
            ...input.data,
            __fiscal_short_circuit: shortCircuitData,
            __fiscal_meta_warnings: [...this.metaWarnings],
          },
        },
        rules: [],
        skipped,
      };
    }

    // 2. Priorities and Country Filtering
    const country = input.meta.context?.['country'] as string | undefined;

    const processedRules = (metaResult.rules as FiscalRule[])
      .map((f) => {
        const priority =
          f.priority !== undefined && f.priority !== null
            ? f.priority
            : JurisdictionResolver.resolve(f.jurisdiction, f.scope) || 1000;

        // Map category to dominanceGroup for engine-level conflict resolution
        return { ...f, priority, dominanceGroup: f.category } as Rule;
      })
      .filter((r) => {
        const fr = r as unknown as FiscalRule;
        if (!fr.country) return true;
        if (fr.country !== country) {
          skipped.push({ rule: r, reason: 'COUNTRY_MISMATCH' as SkipReason });
          return false;
        }
        return true;
      });

    return {
      input: {
        ...input,
        data: {
          ...input.data,
          __fiscal_meta_actions: metaResult.actions,
          __fiscal_meta_warnings: [...this.metaWarnings],
        },
      },
      rules: processedRules,
      skipped,
    };
  }

  override afterEvaluate(input: EvaluationInput, result: EvaluationResult): EvaluationResult {
    const shortCircuit = input.data.__fiscal_short_circuit as ShortCircuitData | undefined;
    const actions = (input.data.__fiscal_meta_actions as readonly MetaAction[] | undefined) ?? [];
    const warnings =
      (input.data.__fiscal_meta_warnings as readonly string[] | undefined) ?? [];

    let finalResult = { ...result };

    if (shortCircuit) {
      finalResult = {
        ...finalResult,
        value: shortCircuit.value,
        appliedRules: [
          ...finalResult.appliedRules,
          { id: shortCircuit.ruleId, model: 'META_SHORT_CIRCUIT', priority: 9999 } as Rule,
        ],
      };
    }

    // Trace enrichment (Immutable approach)
    if (actions.length > 0) {
      const metaSteps: TraceStep[] = actions.map((action) => {
        let reason = `${action.type} applied`;
        if (action.type === 'SUBSTITUTION') {
          reason = `Params substituted for rules: ${action.targetIds.join(', ')}`;
        }
        return {
          ruleId: action.metaRuleId,
          conditionResult: true,
          conditionDetail: null,
          modelUsed: `META_${action.type}`,
          inputSnapshot: null,
          contribution: action.value ?? 0,
          durationMs: 0,
          detail: reason,
        };
      });

      finalResult = {
        ...finalResult,
        trace: {
          ...finalResult.trace,
          steps: [...metaSteps, ...finalResult.trace.steps],
        },
      };
    }

    // Surface meta-rule warnings in trace
    if (warnings.length > 0) {
      const warningSteps: TraceStep[] = warnings.map((warning) => ({
        ruleId: 'fiscal-plugin',
        conditionResult: false,
        conditionDetail: null,
        modelUsed: 'META_WARNING',
        inputSnapshot: null,
        contribution: 0,
        durationMs: 0,
        detail: warning,
      }));

      finalResult = {
        ...finalResult,
        trace: {
          ...finalResult.trace,
          steps: [...finalResult.trace.steps, ...warningSteps],
        },
      };
    }

    // Fiscal breakdown by category
    const fiscalBreakdown: Record<string, number> = {};
    for (const item of finalResult.breakdown) {
      const rule = finalResult.appliedRules.find((r) => r.id === item.ruleId) as
        | FiscalRule
        | undefined;
      const category = rule?.category ?? 'unknown';
      fiscalBreakdown[category] = new Decimal(fiscalBreakdown[category] ?? 0)
        .plus(new Decimal(item.contribution as number))
        .toNumber();
    }

    return { ...finalResult, meta: { ...finalResult.meta, fiscalBreakdown } };
  }

  /**
   * Evaluates a meta-rule condition synchronously.
   * Returns `true` (apply meta-rule) if:
   *   - No context available (defensive: meta-rule applies by default)
   *   - DSL evaluator not found (defensive: meta-rule applies by default)
   *   - DSL evaluation throws (defensive: meta-rule applies by default)
   *
   * Rationale: A meta-rule that fails to evaluate its condition should default
   * to applying (fail-safe). For example, if an NGO exemption meta-rule can't
   * evaluate its condition, it's safer to exempt than to tax.
   * Warnings are recorded in metaWarnings and surfaced in the trace.
   */
  private evaluateConditionSync(
    condition: { dsl: string; value: unknown },
    data: Record<string, unknown>,
    metaRuleId: string,
  ): boolean {
    if (!this.context) {
      this.metaWarnings.push(`Meta-rule "${metaRuleId}": no plugin context — defaulting to true`);
      return true;
    }

    const evaluator = this.context.dslRegistry.get(condition.dsl);
    if (!evaluator) {
      this.metaWarnings.push(
        `Meta-rule "${metaRuleId}": DSL "${condition.dsl}" not registered — defaulting to true`,
      );
      return true;
    }

    try {
      return !!evaluator.evaluate(condition.value, data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.metaWarnings.push(
        `Meta-rule "${metaRuleId}": DSL evaluation failed — ${message}`,
      );
      return true;
    }
  }
}
