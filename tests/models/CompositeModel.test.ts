import { describe, it, expect } from 'vitest';
import { CompositeModel } from '../../src/models/CompositeModel.js';
import type { Rule } from '@run-iq/core';

const model = new CompositeModel();
const dummyRule = { id: 'r', model: 'COMPOSITE', params: {} } as unknown as Rule;

describe('CompositeModel', () => {
  // CNSS Togo: employee 3.6% + employer 17.5%
  it('SUM aggregation: CNSS employee + employer', () => {
    const params = {
      aggregation: 'SUM' as const,
      steps: [
        {
          label: 'part_salarie',
          model: 'FLAT_RATE',
          params: { rate: 0.036, base: 'gross_salary' },
        },
        {
          label: 'part_employeur',
          model: 'FLAT_RATE',
          params: { rate: 0.175, base: 'gross_salary' },
        },
      ],
    };
    const result = model.calculate({ gross_salary: 500000 }, dummyRule, params);
    // 500000 * 0.036 = 18000
    // 500000 * 0.175 = 87500
    // SUM = 105500
    expect(result).toBe(105500);
  });

  it('MAX aggregation', () => {
    const params = {
      aggregation: 'MAX' as const,
      steps: [
        { model: 'FLAT_RATE', params: { rate: 0.1, base: 'amount' } },
        { model: 'FIXED_AMOUNT', params: { amount: 100000, currency: 'XOF' } },
      ],
    };
    // FLAT_RATE: 500000 * 0.10 = 50000
    // FIXED: 100000
    // MAX = 100000
    const result = model.calculate({ amount: 500000 }, dummyRule, params);
    expect(result).toBe(100000);
  });

  it('MIN aggregation', () => {
    const params = {
      aggregation: 'MIN' as const,
      steps: [
        { model: 'FLAT_RATE', params: { rate: 0.1, base: 'amount' } },
        { model: 'FIXED_AMOUNT', params: { amount: 100000, currency: 'XOF' } },
      ],
    };
    const result = model.calculate({ amount: 500000 }, dummyRule, params);
    expect(result).toBe(50000);
  });

  it('empty steps = 0', () => {
    const params = { aggregation: 'SUM' as const, steps: [] };
    // validateParams would reject this, but calculate handles it
    const result = model.calculate({}, dummyRule, params);
    expect(result).toBe(0);
  });

  it('validates valid params', () => {
    expect(
      model.validateParams({
        aggregation: 'SUM',
        steps: [{ model: 'FLAT_RATE', params: { rate: 0.1, base: 'x' } }],
      }).valid,
    ).toBe(true);
  });

  it('rejects invalid params: missing aggregation', () => {
    expect(model.validateParams({ steps: [{ model: 'X', params: {} }] }).valid).toBe(false);
  });

  it('rejects invalid params: null', () => {
    expect(model.validateParams(null).valid).toBe(false);
  });
});
