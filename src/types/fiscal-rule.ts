import type { Rule } from '@run-iq/core';
import type { FiscalJurisdiction } from './jurisdiction.js';
import type { FiscalCalculationModel } from './models.js';
import type {
  FlatRateParams,
  BracketParams,
  MinimumTaxParams,
  ThresholdParams,
  FixedAmountParams,
  CompositeParams,
} from './params.js';
import type {
  InhibitionParams,
  SubstitutionParams,
  ShortCircuitParams,
} from './meta-params.js';

export type FiscalScope = 'GLOBAL' | 'ORGANIZATION' | 'USER';

export interface FiscalRule extends Rule {
  readonly model: FiscalCalculationModel;
  readonly jurisdiction: FiscalJurisdiction;
  readonly scope: FiscalScope;
  readonly country: string;
  readonly category: string;
  readonly params:
    | FlatRateParams
    | BracketParams
    | MinimumTaxParams
    | ThresholdParams
    | FixedAmountParams
    | CompositeParams
    | InhibitionParams
    | SubstitutionParams
    | ShortCircuitParams;
}
