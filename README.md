# @run-iq/plugin-fiscal

Fiscal domain plugin for the PPE engine — provides tax calculation models, jurisdiction resolution, and fiscal rule validation.

## Install

```bash
npm install @run-iq/plugin-fiscal
```

**Peer dependencies:** `@run-iq/core >= 0.1.0`, `@run-iq/plugin-sdk >= 0.1.0`

## Usage

```typescript
import { PPEEngine } from '@run-iq/core';
import { JsonLogicEvaluator } from '@run-iq/dsl-jsonlogic';
import { FiscalPlugin } from '@run-iq/plugin-fiscal';

const engine = new PPEEngine({
  plugins: [new FiscalPlugin()],
  dsls: [new JsonLogicEvaluator()],
  strict: true,
});

const result = await engine.evaluate(rules, {
  requestId: 'calc-001',
  data: { grossSalary: 2_500_000, country: 'TG' },
  meta: { tenantId: 'tenant-1' },
});
```

## Calculation models

| Model | Key | Description |
|---|---|---|
| `FlatRateModel` | `FLAT_RATE` | `base x rate` |
| `ProgressiveBracketModel` | `PROGRESSIVE_BRACKET` | Cumulative tax brackets |
| `MinimumTaxModel` | `MINIMUM_TAX` | `max(base x rate, minimum)` |
| `ThresholdModel` | `THRESHOLD` | Applies above a threshold value |
| `FixedAmountModel` | `FIXED_AMOUNT` | Fixed amount regardless of input |
| `CompositeModel` | `COMPOSITE` | Aggregates sub-models via `SUM`, `MAX`, or `MIN` |

All models use `decimal.js` for arithmetic — no floating-point drift.

## Jurisdiction resolution

`JurisdictionResolver` scores rules by jurisdiction level, `ScopeResolver` by scope:

| Jurisdiction | Base score |
|---|---|
| `NATIONAL` | 3000 |
| `REGIONAL` | 2000 |
| `MUNICIPAL` | 1000 |

| Scope | Multiplier |
|---|---|
| `GLOBAL` | x1.0 |
| `ORGANIZATION` | x1.1 |
| `USER` | x1.2 |

Higher score wins. Example: `NATIONAL + ORGANIZATION` (3300) beats `NATIONAL + GLOBAL` (3000).

## Plugin hooks

`FiscalPlugin` implements:

- **`beforeEvaluate`** — filters rules by jurisdiction and country
- **`afterEvaluate`** — enriches result with `fiscalBreakdown` grouped by tax category

## Exports

```typescript
// Plugin
FiscalPlugin

// Models
FlatRateModel, ProgressiveBracketModel, MinimumTaxModel,
ThresholdModel, FixedAmountModel, CompositeModel

// Jurisdiction
JurisdictionResolver, ScopeResolver

// Validators
FiscalRuleValidator, ParamsValidator

// Types
FiscalRule, FiscalScope, FiscalJurisdiction,
FiscalCalculationModel, FlatRateParams, BracketParams,
MinimumTaxParams, ThresholdParams, FixedAmountParams, CompositeParams
```

## Requirements

- Node.js >= 20
- `@run-iq/core` >= 0.1.0
- `@run-iq/plugin-sdk` >= 0.1.0

## License

Source-Available — commercial use requires a paid license. See [LICENSE](./LICENSE).
