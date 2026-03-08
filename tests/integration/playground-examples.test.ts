import { describe, it, expect } from 'vitest';
import { PPEEngine } from '@run-iq/core';
import { FiscalPlugin } from '../../src/FiscalPlugin.js';
import { JsonLogicEvaluator } from '@run-iq/dsl-jsonlogic';
import { examples } from '../../../web-platform/src/lib/examples.js';

describe('Run-IQ Engine & Fiscal Plugin Robustness', () => {
  const engine = new PPEEngine({
    plugins: [new FiscalPlugin()],
    dsls: [new JsonLogicEvaluator()],
    onChecksumMismatch: 'skip', 
    strict: false,
    dryRun: true,
  });

  const stressChecksum = 'be5608da31c730ba190030c617bcf0c8fee317feb90cb85af95759bf31837b00';

  it('handles regular playground examples', async () => {
    const resIRPP = await engine.evaluate(JSON.parse(examples.irpp.rules), JSON.parse(examples.irpp.input));
    expect(resIRPP.value).toBe(180000);

    const resVAT = await engine.evaluate(JSON.parse(examples.vat.rules), JSON.parse(examples.vat.input));
    expect(resVAT.value).toBe(900000);
  });

  it('handles Full Payroll (Additive behavior across categories)', async () => {
    const ex = examples['fullPayroll'];
    const result = await engine.evaluate(JSON.parse(ex.rules), JSON.parse(ex.input));
    expect(result.appliedRules).toHaveLength(6);
    expect(result.value).toBe(5236200);
  });

  it('Stress Test: Complex Conflict & Aggregation', async () => {
    const rules = [
      {
        id: 'rule-high-prio',
        model: 'FLAT_RATE',
        priority: 5000,
        params: { base: 'amount', rate: 0.1 },
        category: 'GROUP_A',
        effectiveFrom: new Date('2025-01-01'), effectiveUntil: null, version: 1, tags: [], 
        checksum: stressChecksum,
        country: 'TG'
      },
      {
        id: 'rule-mid-prio-b',
        model: 'FLAT_RATE',
        priority: 3000,
        params: { base: 'amount', rate: 0.1 },
        category: 'GROUP_B',
        effectiveFrom: new Date('2025-01-01'), effectiveUntil: null, version: 1, tags: [], 
        checksum: stressChecksum,
        country: 'TG'
      },
      {
        id: 'rule-mid-prio-c1',
        model: 'FLAT_RATE',
        priority: 3000,
        params: { base: 'amount', rate: 0.1 },
        category: 'GROUP_C',
        effectiveFrom: new Date('2025-01-01'), effectiveUntil: null, version: 1, tags: [], 
        checksum: stressChecksum,
        country: 'TG'
      },
      {
        id: 'rule-mid-prio-c2-conflict',
        model: 'FLAT_RATE',
        priority: 3000,
        params: { base: 'amount', rate: 0.1 },
        category: 'GROUP_C',
        effectiveFrom: new Date('2025-01-01'), effectiveUntil: null, version: 1, tags: [], 
        checksum: stressChecksum,
        country: 'TG'
      },
      {
        id: 'rule-mid-prio-no-cat',
        model: 'FLAT_RATE',
        priority: 3000,
        params: { base: 'amount', rate: 0.1 },
        effectiveFrom: new Date('2025-01-01'), effectiveUntil: null, version: 1, tags: [], 
        checksum: stressChecksum,
        country: 'TG'
      }
    ];

    const input = {
      requestId: 'stress-001',
      data: { amount: 100 },
      meta: { 
        tenantId: 't1',
        context: { country: 'TG' }
      }
    };

    const result = await engine.evaluate(rules as any, input);

    // EXPECTATIONS:
    // - rule-high-prio: OK (10)
    // - rule-mid-prio-b: OK (10)
    // - rule-mid-prio-c1: OK (10)
    // - rule-mid-prio-c2: SKIPPED (Conflict with c1)
    // - rule-mid-prio-no-cat: OK (10) - (No cat -> unique dominance group)
    // TOTAL: 40
    
    expect(result.value).toBe(40);
    expect(result.appliedRules).toHaveLength(4);
    
    const skippedIds = result.skippedRules.map(s => s.rule.id);
    expect(skippedIds).toContain('rule-mid-prio-c2-conflict');
  });

  it('handles Meta-Rules correctly (Inhibition & Short-Circuit)', async () => {
    const zf = await engine.evaluate(JSON.parse(examples.zonefranche.rules), JSON.parse(examples.zonefranche.input));
    expect(zf.value).toBe(810000);
    expect(zf.skippedRules.some(s => s.reason === 'INHIBITED_BY_META_RULE')).toBe(true);

    const ngo = await engine.evaluate(JSON.parse(examples.ngoExempt.rules), JSON.parse(examples.ngoExempt.input));
    expect(ngo.value).toBe(0);
    expect(ngo.appliedRules.some(r => r.model === 'META_SHORT_CIRCUIT')).toBe(true);
  });
});
