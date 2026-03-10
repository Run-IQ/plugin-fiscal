import { describe, it, expect } from 'vitest';
import { PPEEngine, computeRuleChecksum } from '@run-iq/core';
import type { ISnapshotAdapter, Snapshot, Rule } from '@run-iq/core';
import { JsonLogicEvaluator } from '@run-iq/dsl-jsonlogic';
import { FiscalPlugin } from '../../src/FiscalPlugin.js';
import type { FiscalRule } from '../../src/types/fiscal-rule.js';
import { VERSION } from '../../src/utils';

class InMemorySnapshotAdapter implements ISnapshotAdapter {
  private readonly snapshots = new Map<string, Snapshot>();
  private readonly requestIds = new Set<string>();

  async save(snapshot: Snapshot): Promise<string> {
    this.snapshots.set(snapshot.id, snapshot);
    this.requestIds.add(snapshot.requestId);
    return snapshot.id;
  }

  async get(snapshotId: string): Promise<Snapshot> {
    const s = this.snapshots.get(snapshotId);
    if (!s) throw new Error(`Not found: ${snapshotId}`);
    return s;
  }

  async exists(requestId: string): Promise<boolean> {
    return this.requestIds.has(requestId);
  }
}

function makeFiscalRule(overrides: Partial<FiscalRule> & { id: string }): Rule {
  const params = overrides.params ?? { rate: 0.18, base: 'amount' };
  const model = overrides.model ?? 'FLAT_RATE';
  const { checksum: _ignored, ...cleanOverrides } = overrides;
  const ruleWithoutChecksum = {
    version: 1,
    model,
    priority: 100,
    effectiveFrom: new Date('2024-01-01'),
    effectiveUntil: null,
    tags: [],
    params,
    jurisdiction: 'NATIONAL',
    scope: 'GLOBAL',
    country: 'TG',
    category: 'TVA',
    ...cleanOverrides,
  };
  const checksum = computeRuleChecksum(ruleWithoutChecksum);
  return {
    ...ruleWithoutChecksum,
    checksum,
  } as unknown as Rule;
}

