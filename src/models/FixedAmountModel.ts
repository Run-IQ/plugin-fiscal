import { BaseModel, SchemaValidator } from '@run-iq/plugin-sdk';
import type { ValidationResult, Rule } from '@run-iq/core';
import type { FixedAmountParams } from '../types/params.js';
import { VERSION } from '../utils';
import Decimal from 'decimal.js';

export class FixedAmountModel extends BaseModel {
  readonly name = 'FIXED_AMOUNT' as const;
  readonly version = VERSION;

  validateParams(params: unknown): ValidationResult {
    return SchemaValidator.validate(params, {
      amount: { type: 'number', min: 0 },
      currency: { type: 'string' },
    });
  }

  calculate(
    _input: Record<string, unknown>,
    _matchedRule: Readonly<Rule>,
    params: unknown,
  ): number {
    const p = params as FixedAmountParams;
    return new Decimal(String(p.amount)).toNumber();
  }
}
