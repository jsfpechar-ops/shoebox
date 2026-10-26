// Row to domain mapping for the VAT filing jobs (0344). Pure. A value outside its enum throws with
// the column name only; no document content is ever put into an error.

import type {
  PeriodDocumentRow,
  PeriodEntryRow,
  PeriodLedger,
  ProfileVersionRow,
} from '@shoebox/db';
import {
  assertCurrency,
  type BusinessFlag,
  DOCUMENT_CLASS_VALUES,
  DOCUMENT_STATUS_VALUES,
  type EpoTaxpayerProfile,
  isLegalDate,
  type KhDocumentLookup,
  type LegalDate,
  LINE_TYPE_VALUES,
  Money,
  type PeriodClassifierInput,
  type PeriodDocument,
  parseLegalDate,
  TAX_DOC_STATUS_VALUES,
  VAT_PERIOD_VALUES,
  VAT_RATE_TYPE_VALUES,
  VAT_STATUS_VALUES,
  VAT_TREATMENT_VALUES,
  type VatLedgerEntryDraft,
  type VatPointRule,
  type VatStatus,
} from '@shoebox/domain';

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
const BUSINESS_FLAGS: readonly BusinessFlag[] = ['business', 'personal', 'mixed', 'unknown'];
const ENTITY_TYPES = ['osvc', 'sro'] as const;
const SHV_CODES = [0, 1, 2, 3] as const;
const FOREIGN_POLICIES = ['issue_date', 'service_period_end'] as const;

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

function legalDate(value: string | null | undefined, column: string): LegalDate {
  if (typeof value !== 'string' || !isLegalDate(value)) throw new MapError(column);
  return parseLegalDate(value);
}

function optionalDate(value: string | null | undefined, column: string): LegalDate | null {
  return value === null || value === undefined ? null : legalDate(value, column);
}

export function vatStatusOf(value: string): VatStatus {
  return oneOf(VAT_STATUS_VALUES, value, 'vat_status');
}

export function toEntryDraft(row: PeriodEntryRow): VatLedgerEntryDraft {
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

function toPeriodDocument(doc: PeriodDocumentRow): PeriodDocument {
  return {
    documentId: doc.id,
    class: oneOf(DOCUMENT_CLASS_VALUES, doc.class, 'documents.class'),
    status: oneOf(DOCUMENT_STATUS_VALUES, doc.status, 'documents.status'),
    taxDocStatus: oneOf(TAX_DOC_STATUS_VALUES, doc.taxDocStatus, 'documents.tax_doc_status'),
    businessFlag: oneOf(BUSINESS_FLAGS, doc.businessFlag, 'documents.business_flag'),
    vatPointDate: optionalDate(doc.vatPointDate, 'documents.vat_point_date'),
    correctsDocumentId: doc.correctsDocumentId,
    correctsVatPointDate: optionalDate(doc.correctsVatPointDate, 'corrected.vat_point_date'),
    partner: {
      dic: doc.partner?.dic ?? null,
      vatId: doc.partner?.vatId ?? null,
      vatIdValid: doc.partner?.vatIdValid ?? null,
      documentShowsDic: doc.partner?.documentShowsDic ?? false,
    },
    hasBlockingValidation: doc.hasBlockingValidation,
    lines: doc.lines.map((l) => ({
      lineType: oneOf(LINE_TYPE_VALUES, l.lineType, 'document_lines.line_type'),
      vatTreatment:
        l.vatTreatment === null
          ? null
          : oneOf(VAT_TREATMENT_VALUES, l.vatTreatment, 'document_lines.vat_treatment'),
      vatRateType: oneOf(VAT_RATE_TYPE_VALUES, l.vatRateType, 'document_lines.vat_rate_type'),
      businessSharePct: l.businessSharePct,
      rcCommodityCode: l.rcCommodityCode,
      categoryCode: l.categoryCode,
      linkedIssuedInvoiceId: l.linkedIssuedInvoiceId,
    })),
  };
}

// TODO(0325-issues): ledger issues are recomputed by 0325's build and will be joined later.
export function toClassifierInput(
  ledger: PeriodLedger,
  status: VatStatus,
  period: { start: LegalDate; end: LegalDate },
  evaluatedAt: string,
): PeriodClassifierInput {
  return {
    status,
    period: { start: period.start, end: period.end },
    entries: ledger.entries.map(toEntryDraft),
    documents: ledger.documents.map(toPeriodDocument),
    profiles: ledger.profiles.map((p) => ({
      validFrom: legalDate(p.validFrom, 'taxpayer_profiles.valid_from'),
      validTo: optionalDate(p.validTo, 'taxpayer_profiles.valid_to'),
      vatStatus: vatStatusOf(p.vatStatus),
      vatPeriod: p.vatPeriod === null ? null : oneOf(VAT_PERIOD_VALUES, p.vatPeriod, 'vat_period'),
      entityType: oneOf(ENTITY_TYPES, p.entityType, 'entity_type'),
    })),
    ledgerIssues: [],
    evaluatedAt,
  };
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function addressOf(value: unknown): EpoTaxpayerProfile['address'] {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  return {
    street: textOf(record.street),
    house_number: textOf(record.house_number),
    orientation_number: textOf(record.orientation_number),
    city: textOf(record.city),
    zip: textOf(record.zip),
  };
}

export function toEpoProfile(p: ProfileVersionRow, status: VatStatus): EpoTaxpayerProfile {
  return {
    vatStatus: status,
    dic: p.dic,
    firstName: p.firstName,
    lastName: p.lastName,
    title: p.title,
    address: addressOf(p.address),
    fuCode: p.fuCode,
    ufoCode: p.ufoCode,
    mainActivityNace: p.mainActivityNace,
    filingEmail: p.filingEmail,
    filingPhone: p.filingPhone,
  };
}

export function foreignPolicyOf(p: ProfileVersionRow): (typeof FOREIGN_POLICIES)[number] {
  return oneOf(FOREIGN_POLICIES, p.foreignServiceDppdPolicy, 'foreign_service_dppd_policy');
}

/** Latest profile whose valid_from is on or before `date` (and not ended before it). */
export function profileAt(
  profiles: readonly ProfileVersionRow[],
  date: LegalDate,
): ProfileVersionRow | null {
  let best: ProfileVersionRow | null = null;
  for (const p of profiles) {
    if (p.validFrom > date) continue;
    if (p.validTo !== null && p.validTo < date) continue;
    if (best === null || p.validFrom > best.validFrom) best = p;
  }
  return best;
}

export function khLookup(ledger: PeriodLedger): KhDocumentLookup {
  const byId = new Map(ledger.documents.map((d) => [d.id, d] as const));
  return (documentId) => {
    const doc = byId.get(documentId);
    if (doc === undefined) return undefined;
    return {
      duzp: optionalDate(doc.duzp ?? doc.vatPointDate, 'documents.duzp'),
      partnerCountry: doc.partner?.country ?? null,
    };
  };
}
