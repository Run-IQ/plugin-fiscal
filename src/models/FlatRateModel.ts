import Decimal from 'decimal.js';
import { BaseModel, SchemaValidator } from '@run-iq/plugin-sdk';
import type { ValidationResult, ParamDescriptor, Rule } from '@run-iq/core';
import type { FlatRateParams } from '../types/params.js';
import { VERSION } from '../utils';

export class FlatRateModel extends BaseModel {
  readonly name = 'FLAT_RATE' as const;
  readonly version = VERSION;

  validateParams(params: unknown): ValidationResult {
    return SchemaValidator.validate(params, {
      rate: { type: 'number', min: 0, max: 1 },
      base: { type: 'string' },
    });
  }

  describeParams(): Record<string, ParamDescriptor> {
    return {
      rate: { type: 'number (0–1)', description: 'Tax rate to apply to the base value (e.g. 0.18 for 18% VAT)' },
      base: { type: 'string', description: 'Name of the input field to use as tax base (e.g. "revenue", "income")' },
    };
  }

  calculate(input: Record<string, unknown>, _matchedRule: Readonly<Rule>, params: unknown): number {
    const p = params as FlatRateParams;
    const baseValue = new Decimal(String(input[p.base] ?? 0));
    const rate = new Decimal(String(p.rate));
    return baseValue.mul(rate).toNumber();
  }
}
