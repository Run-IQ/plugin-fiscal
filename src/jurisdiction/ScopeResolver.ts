import type { FiscalScope } from '../types/fiscal-rule.js';

const SCOPE_MULTIPLIER: Record<FiscalScope, number> = {
  GLOBAL: 1.0,
  ORGANIZATION: 1.1,
  USER: 1.2,
};

export class ScopeResolver {
  static getMultiplier(scope: FiscalScope): number {
    return SCOPE_MULTIPLIER[scope];
  }
}
