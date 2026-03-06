import { describe, it, expect } from 'vitest';
import { FixedAmountModel } from '../../src/models/FixedAmountModel.js';
import type { Rule } from '@run-iq/core';

const model = new FixedAmountModel();
const dummyRule = { id: 'r', model: 'FIXED_AMOUNT', params: {} } as unknown as Rule;

describe('FixedAmountModel', () => {
  it('returns fixed amount regardless of input', () => {
    const params = { amount: 50000, currency: 'XOF' };
    const result = model.calculate({ anything: 99999 }, dummyRule, params);
    expect(result).toBe(50000);
  });

  it('returns 0 for amount=0', () => {
    const result = model.calculate({}, dummyRule, { amount: 0, currency: 'XOF' });
    expect(result).toBe(0);
  });

  it('validates valid params', () => {
    expect(model.validateParams({ amount: 50000, currency: 'XOF' }).valid).toBe(true);
  });

  it('rejects invalid params: negative amount', () => {
    expect(model.validateParams({ amount: -100, currency: 'XOF' }).valid).toBe(false);
  });

  it('rejects invalid params: missing currency', () => {
    expect(model.validateParams({ amount: 100 }).valid).toBe(false);
  });
});
