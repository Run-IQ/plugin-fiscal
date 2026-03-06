import type { FiscalRule } from '../types/fiscal-rule.js';

const VALID_JURISDICTIONS = ['NATIONAL', 'REGIONAL', 'MUNICIPAL'];
const VALID_SCOPES = ['GLOBAL', 'ORGANIZATION', 'USER'];

export class FiscalRuleValidator {
  static validate(rule: unknown): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (rule === null || typeof rule !== 'object') {
      return { valid: false, errors: ['rule must be an object'] };
    }

    const r = rule as Partial<FiscalRule>;

    if (!r.jurisdiction || !VALID_JURISDICTIONS.includes(r.jurisdiction)) {
      errors.push(`jurisdiction must be one of: ${VALID_JURISDICTIONS.join(', ')}`);
    }
    if (!r.scope || !VALID_SCOPES.includes(r.scope)) {
      errors.push(`scope must be one of: ${VALID_SCOPES.join(', ')}`);
    }
    if (typeof r.country !== 'string' || r.country.length === 0) {
      errors.push('country must be a non-empty string');
    }
    if (typeof r.category !== 'string' || r.category.length === 0) {
      errors.push('category must be a non-empty string');
    }

    return { valid: errors.length === 0, errors };
  }
}
