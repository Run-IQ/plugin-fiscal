import { describe, it, expect } from 'vitest';
import { ProgressiveBracketModel } from '../../src/models/ProgressiveBracketModel.js';
import type { Rule } from '@run-iq/core';

const model = new ProgressiveBracketModel();
const dummyRule = { id: 'r', model: 'PROGRESSIVE_BRACKET', params: {} } as unknown as Rule;

// Barème IRPP Togo 2025
const irppParams = {
  base: 'net_taxable_income',
  brackets: [
    { from: 0, to: 900000, rate: 0 },
    { from: 900001, to: 1800000, rate: 0.1 },
    { from: 1800001, to: 3600000, rate: 0.15 },
    { from: 3600001, to: null, rate: 0.35 },
  ],
};

describe('ProgressiveBracketModel', () => {
  it('has correct name', () => {
    expect(model.name).toBe('PROGRESSIVE_BRACKET');
  });

  it('zero income = zero tax', () => {
    const result = model.calculate({ net_taxable_income: 0 }, dummyRule, irppParams);
    expect(result).toBe(0);
  });

  it('income within first bracket (0% tranche) = zero tax', () => {
    const result = model.calculate({ net_taxable_income: 500000 }, dummyRule, irppParams);
    expect(result).toBe(0);
  });

  it('income at exact bracket boundary (900000)', () => {
    const result = model.calculate({ net_taxable_income: 900000 }, dummyRule, irppParams);
    expect(result).toBe(0);
  });

  it('income in second bracket (1,200,000 XOF)', () => {
    // 0-900000: 0
    // 900001-1200000: (1200000-900001) * 0.10 = 299999 * 0.10 = 29999.9
    const result = model.calculate({ net_taxable_income: 1200000 }, dummyRule, irppParams);
    expect(result).toBeCloseTo(29999.9, 1);
  });

  it('income spanning multiple brackets (2,500,000 XOF)', () => {
    // 0-900000: 0
    // 900001-1800000: 899999 * 0.10 = 89999.9
    // 1800001-2500000: 699999 * 0.15 = 104999.85
    // Total: 194999.75
    const result = model.calculate({ net_taxable_income: 2500000 }, dummyRule, irppParams);
    expect(result).toBeCloseTo(194999.75, 1);
  });

  it('income in last bracket without cap (5,000,000 XOF)', () => {
    // 0-900000: 0
    // 900001-1800000: 899999 * 0.10 = 89999.9
    // 1800001-3600000: 1799999 * 0.15 = 269999.85
    // 3600001-5000000: 1399999 * 0.35 = 489999.65
    // Total: 849999.4
    const result = model.calculate({ net_taxable_income: 5000000 }, dummyRule, irppParams);
    expect(result).toBeCloseTo(849999.4, 1);
  });

  it('determinism: same call x3 = same result', () => {
    const r1 = model.calculate({ net_taxable_income: 2500000 }, dummyRule, irppParams);
    const r2 = model.calculate({ net_taxable_income: 2500000 }, dummyRule, irppParams);
    const r3 = model.calculate({ net_taxable_income: 2500000 }, dummyRule, irppParams);
    expect(r1).toBe(r2);
    expect(r2).toBe(r3);
  });

  it('validates valid params', () => {
    expect(model.validateParams(irppParams).valid).toBe(true);
  });

  it('rejects invalid params: missing brackets', () => {
    expect(model.validateParams({ base: 'income' }).valid).toBe(false);
  });

  it('rejects invalid params: not an object', () => {
    expect(model.validateParams(null).valid).toBe(false);
  });
});
