import { describe, it, expect } from 'vitest';
import { MinimumTaxModel } from '../../src/models/MinimumTaxModel.js';
import type { Rule } from '@run-iq/core';

const model = new MinimumTaxModel();
const dummyRule = { id: 'r', model: 'MINIMUM_TAX', params: {} } as unknown as Rule;

// IS Togo: 27% with minimum 500,000 XOF
const isParams = { rate: 0.27, base: 'taxable_profit', minimum: 500000 };

describe('MinimumTaxModel', () => {
  it('returns computed tax when above minimum', () => {
    // 5,000,000 * 0.27 = 1,350,000 > 500,000
    const result = model.calculate({ taxable_profit: 5000000 }, dummyRule, isParams);
    expect(result.value).toBe(1350000);
  });

  it('returns minimum when computed tax is below minimum', () => {
    // 1,000,000 * 0.27 = 270,000 < 500,000
    const result = model.calculate({ taxable_profit: 1000000 }, dummyRule, isParams);
    expect(result.value).toBe(500000);
  });

  it('returns minimum when base is zero', () => {
    const result = model.calculate({ taxable_profit: 0 }, dummyRule, isParams);
    expect(result.value).toBe(500000);
  });

  it('detail shows appliedMinimum flag', () => {
    const above = model.calculate({ taxable_profit: 5000000 }, dummyRule, isParams);
    const detail1 = above.detail as { appliedMinimum: boolean };
    expect(detail1.appliedMinimum).toBe(false);

    const below = model.calculate({ taxable_profit: 1000000 }, dummyRule, isParams);
    const detail2 = below.detail as { appliedMinimum: boolean };
    expect(detail2.appliedMinimum).toBe(true);
  });

  it('exact threshold: computed = minimum', () => {
    // x * 0.27 = 500,000 -> x = 1,851,851.85...
    // At 1,851,852: 1851852 * 0.27 = 500,000.04 > 500,000
    const result = model.calculate({ taxable_profit: 1851852 }, dummyRule, isParams);
    expect(result.value).toBeGreaterThanOrEqual(500000);
  });

  it('determinism: same call x3 = same result', () => {
    const r1 = model.calculate({ taxable_profit: 3000000 }, dummyRule, isParams);
    const r2 = model.calculate({ taxable_profit: 3000000 }, dummyRule, isParams);
    const r3 = model.calculate({ taxable_profit: 3000000 }, dummyRule, isParams);
    expect(r1.value).toBe(r2.value);
    expect(r2.value).toBe(r3.value);
  });

  it('validates valid params', () => {
    expect(model.validateParams(isParams).valid).toBe(true);
  });

  it('rejects invalid params: negative minimum', () => {
    expect(model.validateParams({ rate: 0.27, base: 'x', minimum: -100 }).valid).toBe(false);
  });

  // --- Commit 64: model edge cases ---

  it('rate=0, minimum>0 → returns minimum', () => {
    const params = { rate: 0, base: 'taxable_profit', minimum: 500000 };
    const result = model.calculate({ taxable_profit: 10000000 }, dummyRule, params);
    expect(result.value).toBe(500000);
    expect((result.detail as { appliedMinimum: boolean }).appliedMinimum).toBe(true);
  });

  it('computed === minimum → returns minimum and appliedMinimum is false', () => {
    // Need base * rate = minimum exactly
    // 2000000 * 0.25 = 500000 = minimum
    const params = { rate: 0.25, base: 'taxable_profit', minimum: 500000 };
    const result = model.calculate({ taxable_profit: 2000000 }, dummyRule, params);
    expect(result.value).toBe(500000);
    // When computed equals minimum, Decimal.lt returns false, so appliedMinimum = false
    expect((result.detail as { appliedMinimum: boolean }).appliedMinimum).toBe(false);
  });

  it('negative base value → returns minimum (computed is negative)', () => {
    const params = { rate: 0.27, base: 'taxable_profit', minimum: 500000 };
    const result = model.calculate({ taxable_profit: -1000000 }, dummyRule, params);
    // -1000000 * 0.27 = -270000 < 500000, so minimum applies
    expect(result.value).toBe(500000);
    expect((result.detail as { appliedMinimum: boolean }).appliedMinimum).toBe(true);
  });
});
