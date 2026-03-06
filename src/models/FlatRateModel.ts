import Decimal from 'decimal.js';
import { BaseModel, SchemaValidator } from '@run-iq/plugin-sdk';
import type { ValidationResult, Rule } from '@run-iq/core';
import type { FlatRateParams } from '../types/params.js';

export class FlatRateModel extends BaseModel {
  readonly name = 'FLAT_RATE' as const;
  readonly version = '1.0.0';

  validateParams(params: unknown): ValidationResult {
    return SchemaValidator.validate(params, {
      rate: { type: 'number', min: 0, max: 1 },
      base: { type: 'string' },
    });
  }

  calculate(input: Record<string, unknown>, _matchedRule: Readonly<Rule>, params: unknown): number {
    const p = params as FlatRateParams;
    const baseValue = new Decimal(String(input[p.base] ?? 0));
    const rate = new Decimal(String(p.rate));
    return baseValue.mul(rate).toNumber();
  }
}
