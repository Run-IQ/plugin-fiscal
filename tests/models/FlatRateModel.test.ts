import { describe, it, expect } from 'vitest';
import { FlatRateModel } from '../../src/models/FlatRateModel.js';
import type { Rule } from '@run-iq/core';
import { VERSION } from '../../src/utils/version.js';

const model = new FlatRateModel();
const dummyRule = { id: 'r', model: 'FLAT_RATE', params: {} } as unknown as Rule;

describe('FlatRateModel', () => {
  it('has correct name and version', () => {
    expect(model.name).toBe('FLAT_RATE');
    expect(model.version).toBe(VERSION);
  });

  // TVA Togo 18%
  it('calculates TVA Togo 18% on 1,500,000 XOF', () => {
    const result = model.calculate({ amount_excl_tax: 1500000 }, dummyRule, {
      rate: 0.18,
      base: 'amount_excl_tax',
    });
    expect(result).toBe(270000);
  });

  it('handles zero base value', () => {
    const result = model.calculate({ amount: 0 }, dummyRule, { rate: 0.18, base: 'amount' });
    expect(result).toBe(0);
  });

  it('handles zero rate', () => {
    const result = model.calculate({ amount: 1000000 }, dummyRule, { rate: 0, base: 'amount' });
    expect(result).toBe(0);
  });

  it('determinism: same call x3 = same result', () => {
    const params = { rate: 0.18, base: 'amount' };
    const input = { amount: 5000000 };
    const r1 = model.calculate(input, dummyRule, params);
    const r2 = model.calculate(input, dummyRule, params);
    const r3 = model.calculate(input, dummyRule, params);
    expect(r1).toBe(r2);
    expect(r2).toBe(r3);
    expect(r1).toBe(900000);
  });

  it('validates valid params', () => {
    expect(model.validateParams({ rate: 0.18, base: 'amount' }).valid).toBe(true);
  });

  it('rejects invalid params: rate > 1', () => {
    expect(model.validateParams({ rate: 1.5, base: 'amount' }).valid).toBe(false);
  });

  it('rejects invalid params: missing base', () => {
    expect(model.validateParams({ rate: 0.18 }).valid).toBe(false);
  });

  // --- Commit 64: model edge cases ---

  it('negative base value produces negative result', () => {
    const result = model.calculate({ amount: -1000000 }, dummyRule, { rate: 0.18, base: 'amount' });
    expect(result).toBe(-180000);
  });
});
