// Podklady API contract (0365, lane D). Money is a toFixed2() string, dates are YYYY-MM-DD.

import { Money } from '@shoebox/domain';

export type MoneyString = string;

export interface PodkladyFilingView {
  readonly id: string;
  readonly state: string;
  readonly generatedAt: string | null;
  readonly markedFiledAt: string | null;
  readonly pdf: boolean;
  readonly xlsx: boolean;
  readonly ledgerHash: string | null;
  readonly answersVersion: number | null;
}

export interface TotalsDiff {
  readonly field: 'income' | 'expenses' | 'base';
  readonly before: MoneyString;
  readonly after: MoneyString;
}

export interface PodkladyPreviewView {
  readonly year: number;
  readonly empty: boolean;
  readonly blocked: boolean;
  readonly watermark: boolean;
  /** PodkladySummary with Money serialized (serializeMoney). */
  readonly summary: unknown;
  readonly readiness: ReadonlyArray<{
    code: string;
    severity: string;
    params: Record<string, string | number>;
  }>;
  readonly latestFiling: PodkladyFilingView | null;
  readonly changedSinceGeneration: boolean;
  readonly changedSinceHandoff: boolean;
  readonly diff: readonly TotalsDiff[];
  readonly canGenerate: boolean;
  readonly canDownload: boolean;
  readonly partialXmlEligible: boolean;
  /** /api/v1/filings/{id}/download?format=pdf|xlsx */
  readonly downloadUrls: { pdf: string | null; xlsx: string | null };
}

export interface PodkladyCardView {
  readonly year: number;
  readonly show: boolean;
  readonly reason: 'season' | 'on_demand' | 'no_data';
}

export interface TaxReserveView {
  readonly kind: 'estimate' | 'pausalni_dan' | 'none';
  readonly asOf: string | null;
  readonly computedAt: string | null;
  readonly display: MoneyString | null;
  readonly paid: MoneyString | null;
  readonly due: MoneyString | null;
  readonly labelKey: 'reserve.label' | 'reserve.pausalni_dan';
  readonly badgeKey: 'reserve.badge';
  readonly howKey: 'reserve.how';
  readonly payload: unknown;
}

/** JSON round-trip with every Money turned into its toFixed2() string (Money.toJSON runs before the replacer, so the raw value is read from `this`). */
export function serializeMoney<T>(value: T): unknown {
  return JSON.parse(
    JSON.stringify(value, function (this: Record<string, unknown>, key: string, v: unknown) {
      const raw = this[key];
      return raw instanceof Money ? raw.toFixed2() : v;
    }),
  );
}
