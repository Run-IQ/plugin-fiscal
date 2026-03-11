// Public API — FiscalPlugin is the sole entry point for consumers
export { FiscalPlugin } from './FiscalPlugin.js';
export { fiscalDescriptor } from './descriptor.js';
export { default } from './bundle.js';

// Public types — domain interfaces for consumers to type rule definitions
export type { FiscalRule, FiscalScope } from './types/fiscal-rule.js';
export type { FiscalJurisdiction } from './types/jurisdiction.js';
export type { FiscalCalculationModel } from './types/models.js';
export type {
  FlatRateParams,
  BracketParams,
  MinimumTaxParams,
  ThresholdParams,
  FixedAmountParams,
  CompositeParams,
} from './types/params.js';
export type {
  InhibitionParams,
  SubstitutionParams,
  ShortCircuitParams,
} from './types/meta-params.js';
