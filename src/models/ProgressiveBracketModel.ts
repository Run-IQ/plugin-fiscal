import Decimal from 'decimal.js';
import { BaseModel } from '@run-iq/plugin-sdk';
import type { ValidationResult, CalculationOutput, Rule } from '@run-iq/core';
import type { BracketParams } from '../types/params.js';
import { VERSION } from '../utils';

export class ProgressiveBracketModel extends BaseModel {
  readonly name = 'PROGRESSIVE_BRACKET' as const;
  readonly version = VERSION;

  validateParams(params: unknown): ValidationResult {
    if (params === null || typeof params !== 'object') {
      return { valid: false, errors: ['params must be an object'] };
    }
    const p = params as Record<string, unknown>;
    const errors: string[] = [];

    if (typeof p['base'] !== 'string') {
      errors.push('"base" must be a string');
    }
    if (!Array.isArray(p['brackets']) || p['brackets'].length === 0) {
      errors.push('"brackets" must be a non-empty array');
    }

    return errors.length > 0 ? { valid: false, errors } : { valid: true };
  }

  calculate(input: Record<string, unknown>, _matchedRule: Readonly<Rule>, params: unknown): CalculationOutput {
    const p = params as BracketParams;
    const baseValue = new Decimal(String(input[p.base] ?? 0));
    let total = new Decimal(0);

    const brackets: Array<{
      from: number;
      to: number | null;
      rate: number;
      taxable: number;
      contribution: number;
    }> = [];

    for (const bracket of p.brackets) {
      const from = new Decimal(String(bracket.from));
      const to = bracket.to !== null ? new Decimal(String(bracket.to)) : null;
      const rate = new Decimal(String(bracket.rate));

      if (baseValue.lte(from)) {
        break;
      }

      const taxableInBracket =
        to !== null ? Decimal.min(baseValue, to).minus(from) : baseValue.minus(from);

      const contribution = taxableInBracket.gt(0) ? taxableInBracket.mul(rate) : new Decimal(0);

      if (taxableInBracket.gt(0)) {
        total = total.plus(contribution);
      }

      brackets.push({
        from: bracket.from,
        to: bracket.to,
        rate: bracket.rate,
        taxable: taxableInBracket.toNumber(),
        contribution: contribution.toNumber(),
      });
    }

    return {
      value: total.toNumber(),
      detail: brackets,
    };
  }
}
