// Pure ledger-row to VatLedgerEntryDraft mapping, shared by the worker (0344) and the web preview (0351).
// A value outside its enum throws with the column name only; no document content is ever put into an error.

import {
  assertCurrency,
  isLegalDate,
  type LegalDate,
  Money,
  parseLegalDate,
  VAT_RATE_TYPE_VALUES,
  VAT_TREATMENT_VALUES,
  type VatLedgerEntryDraft,
  type VatPointRule,
} from '@shoebox/domain';
import type { PeriodEntryRow } from './filings';

type KhSectionValue = NonNullable<VatLedgerEntryDraft['khSection']>;

const VAT_POINT_RULES: readonly VatPointRule[] = [
  'duzp',
  'max_duzp_received',
  'issue_date',
  'service_period_end',
  'prepayment',
  'eu_goods_15th',
  'user_override',
];
const KH_SECTIONS: readonly KhSectionValue[] = ['A1', 'A2', 'A3', 'A4', 'A5', 'B1', 'B2', 'B3'];
const SHV_CODES = [0, 1, 2, 3] as const;

export class MapError extends Error {
  constructor(readonly column: string) {
    super(`unexpected value in column ${column}`);
  }
}

/** Returns `value` when it is one of `values`; otherwise throws naming the column. */
export function oneOf<T extends string>(
  values: readonly T[],
  value: string | null | undefined,
  column: string,
): T {
  const found = values.find((v) => v === value);
  if (found === undefined) throw new MapError(column);
  return found;
}

export function legalDate(value: string | null | undefined, column: string): LegalDate {
  if (typeof value !== 'string' || !isLegalDate(value)) throw new MapError(column);
  return parseLegalDate(value);
}

export function optionalDate(value: string | null | undefined, column: string): LegalDate | null {
  return value === null || value === undefined ? null : legalDate(value, column);
}

export function entryRowToDraft(row: PeriodEntryRow): VatLedgerEntryDraft {
  const currency = assertCurrency(row.currency);
  const shvCode = row.shvCode === null ? null : (SHV_CODES.find((c) => c === row.shvCode) ?? null);
  if (row.shvCode !== null && shvCode === null) throw new MapError('shv_code');
  const rate = Number.parseFloat(row.vatRatePct);
  if (!Number.isFinite(rate)) throw new MapError('vat_rate_pct');
  return {
    periodStart: legalDate(row.periodStart, 'period_start'),
    periodEnd: legalDate(row.periodEnd, 'period_end'),
    vatPointDate: legalDate(row.vatPointDate, 'vat_point_date'),
    vatPointRule: oneOf(VAT_POINT_RULES, row.vatPointRule, 'vat_point_rule'),
    documentId: row.documentId,
    lineId: null,
    vatTreatment: oneOf(VAT_TREATMENT_VALUES, row.vatTreatment, 'vat_treatment'),
    vatRateType: oneOf(VAT_RATE_TYPE_VALUES, row.vatRateType, 'vat_rate_type'),
    vatRatePct: rate,
    baseCzk: Money.parse(row.baseCzk, 'CZK'),
    vatCzk: Money.parse(row.vatCzk, 'CZK'),
    deductionPct: row.deductionPct,
    currency,
    baseForeign: row.baseForeign === null ? null : Money.parse(row.baseForeign, currency),
    fxRate: row.fxRate,
    fxAmount: row.fxAmount,
    fxRateDate: optionalDate(row.fxRateDate, 'fx_rate_date'),
    dphdp3Rows: [...row.dphdp3Rows],
    khSection: row.khSection === null ? null : oneOf(KH_SECTIONS, row.khSection, 'kh_section'),
    khDocumentTotalCzk:
      row.khDocumentTotalCzk === null ? null : Money.parse(row.khDocumentTotalCzk, 'CZK'),
    shvCode,
    counterpartyVatId: row.counterpartyVatId,
    evidenceNumber: row.evidenceNumber,
  };
}

/** Alias kept for the worker modules (0344). */
export const toEntryDraft = entryRowToDraft;
