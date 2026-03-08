export interface InhibitionParams {
  /** Rule IDs to inhibit */
  readonly targetIds?: readonly string[];
  /** Tags — inhibit rules matching ANY of these tags */
  readonly targetTags?: readonly string[];
  /** Categories — inhibit rules matching ANY of these categories */
  readonly targetCategories?: readonly string[];
}

export interface SubstitutionParams {
  /** Target model to substitute params for */
  readonly targetModel: string;
  /** Rule IDs to apply substitution to (if empty, applies to all matching model) */
  readonly targetIds?: readonly string[];
  /** Tags — apply to rules matching ANY of these tags */
  readonly targetTags?: readonly string[];
  /** New params to replace existing params with */
  readonly newParams: Record<string, unknown>;
}

export interface ShortCircuitParams {
  /** Value to return (typically 0 for exempt entities) */
  readonly value: number;
  /** Human-readable reason for short-circuit */
  readonly reason: string;
}
