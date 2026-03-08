import Decimal from 'decimal.js';
import { BaseModel } from '@run-iq/plugin-sdk';
import type { ValidationResult, CalculationOutput, CalculationModel, Rule } from '@run-iq/core';
import type { CompositeParams } from '../types/params.js';
import { FlatRateModel } from './FlatRateModel.js';
import { ProgressiveBracketModel } from './ProgressiveBracketModel.js';
import { MinimumTaxModel } from './MinimumTaxModel.js';
import { ThresholdModel } from './ThresholdModel.js';
import { FixedAmountModel } from './FixedAmountModel.js';
import { VERSION } from '../utils';

const SUB_MODELS: Record<string, CalculationModel> = {
  FLAT_RATE: new FlatRateModel(),
  PROGRESSIVE_BRACKET: new ProgressiveBracketModel(),
  MINIMUM_TAX: new MinimumTaxModel(),
  THRESHOLD_BASED: new ThresholdModel(),
  FIXED_AMOUNT: new FixedAmountModel(),
};

export class CompositeModel extends BaseModel {
  readonly name = 'COMPOSITE' as const;
  readonly version = VERSION;

  validateParams(params: unknown): ValidationResult {
    if (params === null || typeof params !== 'object') {
      return { valid: false, errors: ['params must be an object'] };
    }
    const p = params as Record<string, unknown>;
    const errors: string[] = [];

    if (!Array.isArray(p['steps']) || p['steps'].length === 0) {
      errors.push('"steps" must be a non-empty array');
    }

    const agg = p['aggregation'];
    if (agg !== 'SUM' && agg !== 'MAX' && agg !== 'MIN') {
      errors.push('"aggregation" must be SUM, MAX, or MIN');
    }

    return errors.length > 0 ? { valid: false, errors } : { valid: true };
  }

  calculate(input: Record<string, unknown>, matchedRule: Readonly<Rule>, params: unknown): CalculationOutput {
    const p = params as CompositeParams;
    const contributions: Decimal[] = [];
    const steps: Array<{
      model: string;
      label?: string | undefined;
      value: number;
      detail?: unknown | undefined;
    }> = [];

    for (const step of p.steps) {
      const subModel = SUB_MODELS[step.model];
      if (!subModel) {
        continue;
      }
      const raw = subModel.calculate(input, matchedRule, step.params);
      const value = typeof raw === 'number' ? raw : raw.value;
      const detail = typeof raw === 'number' ? undefined : raw.detail;

      contributions.push(new Decimal(String(value)));
      steps.push({
        model: step.model,
        label: step.label,
        value,
        detail,
      });
    }

    if (contributions.length === 0) {
      return { value: 0, detail: { aggregation: p.aggregation, steps: [] } };
    }

    let result: number;
    switch (p.aggregation) {
      case 'SUM':
        result = contributions.reduce((acc, v) => acc.plus(v), new Decimal(0)).toNumber();
        break;
      case 'MAX':
        result = Decimal.max(...contributions).toNumber();
        break;
      case 'MIN':
        result = Decimal.min(...contributions).toNumber();
        break;
    }

    return {
      value: result,
      detail: { aggregation: p.aggregation, steps },
    };
  }
}
