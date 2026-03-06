import { BasePlugin } from '@run-iq/plugin-sdk';
import type { EvaluationInput, EvaluationResult, Rule, CalculationModel } from '@run-iq/core';
import type { FiscalRule } from './types/fiscal-rule.js';
import { JurisdictionResolver } from './jurisdiction/JurisdictionResolver.js';
import { FlatRateModel } from './models/FlatRateModel.js';
import { ProgressiveBracketModel } from './models/ProgressiveBracketModel.js';
import { MinimumTaxModel } from './models/MinimumTaxModel.js';
import { ThresholdModel } from './models/ThresholdModel.js';
import { FixedAmountModel } from './models/FixedAmountModel.js';
import { CompositeModel } from './models/CompositeModel.js';

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

  override beforeEvaluate(input: EvaluationInput, rules: ReadonlyArray<Rule>): EvaluationInput {
    const fiscalRules = rules as ReadonlyArray<FiscalRule>;

    // 1. Resolve priorities from jurisdiction + scope
    const resolvedRules = fiscalRules.map((rule) => ({
      ...rule,
      priority: JurisdictionResolver.resolve(rule.jurisdiction, rule.scope),
    }));

    // 2. Filter by country if provided in context
    const country = input.meta.context?.['country'] as string | undefined;
    const filteredRules = country
      ? resolvedRules.filter((r) => r.country === country)
      : resolvedRules;

    // IMMUTABLE — return new values
    return {
      ...input,
      data: {
        ...input.data,
        _resolvedRules: filteredRules,
      },
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
}
