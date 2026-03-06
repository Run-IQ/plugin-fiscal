import type { FiscalJurisdiction } from '../types/jurisdiction.js';
import type { FiscalScope } from '../types/fiscal-rule.js';

const JURISDICTION_BASE: Record<FiscalJurisdiction, number> = {
  NATIONAL: 3000,
  REGIONAL: 2000,
  MUNICIPAL: 1000,
};

const SCOPE_MULTIPLIER: Record<FiscalScope, number> = {
  GLOBAL: 1.0,
  ORGANIZATION: 1.1,
  USER: 1.2,
};

export class JurisdictionResolver {
  static resolve(jurisdiction: FiscalJurisdiction, scope: FiscalScope): number {
    const base = JURISDICTION_BASE[jurisdiction];
    const multiplier = SCOPE_MULTIPLIER[scope];
    return Math.round(base * multiplier);
  }
}
