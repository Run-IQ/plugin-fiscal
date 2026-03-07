import { describe, it, expect } from 'vitest';
import { ThresholdModel } from '../../src/models/ThresholdModel.js';
import type { Rule } from '@run-iq/core';

const model = new ThresholdModel();
const dummyRule = { id: 'r', model: 'THRESHOLD_BASED', params: {} } as unknown as Rule;

describe('ThresholdModel', () => {
  it('returns 0 when below threshold', () => {
    const params = { base: 'revenue', threshold: 5000000, rate: 0.05, above_only: true };
    const result = model.calculate({ revenue: 3000000 }, dummyRule, params);
    expect(result.value).toBe(0);
  });

  it('taxes only amount above threshold (above_only=true)', () => {
    const params = { base: 'revenue', threshold: 5000000, rate: 0.05, above_only: true };
    const result = model.calculate({ revenue: 8000000 }, dummyRule, params);
    // (8,000,000 - 5,000,000) * 0.05 = 150,000
    expect(result.value).toBe(150000);
  });

  it('taxes entire amount above threshold (above_only=false)', () => {
    const params = { base: 'revenue', threshold: 5000000, rate: 0.05, above_only: false };
    const result = model.calculate({ revenue: 8000000 }, dummyRule, params);
    // 8,000,000 * 0.05 = 400,000
    expect(result.value).toBe(400000);
  });

  it('exact threshold = no tax', () => {
    const params = { base: 'revenue', threshold: 5000000, rate: 0.05, above_only: true };
    const result = model.calculate({ revenue: 5000000 }, dummyRule, params);
    expect(result.value).toBe(0);
  });

  it('detail shows belowThreshold flag', () => {
    const params = { base: 'revenue', threshold: 5000000, rate: 0.05, above_only: true };
    const below = model.calculate({ revenue: 3000000 }, dummyRule, params);
    expect((below.detail as { belowThreshold: boolean }).belowThreshold).toBe(true);

    const above = model.calculate({ revenue: 8000000 }, dummyRule, params);
    expect((above.detail as { belowThreshold: boolean }).belowThreshold).toBe(false);
  });

  it('validates valid params', () => {
    expect(
      model.validateParams({
        base: 'revenue',
        threshold: 5000000,
        rate: 0.05,
        above_only: true,
      }).valid,
    ).toBe(true);
  });

  it('rejects invalid params', () => {
    expect(model.validateParams({ base: 'x' }).valid).toBe(false);
  });
});
