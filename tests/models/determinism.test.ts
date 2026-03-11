import { describe, it, expect } from 'vitest';
import { FlatRateModel } from '../../src/models/FlatRateModel.js';
import { ProgressiveBracketModel } from '../../src/models/ProgressiveBracketModel.js';
import { MinimumTaxModel } from '../../src/models/MinimumTaxModel.js';
import { ThresholdModel } from '../../src/models/ThresholdModel.js';
import { FixedAmountModel } from '../../src/models/FixedAmountModel.js';
import { CompositeModel } from '../../src/models/CompositeModel.js';
import type { Rule } from '@run-iq/core';

const dummyRule = { id: 'r', model: 'TEST', params: {} } as unknown as Rule;

describe('Determinism: all models x5 = same result', () => {
  it('FlatRateModel x5', () => {
    const model = new FlatRateModel();
    const params = { rate: 0.18, base: 'amount' };
    const input = { amount: 3500000 };
    const results = Array.from({ length: 5 }, () => model.calculate(input, dummyRule, params));
    for (let i = 1; i < results.length; i++) {
      expect(results[i]).toBe(results[0]);
    }
    expect(results[0]).toBe(630000);
  });

  it('ProgressiveBracketModel x5', () => {
    const model = new ProgressiveBracketModel();
    const params = {
      base: 'net_taxable_income',
      brackets: [
        { from: 0, to: 900000, rate: 0 },
        { from: 900000, to: 1800000, rate: 0.1 },
        { from: 1800000, to: 3600000, rate: 0.15 },
        { from: 3600000, to: null, rate: 0.35 },
      ],
    };
    const input = { net_taxable_income: 4200000 };
    const results = Array.from({ length: 5 }, () => model.calculate(input, dummyRule, params));
    for (let i = 1; i < results.length; i++) {
      expect(results[i]!.value).toBe(results[0]!.value);
    }
    // 0-900k: 0, 900k-1800k: 90k, 1800k-3600k: 270k, 3600k-4200k: 210k = 570k
    expect(results[0]!.value).toBe(570000);
  });

  it('MinimumTaxModel x5', () => {
    const model = new MinimumTaxModel();
    const params = { rate: 0.27, base: 'taxable_profit', minimum: 500000 };
    const input = { taxable_profit: 800000 };
    const results = Array.from({ length: 5 }, () => model.calculate(input, dummyRule, params));
    for (let i = 1; i < results.length; i++) {
      expect(results[i]!.value).toBe(results[0]!.value);
    }
    // 800000 * 0.27 = 216000 < 500000, so minimum applies
    expect(results[0]!.value).toBe(500000);
  });

  it('ThresholdModel x5', () => {
    const model = new ThresholdModel();
    const params = { base: 'revenue', threshold: 5000000, rate: 0.05, above_only: true };
    const input = { revenue: 12000000 };
    const results = Array.from({ length: 5 }, () => model.calculate(input, dummyRule, params));
    for (let i = 1; i < results.length; i++) {
      expect(results[i]!.value).toBe(results[0]!.value);
    }
    // (12M - 5M) * 0.05 = 350000
    expect(results[0]!.value).toBe(350000);
  });

  it('FixedAmountModel x5', () => {
    const model = new FixedAmountModel();
    const params = { amount: 75000, currency: 'XOF' };
    const results = Array.from({ length: 5 }, () => model.calculate({}, dummyRule, params));
    for (let i = 1; i < results.length; i++) {
      expect(results[i]).toBe(results[0]);
    }
    expect(results[0]).toBe(75000);
  });

  it('CompositeModel x5', () => {
    const model = new CompositeModel();
    const params = {
      aggregation: 'SUM' as const,
      steps: [
        { model: 'FLAT_RATE', params: { rate: 0.036, base: 'gross_salary' } },
        { model: 'FLAT_RATE', params: { rate: 0.175, base: 'gross_salary' } },
      ],
    };
    const input = { gross_salary: 1000000 };
    const results = Array.from({ length: 5 }, () => model.calculate(input, dummyRule, params));
    for (let i = 1; i < results.length; i++) {
      expect(results[i]!.value).toBe(results[0]!.value);
    }
    // 1M * 0.036 = 36000, 1M * 0.175 = 175000, SUM = 211000
    expect(results[0]!.value).toBe(211000);
  });
});
