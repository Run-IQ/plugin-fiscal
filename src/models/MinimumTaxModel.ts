import Decimal from 'decimal.js';
import { BaseModel, SchemaValidator } from '@run-iq/plugin-sdk';
import type { ValidationResult, CalculationOutput, Rule } from '@run-iq/core';
import type { MinimumTaxParams } from '../types/params.js';

export class MinimumTaxModel extends BaseModel {
  readonly name = 'MINIMUM_TAX' as const;
  readonly version = '1.0.0';

  validateParams(params: unknown): ValidationResult {
    return SchemaValidator.validate(params, {
      rate: { type: 'number', min: 0, max: 1 },
      base: { type: 'string' },
      minimum: { type: 'number', min: 0 },
    });
  }

  calculate(input: Record<string, unknown>, _matchedRule: Readonly<Rule>, params: unknown): CalculationOutput {
    const p = params as MinimumTaxParams;
    const baseValue = new Decimal(String(input[p.base] ?? 0));
    const rate = new Decimal(String(p.rate));
    const minimum = new Decimal(String(p.minimum));
    const computed = baseValue.mul(rate);
    const appliedMinimum = computed.lt(minimum);
    const value = Decimal.max(computed, minimum).toNumber();

    return {
      value,
      detail: {
        base: baseValue.toNumber(),
        rate: p.rate,
        computed: computed.toNumber(),
        minimum: p.minimum,
        appliedMinimum,
      },
    };
  }
}
