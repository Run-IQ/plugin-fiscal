import Decimal from 'decimal.js';
import { BaseModel, SchemaValidator } from '@run-iq/plugin-sdk';
import type { ValidationResult, CalculationOutput, ParamDescriptor, Rule } from '@run-iq/core';
import type { ThresholdParams } from '../types/params.js';
import { VERSION } from '../utils';

export class ThresholdModel extends BaseModel {
  readonly name = 'THRESHOLD_BASED' as const;
  readonly version = VERSION;

  describeParams(): Record<string, ParamDescriptor> {
    return {
      base: { type: 'string', description: 'Name of the input field to use as tax base' },
      threshold: { type: 'number (>= 0)', description: 'Value below which no tax is applied' },
      rate: { type: 'number (0–1)', description: 'Tax rate applied when base exceeds the threshold' },
      above_only: { type: 'boolean', description: 'If true, tax only the amount above the threshold. If false, tax the entire base when threshold is exceeded.' },
    };
  }

  validateParams(params: unknown): ValidationResult {
    return SchemaValidator.validate(params, {
      base: { type: 'string' },
      threshold: { type: 'number', min: 0 },
      rate: { type: 'number', min: 0, max: 1 },
      above_only: { type: 'boolean' },
    });
  }

  calculate(
    input: Record<string, unknown>,
    _matchedRule: Readonly<Rule>,
    params: unknown,
  ): CalculationOutput {
    const p = params as ThresholdParams;
    const baseValue = new Decimal(String(input[p.base] ?? 0));
    const threshold = new Decimal(String(p.threshold));
    const rate = new Decimal(String(p.rate));

    if (baseValue.lte(threshold)) {
      return {
        value: 0,
        detail: {
          base: baseValue.toNumber(),
          threshold: p.threshold,
          belowThreshold: true,
        },
      };
    }

    const value = p.above_only
      ? baseValue.minus(threshold).mul(rate).toNumber()
      : baseValue.mul(rate).toNumber();

    return {
      value,
      detail: {
        base: baseValue.toNumber(),
        threshold: p.threshold,
        belowThreshold: false,
        aboveOnly: p.above_only,
        taxableAmount: p.above_only ? baseValue.minus(threshold).toNumber() : baseValue.toNumber(),
        rate: p.rate,
      },
    };
  }
}