describe('Fiscal Plugin + Core Integration', () => {
  it('evaluates TVA rule end-to-end', async () => {
    const adapter = new InMemorySnapshotAdapter();
    const engine = new PPEEngine({
      plugins: [new FiscalPlugin()],
      dsls: [new JsonLogicEvaluator()],
      snapshot: adapter,
      strict: false,
      onConflict: 'first',
    });

    const tvaParams = { rate: 0.18, base: 'amount_excl_tax' };
    const rules = [
      makeFiscalRule({
        id: 'tva-tg-2025',
        model: 'FLAT_RATE',
        params: tvaParams,

        category: 'TVA',
      }),
    ];

    const input = {
      requestId: 'fiscal-test-001',
      data: { amount_excl_tax: 1500000 },
      meta: {
        tenantId: 'tenant-togo',
        context: { country: 'TG' },
      },
    };

    const result = await engine.evaluate(rules, input);
    expect(result.value).toBe(270000);
    expect(result.appliedRules).toHaveLength(1);
    expect(result.snapshotId).toBeTruthy();
    expect(result.dslVersions['jsonlogic']).toBeDefined();
    expect(result.pluginVersions['@run-iq/plugin-fiscal']).toBe(VERSION);
    expect(result.trace.steps).toHaveLength(1);
  });

  it('evaluates with JSONLogic condition', async () => {
    const engine = new PPEEngine({
      plugins: [new FiscalPlugin()],
      dsls: [new JsonLogicEvaluator()],
      strict: false,
      onConflict: 'first',
    });

    const tvaParams = { rate: 0.18, base: 'amount' };
    const rules = [
      makeFiscalRule({
        id: 'tva-conditional',
        model: 'FLAT_RATE',
        params: tvaParams,

        condition: {
          dsl: 'jsonlogic',
          value: { '>=': [{ var: 'amount' }, 1000000] },
        },
      }),
    ];

    // Amount below threshold -> rule skipped
    const result1 = await engine.evaluate(rules, {
      requestId: 'cond-test-1',
      data: { amount: 500000 },
      meta: { tenantId: 't', context: { country: 'TG' } },
    });
    expect(result1.value).toBe(0);
    expect(result1.skippedRules.length).toBeGreaterThan(0);

    // Amount above threshold -> rule applied
    const result2 = await engine.evaluate(rules, {
      requestId: 'cond-test-2',
      data: { amount: 2000000 },
      meta: { tenantId: 't', context: { country: 'TG' } },
    });
    expect(result2.value).toBe(360000);
  });

  it('IS Togo with minimum tax (27%, min 500,000)', async () => {
    const engine = new PPEEngine({
      plugins: [new FiscalPlugin()],
      dsls: [new JsonLogicEvaluator()],
      strict: false,
      onConflict: 'first',
    });

    const isParams = { rate: 0.27, base: 'taxable_profit', minimum: 500000 };
    const rules = [
      makeFiscalRule({
        id: 'is-tg-2025',
        model: 'MINIMUM_TAX',
        params: isParams,

        category: 'IS',
      }),
    ];

    // Low profit -> minimum applies
    const result1 = await engine.evaluate(rules, {
      requestId: 'is-test-1',
      data: { taxable_profit: 1000000 },
      meta: { tenantId: 't', context: { country: 'TG' } },
    });
    expect(result1.value).toBe(500000);

    // High profit -> computed > minimum
    const result2 = await engine.evaluate(rules, {
      requestId: 'is-test-2',
      data: { taxable_profit: 5000000 },
      meta: { tenantId: 't', context: { country: 'TG' } },
    });
    expect(result2.value).toBe(1350000);
  });

  it('IRPP Togo progressive brackets', async () => {
    const engine = new PPEEngine({
      plugins: [new FiscalPlugin()],
      dsls: [new JsonLogicEvaluator()],
      strict: false,
      onConflict: 'first',
    });

    const irppParams = {
      base: 'net_taxable_income',
      brackets: [
        { from: 0, to: 900000, rate: 0 },
        { from: 900000, to: 1800000, rate: 0.1 },
        { from: 1800000, to: 3600000, rate: 0.15 },
        { from: 3600000, to: null, rate: 0.35 },
      ],
    };

    const rules = [
      makeFiscalRule({
        id: 'irpp-tg-2025',
        model: 'PROGRESSIVE_BRACKET',
        params: irppParams,

        category: 'IRPP',
      }),
    ];

    const result = await engine.evaluate(rules, {
      requestId: 'irpp-test-1',
      data: { net_taxable_income: 5000000 },
      meta: { tenantId: 't', context: { country: 'TG' } },
    });

    expect(result.value).toBe(850000);
    expect(result.appliedRules).toHaveLength(1);
  });

  it('idempotence: same requestId = cached result', async () => {
    const adapter = new InMemorySnapshotAdapter();
    const engine = new PPEEngine({
      plugins: [new FiscalPlugin()],
      dsls: [new JsonLogicEvaluator()],
      snapshot: adapter,
      strict: false,
      onConflict: 'first',
    });

    const tvaParams = { rate: 0.18, base: 'amount' };
    const rules = [
      makeFiscalRule({
        id: 'tva-idemp',
        params: tvaParams,
      }),
    ];

    const input = {
      requestId: 'idemp-fiscal-001',
      data: { amount: 1000000 },
      meta: { tenantId: 't', context: { country: 'TG' } },
    };

    await engine.evaluate(rules, input);
    const result2 = await engine.evaluate(rules, input);
    expect(result2.snapshotId).toBe('cached');
  });

  it('snapshot is created with trace', async () => {
    const adapter = new InMemorySnapshotAdapter();
    const engine = new PPEEngine({
      plugins: [new FiscalPlugin()],
      dsls: [new JsonLogicEvaluator()],
      snapshot: adapter,
      strict: false,
      onConflict: 'first',
    });

    const tvaParams = { rate: 0.18, base: 'amount' };
    const rules = [
      makeFiscalRule({
        id: 'tva-snap',
        params: tvaParams,
      }),
    ];

    const result = await engine.evaluate(rules, {
      requestId: 'snap-test-001',
      data: { amount: 1000000 },
      meta: { tenantId: 't', context: { country: 'TG' } },
    });

    expect(result.snapshotId).toBeTruthy();
    expect(result.snapshotId).not.toBe('cached');
    expect(result.trace.steps.length).toBeGreaterThan(0);
  });
});
