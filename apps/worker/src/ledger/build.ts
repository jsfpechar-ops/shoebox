import { createHash } from 'node:crypto';
import type { LedgerInputs, TaxEntryRow, VatEntryRow } from '@shoebox/db';
import {
  buildTaxLedgerEntries,
  buildVatLedgerEntries,
  type CategoryCode,
  type Direction,
  type DocumentClass,
  type DocumentStatus,
  type FxRateRow,
  type LegalDate,
  type LineType,
  Money,
  type ProfileAt,
  parseLegalDate,
  type RULE_SCHEMAS,
  type RuleResolver,
  type TaxDocStatus,
  type TaxLedgerDocument,
  type TaxLedgerEntryDraft,
  type TaxLedgerInput,
  type TaxLedgerLine,
  type VatLedgerDocument,
  type VatLedgerEntryDraft,
  type VatLedgerInput,
  type VatLedgerLine,
  type VatLedgerPartner,
  type VatLedgerRecapRow,
  type VatPeriod,
  type VatProfileSlice,
  type VatRateType,
  type VatStatus,
  type VatTreatment,
} from '@shoebox/domain';

// TODO(rules-version): createCzRules() has no version string yet.
export const RULES_VERSION = 'cz-rules-2026-10';

type Rules = RuleResolver<typeof RULE_SCHEMAS>;

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === 'object' && value !== null) {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key] = sortKeys(source[key]);
    return out;
  }
  return value;
}

