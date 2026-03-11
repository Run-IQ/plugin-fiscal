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

/**
 * Resolves a default priority value from jurisdiction level and scope.
 *
 * Priority hierarchy: NATIONAL (3000) > REGIONAL (2000) > MUNICIPAL (1000),
 * refined by scope: USER (x1.2) > ORGANIZATION (x1.1) > GLOBAL (x1.0).
 *
 * **Priority override behavior:** When a rule has an explicit `priority` field
 * set, it bypasses this jurisdiction-based resolution entirely. The explicit
 * priority takes precedence, allowing rule authors to override the default
 * hierarchy when needed (e.g., a municipal rule that must outrank a national
 * rule in a specific context). This override is applied in FiscalPlugin's
 * `beforeEvaluate` hook — see the priority assignment logic there.
 */
export class JurisdictionResolver {
  static resolve(jurisdiction: FiscalJurisdiction, scope: FiscalScope): number {
    const base = JURISDICTION_BASE[jurisdiction];
    const multiplier = SCOPE_MULTIPLIER[scope];
    return Math.round(base * multiplier);
  }
}
