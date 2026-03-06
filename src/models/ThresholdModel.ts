import Decimal from 'decimal.js';
import { BaseModel, SchemaValidator } from '@run-iq/plugin-sdk';
import type { ValidationResult, Rule } from '@run-iq/core';
import type { ThresholdParams } from '../types/params.js';

export class ThresholdModel extends BaseModel {
  readonly name = 'THRESHOLD_BASED' as const;
  readonly version = '1.0.0';

  validateParams(params: unknown): ValidationResult {
    return SchemaValidator.validate(params, {
      base: { type: 'string' },
      threshold: { type: 'number', min: 0 },
      rate: { type: 'number', min: 0, max: 1 },
      above_only: { type: 'boolean' },
    });
  }

  calculate(input: Record<string, unknown>, _matchedRule: Readonly<Rule>, params: unknown): number {
    const p = params as ThresholdParams;
    const baseValue = new Decimal(String(input[p.base] ?? 0));
    const threshold = new Decimal(String(p.threshold));
    const rate = new Decimal(String(p.rate));

    if (baseValue.lte(threshold)) {
      return 0;
    }

    if (p.above_only) {
      return baseValue.minus(threshold).mul(rate).toNumber();
    }

    return baseValue.mul(rate).toNumber();
  }
}
