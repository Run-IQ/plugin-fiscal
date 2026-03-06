import { SchemaValidator } from '@run-iq/plugin-sdk';
import type { ValidationResult } from '@run-iq/core';

export class ParamsValidator {
  static validateFlatRate(params: unknown): ValidationResult {
    return SchemaValidator.validate(params, {
      rate: { type: 'number', min: 0, max: 1 },
      base: { type: 'string' },
    });
  }

  static validateMinimumTax(params: unknown): ValidationResult {
    return SchemaValidator.validate(params, {
      rate: { type: 'number', min: 0, max: 1 },
      base: { type: 'string' },
      minimum: { type: 'number', min: 0 },
    });
  }

  static validateThreshold(params: unknown): ValidationResult {
    return SchemaValidator.validate(params, {
      base: { type: 'string' },
      threshold: { type: 'number', min: 0 },
      rate: { type: 'number', min: 0, max: 1 },
      above_only: { type: 'boolean' },
    });
  }

  static validateFixedAmount(params: unknown): ValidationResult {
    return SchemaValidator.validate(params, {
      amount: { type: 'number', min: 0 },
      currency: { type: 'string' },
    });
  }
}
