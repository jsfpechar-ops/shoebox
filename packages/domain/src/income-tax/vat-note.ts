import type { LegalDate } from '../dates/index';
import type { VatStatus } from '../enums/index';
import { CZK, Money } from '../money/index';
import type { CzRules } from '../vat/period';

export interface VatNoteInput {
  readonly year: number;
  readonly segments: ReadonlyArray<{
    readonly validFrom: LegalDate;
    readonly validTo: LegalDate | null;
    readonly vatStatus: VatStatus;
  }>;
  readonly vatPayments: Money; // Σ tax_vat_payment in the year (absolute)
  readonly vatFilings: ReadonlyArray<{
    readonly periodStart: LegalDate;
    readonly row64: Money;
    readonly state: string;
  }>;
  readonly domesticCashIncome: Money;
}
export type VatNoteKind = 'payer' | 'io' | 'none' | 'mixed';
export interface VatNote {
  readonly kind: VatNoteKind;
  readonly textKey: `podklady.vat.${VatNoteKind}`;
  readonly segments: ReadonlyArray<{
    readonly from: LegalDate;
    readonly to: LegalDate | null;
    readonly vatStatus: VatStatus;
  }>;
  readonly vatPaid: Money;
  readonly filings: VatNoteInput['vatFilings'];
  readonly registrationWarning: boolean;
  readonly registrationThreshold: Money;
}

/** M06 §4.7: VAT status of the year, VAT paid, filings and the registration-threshold warning. */
export function buildVatNote(input: VatNoteInput, rules: CzRules): VatNote {
  const yearStart = `${input.year}-01-01`;
  const yearEnd = `${input.year}-12-31`;

  const segments = input.segments
    .filter((s) => s.validFrom <= yearEnd && (s.validTo === null || s.validTo >= yearStart))
    .map((s) => ({
      from: (s.validFrom < yearStart ? yearStart : s.validFrom) as LegalDate,
      to: s.validTo === null ? null : ((s.validTo > yearEnd ? yearEnd : s.validTo) as LegalDate),
      vatStatus: s.vatStatus,
    }))
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));

  const statuses = new Set(segments.map((s) => s.vatStatus));
  const kind: VatNoteKind =
    statuses.size > 1
      ? 'mixed'
      : statuses.has('platce')
        ? 'payer'
        : statuses.has('identifikovana_osoba')
          ? 'io'
          : 'none';

  const registrationThreshold = Money.parse(
    String(rules.at(`${input.year}-12-31`).get('vat.registration_thresholds').calendar_year),
    CZK,
  );

  return {
    kind,
    textKey: `podklady.vat.${kind}` as const,
    segments,
    vatPaid: input.vatPayments.abs(),
    filings: input.vatFilings,
    registrationWarning:
      kind !== 'payer' &&
      input.domesticCashIncome.toDecimal().gt(registrationThreshold.toDecimal()),
    registrationThreshold,
  };
}