/** SHA-256 hex of the canonical build inputs (M04 §4.13). `current` is excluded. */
export function inputHashOf(inputs: LedgerInputs, algoVersion: number): string {
  const { doc, lines, recap, partner, profiles, fxRates } = inputs;
  const canonical = canonicalJson({
    doc,
    lines,
    recap,
    partner,
    profiles,
    fxRates,
    payments: [],
    rules: RULES_VERSION,
    algo: algoVersion,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

function legal(value: string | null): LegalDate | null {
  return value === null ? null : parseLegalDate(value);
}

function profileAtOf(profiles: LedgerInputs['profiles']): ProfileAt {
  return (date) => {
    let hit: LedgerInputs['profiles'][number] | undefined;
    for (const profile of profiles) if (profile.validFrom <= date) hit = profile;
    if (!hit) {
      return {
        vatStatus: 'neplatce',
        vatPeriod: null,
        foreignServiceDppdPolicy: 'issue_date',
      };
    }
    return {
      vatStatus: hit.vatStatus as VatStatus,
      vatPeriod: hit.vatPeriod as VatPeriod | null,
      foreignServiceDppdPolicy: (hit.foreignServiceDppdPolicy ??
        'issue_date') as VatProfileSlice['foreignServiceDppdPolicy'],
    };
  };
}

/** Maps raw rows to builder inputs. Null when there is no issue date or direction (nothing bookable yet). */
export function toLedgerInputs(
  inputs: LedgerInputs,
  rules: Rules,
): { tax: TaxLedgerInput; vat: VatLedgerInput } | null {
  const { doc } = inputs;
  if (doc.issueDate === null || doc.direction === null) return null;
  const currency = doc.currency;
  const money = (value: string | null): Money | null =>
    value === null ? null : Money.parse(value, currency);
  const issueDate = parseLegalDate(doc.issueDate);
  const vatPointDate = legal(doc.vatPointDate);
  const profileAt = profileAtOf(inputs.profiles);
  // TODO(decision-deduction): same rule as 0319.
  const deductionAllowed = profileAt(vatPointDate ?? issueDate).vatStatus === 'platce';
  const fxRates: FxRateRow[] = inputs.fxRates.map((row) => ({
    rateDate: parseLegalDate(row.rateDate),
    currency: row.currency,
    amount: row.amount,
    rate: row.rate,
  }));

  const taxLines: TaxLedgerLine[] = inputs.lines.map((line) => ({
    lineId: line.id,
    position: line.position,
    lineType: line.lineType as LineType,
    net: money(line.net),
    vat: money(line.vat),
    gross: money(line.gross),
    categoryCode: line.categoryCode as CategoryCode | null,
    businessSharePct: line.businessSharePct,
    coveredByDocumentId: line.coveredByDocumentId,
  }));
  const taxDoc: TaxLedgerDocument = {
    documentId: doc.id,
    class: doc.class as DocumentClass,
    status: doc.status as DocumentStatus,
    deleted: doc.deleted,
    currency,
    issueDate,
    dueDate: legal(doc.dueDate),
    paidAt: legal(doc.paidAt),
    vatPointDate,
    isPaidPerDocument: doc.isPaidPerDocument,
    paymentMethod: doc.paymentMethod,
    deductionAllowed,
    lines: taxLines,
  };

  const vatLines: VatLedgerLine[] = inputs.lines.map((line) => ({
    lineId: line.id,
    position: line.position,
    lineType: line.lineType as LineType,
    net: money(line.net),
    vat: money(line.vat),
    gross: money(line.gross),
    vatTreatment: line.vatTreatment as VatTreatment | null,
    vatRateType: line.vatRateType as VatRateType,
    categoryCode: line.categoryCode as CategoryCode | null,
    businessSharePct: line.businessSharePct,
  }));
  const recap: VatLedgerRecapRow[] = inputs.recap.map((row) => ({
    vatRateType: row.vatRateType as VatRateType,
    // A rate is a percentage used to match treatments, not money.
    vatRatePct: +row.vatRatePct,
    base: Money.parse(row.base, currency),
    vat: Money.parse(row.vat, currency),
  }));
  const vatDoc: VatLedgerDocument = {
    documentId: doc.id,
    class: doc.class as DocumentClass,
    direction: doc.direction as Direction,
    taxDocStatus: doc.taxDocStatus as TaxDocStatus,
    issueDate,
    duzp: legal(doc.duzp),
    receivedDate: legal(doc.receivedDate),
    servicePeriodFrom: legal(doc.servicePeriodFrom),
    servicePeriodTo: legal(doc.servicePeriodTo),
    paidAt: legal(doc.paidAt),
    // TODO(cat-04-vat-point-override): document.vat_point_date is not loaded by loadLedgerInputs yet.
    userVatPointDate: null,
    status: doc.status as DocumentStatus,
    deleted: doc.deleted,
    businessFlag: doc.businessFlag as VatLedgerDocument['businessFlag'],
    currency,
    documentNumber: doc.documentNumber,
    totalGross: money(doc.totalGross),
    lines: vatLines,
    recap,
  };
  // TODO(P1-VAL-08): VIES validity is not checked here yet, so vatIdValid is null.
  const partner: VatLedgerPartner = inputs.partner
    ? {
        country: inputs.partner.country,
        dic: inputs.partner.dic,
        vatId: inputs.partner.vatId,
        vatIdValid: null,
      }
    : { country: null, dic: null, vatId: null, vatIdValid: null };

  return {
    tax: { doc: taxDoc, payments: [], profileAt, fxRates, rules },
    vat: { doc: vatDoc, partner, profileAt, payments: [], fxRates, deductionAllowed, rules },
  };
}

export interface LedgerDrafts {
  readonly tax: TaxEntryRow[];
  readonly vat: VatEntryRow[];
  readonly issues: Record<string, number>;
  readonly periods: string[];
  readonly taxYears: number[];
}

/** Pads a decimal string to `dp` places without rounding (for pct and rate columns with at most `dp` places). */
function fixed(text: string, dp: number): string {
  const [whole, frac = ''] = text.split('.');
  return frac.length >= dp ? text : `${whole}.${frac.padEnd(dp, '0')}`;
}

function taxRow(draft: TaxLedgerEntryDraft): TaxEntryRow {
  return {
    entryDate: draft.entryDate,
    taxYear: draft.taxYear,
    basis: draft.basis,
    lineId: draft.lineId,
    paymentLinkId: draft.paymentLinkId,
    transactionId: draft.transactionId,
    categoryCode: draft.categoryCode,
    taxEffect: draft.taxEffect,
    amountCzk: draft.amountCzk.toDecimal().toFixed(2),
    businessSharePct: fixed(draft.businessSharePct, 2),
    businessAmountCzk: draft.businessAmountCzk.toDecimal().toFixed(2),
  };
}

function vatRow(draft: VatLedgerEntryDraft): VatEntryRow {
  return {
    periodStart: draft.periodStart,
    periodEnd: draft.periodEnd,
    vatPointDate: draft.vatPointDate,
    vatPointRule: draft.vatPointRule,
    lineId: null,
    vatTreatment: draft.vatTreatment,
    vatRateType: draft.vatRateType,
    vatRatePct: draft.vatRatePct.toFixed(2),
    baseCzk: draft.baseCzk.toDecimal().toFixed(2),
    vatCzk: draft.vatCzk.toDecimal().toFixed(2),
    deductionPct: fixed(draft.deductionPct, 2),
    currency: draft.currency,
    baseForeign: draft.baseForeign === null ? null : draft.baseForeign.toDecimal().toFixed(2),
    fxRate: draft.fxRate === null ? null : fixed(draft.fxRate, 6),
    fxAmount: draft.fxAmount,
    fxRateDate: draft.fxRateDate,
    dphdp3Rows: [...draft.dphdp3Rows],
    khSection: draft.khSection,
    khDocumentTotalCzk:
      draft.khDocumentTotalCzk === null ? null : draft.khDocumentTotalCzk.toDecimal().toFixed(2),
    shvCode: draft.shvCode,
    counterpartyVatId: draft.counterpartyVatId,
    evidenceNumber: draft.evidenceNumber,
  };
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Pure: the rows the two builders would write for one document. */
export function computeLedgerDrafts(inputs: LedgerInputs, rules: Rules): LedgerDrafts {
  const mapped = toLedgerInputs(inputs, rules);
  if (!mapped) return { tax: [], vat: [], issues: {}, periods: [], taxYears: [] };

  const tax = buildTaxLedgerEntries(mapped.tax)
    .map(taxRow)
    .sort(
      (a, b) =>
        compareText(a.entryDate, b.entryDate) ||
        compareText(a.lineId ?? '', b.lineId ?? '') ||
        compareText(a.basis, b.basis),
    );
  const result = buildVatLedgerEntries(mapped.vat);
  const vat = result.entries
    .map(vatRow)
    .sort(
      (a, b) =>
        compareText(a.vatPointDate, b.vatPointDate) ||
        compareText(a.vatTreatment, b.vatTreatment) ||
        compareText(a.vatRateType, b.vatRateType),
    );

  const issues: Record<string, number> = {};
  for (const issue of result.issues) issues[issue.code] = (issues[issue.code] ?? 0) + 1;

  const periods = [...new Set(vat.map((row) => row.periodStart))].sort(compareText);
  const taxYears = [...new Set(tax.map((row) => row.taxYear))].sort((a, b) => a - b);
  return { tax, vat, issues, periods, taxYears };
}
