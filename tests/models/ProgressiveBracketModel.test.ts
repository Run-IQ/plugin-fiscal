import { describe, it, expect } from 'vitest';
import { ProgressiveBracketModel } from '../../src/models/ProgressiveBracketModel.js';
import type { Rule } from '@run-iq/core';

const model = new ProgressiveBracketModel();
const dummyRule = { id: 'r', model: 'PROGRESSIVE_BRACKET', params: {} } as unknown as Rule;

// Bareme IRPP Togo 2025 — contiguous brackets
const irppParams = {
  base: 'net_taxable_income',
  brackets: [
    { from: 0, to: 900000, rate: 0 },
    { from: 900000, to: 1800000, rate: 0.1 },
    { from: 1800000, to: 3600000, rate: 0.15 },
    { from: 3600000, to: null, rate: 0.35 },
  ],
};

describe('ProgressiveBracketModel', () => {
  it('has correct name', () => {
    expect(model.name).toBe('PROGRESSIVE_BRACKET');
  });

  it('returns CalculationOutput with value and detail', () => {
    const result = model.calculate({ net_taxable_income: 2500000 }, dummyRule, irppParams);
    expect(typeof result).toBe('object');
    expect(result).toHaveProperty('value');
    expect(result).toHaveProperty('detail');
  });

  it('zero income = zero tax', () => {
    const result = model.calculate({ net_taxable_income: 0 }, dummyRule, irppParams);
    expect(result.value).toBe(0);
  });

  it('income within first bracket (0% tranche) = zero tax', () => {
    const result = model.calculate({ net_taxable_income: 500000 }, dummyRule, irppParams);
    expect(result.value).toBe(0);
  });

  it('income at exact bracket boundary (900000)', () => {
    const result = model.calculate({ net_taxable_income: 900000 }, dummyRule, irppParams);
    expect(result.value).toBe(0);
  });

  it('income in second bracket (1,200,000 XOF)', () => {
    // 0-900000: 0
    // 900000-1200000: (1200000-900000) * 0.10 = 300000 * 0.10 = 30000
    const result = model.calculate({ net_taxable_income: 1200000 }, dummyRule, irppParams);
    expect(result.value).toBe(30000);
  });

  it('income spanning multiple brackets (2,500,000 XOF)', () => {
    // 0-900000: 0
    // 900000-1800000: 900000 * 0.10 = 90000
    // 1800000-2500000: 700000 * 0.15 = 105000
    // Total: 195000
    const result = model.calculate({ net_taxable_income: 2500000 }, dummyRule, irppParams);
    expect(result.value).toBe(195000);
  });

  it('income in last bracket without cap (5,000,000 XOF)', () => {
    // 0-900000: 0
    // 900000-1800000: 900000 * 0.10 = 90000
    // 1800000-3600000: 1800000 * 0.15 = 270000
    // 3600000-5000000: 1400000 * 0.35 = 490000
    // Total: 850000
    const result = model.calculate({ net_taxable_income: 5000000 }, dummyRule, irppParams);
    expect(result.value).toBe(850000);
  });

  it('detail contains bracket-by-bracket breakdown', () => {
    const result = model.calculate({ net_taxable_income: 2500000 }, dummyRule, irppParams);
    const detail = result.detail as Array<{
      from: number;
      to: number | null;
      rate: number;
      taxable: number;
      contribution: number;
    }>;
    expect(Array.isArray(detail)).toBe(true);
    expect(detail.length).toBe(3);

    // First bracket: 0% on 900000
    expect(detail[0]!.from).toBe(0);
    expect(detail[0]!.rate).toBe(0);
    expect(detail[0]!.contribution).toBe(0);

    // Second bracket: 10% on 900000
    expect(detail[1]!.rate).toBe(0.1);
    expect(detail[1]!.taxable).toBe(900000);
    expect(detail[1]!.contribution).toBe(90000);

    // Third bracket: 15% on 700000
    expect(detail[2]!.rate).toBe(0.15);
    expect(detail[2]!.taxable).toBe(700000);
    expect(detail[2]!.contribution).toBe(105000);
  });

  it('determinism: same call x3 = same result', () => {
    const r1 = model.calculate({ net_taxable_income: 2500000 }, dummyRule, irppParams);
    const r2 = model.calculate({ net_taxable_income: 2500000 }, dummyRule, irppParams);
    const r3 = model.calculate({ net_taxable_income: 2500000 }, dummyRule, irppParams);
    expect(r1.value).toBe(r2.value);
    expect(r2.value).toBe(r3.value);
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
