export interface FlatRateParams {
  readonly rate: number;
  readonly base: string;
}

export interface BracketParams {
  readonly base: string;
  readonly brackets: ReadonlyArray<{
    readonly from: number;
    readonly to: number | null;
    readonly rate: number;
  }>;
}

export interface MinimumTaxParams {
  readonly rate: number;
  readonly base: string;
  readonly minimum: number;
}

export interface ThresholdParams {
  readonly base: string;
  readonly threshold: number;
  readonly rate: number;
  readonly above_only: boolean;
}

export interface FixedAmountParams {
  readonly amount: number;
  readonly currency: string;
}

export interface CompositeParams {
  readonly steps: ReadonlyArray<{
    readonly model: string;
    readonly params: unknown;
    readonly label?: string | undefined;
  }>;
  readonly aggregation: 'SUM' | 'MAX' | 'MIN';
}
