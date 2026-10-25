/**
 * Přehled totals (M09 §4.1, §4.3, §4.4.1 turnover).
 *
 * Phase 1 sums document lines directly until M04's ledger kernel exists.
 * Pure: `asOf` is passed in, no wall clock. Money is `Money` only (ADR-007).
 */
import type { LegalDate } from '../dates/index';
import type {
  Direction,
  DocumentClass,
  DocumentStatus,
  LineType,
  TaxEffect,
  VatStatus,
  VatTreatment,
} from '../enums/index';
import { CZK, Money } from '../money/index';

export interface OverviewLine {
  readonly lineType: LineType;
  readonly net: string | null; // decimal literal, as stored (numeric(15,2))
  readonly gross: string | null;
  readonly vatTreatment: VatTreatment | null;
  readonly taxEffect: TaxEffect | null; // categories.tax_effect of the line's category; null = not categorized
  readonly businessSharePct: string; // '100'
}

export interface OverviewDocument {
  readonly status: DocumentStatus;
  readonly class: DocumentClass;
  readonly direction: Direction | null;
  readonly businessFlag: 'business' | 'personal' | 'mixed' | 'unknown';
  readonly deleted: boolean;
  readonly duzp: LegalDate | null;
  readonly issueDate: LegalDate | null;
  readonly receivedDate: LegalDate | null;
  readonly servicePeriodTo: LegalDate | null;
  readonly currency: string;
  readonly fxRate: string | null;
  readonly totalGross: string | null;
  readonly partnerCountry: string | null;
  readonly partnerVatId: string | null;
  readonly lines: readonly OverviewLine[];
}

export interface PeriodTotals {
  readonly income: Money;
  readonly expenses: Money;
}

export interface OverviewTotals {
  readonly month: PeriodTotals;
  readonly ytd: PeriodTotals;
  readonly turnoverYtd: Money;
  readonly countedCount: number; // counted documents dated in the ytd period
  readonly pending: { readonly count: number; readonly grossCzk: Money };
}

const COUNTED_STATUSES: ReadonlySet<string> = new Set(['ready', 'finalized']);

const PENDING_STATUSES: ReadonlySet<string> = new Set([
  'received',
  'splitting',
  'classifying',
  'extracting',
  'validating',
  'categorizing',
  'needs_review',
]);

const BOOKABLE_CLASSES: ReadonlySet<string> = new Set([
  'received_invoice',
  'received_receipt',
  'received_credit_note',
  'received_advance_tax_doc',
  'issued_invoice',
  'issued_credit_note',
  'platform_statement',
]);

const INCOME_EFFECTS: ReadonlySet<string> = new Set(['taxable_income']);

const EXPENSE_EFFECTS: ReadonlySet<string> = new Set([
  'deductible_expense',
  'non_deductible_expense',
  'asset',
]);

const CREDIT_NOTE_CLASSES: ReadonlySet<string> = new Set([
  'received_credit_note',
  'issued_credit_note',
]);

// TODO(verify): move to rule key vat.registration_turnover_policy (M09 §4.4.1)
const TURNOVER_EXCLUDED_TREATMENTS: ReadonlySet<string> = new Set([
  'iss_eu_service',
  'iss_eu_goods',
  'iss_non_eu_service',
  'iss_export_goods',
  'iss_exempt',
]);

/** Document date: platform statements use the service period end, others DUZP, issue date, received date. */
export function overviewDocDate(doc: OverviewDocument): LegalDate | null {
  if (doc.class === 'platform_statement') {
    return doc.servicePeriodTo ?? doc.issueDate ?? doc.receivedDate;
  }
  return doc.duzp ?? doc.issueDate ?? doc.receivedDate;
}

/** Converts an amount in the document currency to CZK; null when a foreign rate is missing. */
function inCzk(amount: string, currency: string, fxRate: string | null): Money | null {
  if (currency === CZK) {
    return Money.parse(amount, CZK);
  }
  if (fxRate === null) {
    return null;
  }
  // The amount is in `currency`; the Money is built in CZK once the rate is applied.
  return Money.parse(amount, CZK).multiply(fxRate);
}

/** Line base in CZK without the business share; credit notes always negative. */
function lineBaseCzk(
  doc: OverviewDocument,
  line: OverviewLine,
  vatStatus: VatStatus,
): Money | null {
  const base = vatStatus === 'platce' ? line.net : (line.gross ?? line.net);
  if (base === null) {
    return null;
  }
  const amount = inCzk(base, doc.currency, doc.fxRate);
  if (amount === null) {
    return null;
  }
  return CREDIT_NOTE_CLASSES.has(doc.class) ? amount.abs().negate() : amount;
}

interface PricedLine {
  readonly taxEffect: TaxEffect;
  readonly amount: Money; // business share applied
}

/** Returns the priced non-text lines when the document is counted, otherwise null. */
function pricedLines(doc: OverviewDocument, vatStatus: VatStatus): readonly PricedLine[] | null {
  const priced: PricedLine[] = [];
  for (const line of doc.lines) {
    if (line.lineType === 'text') {
      continue;
    }
    const base = lineBaseCzk(doc, line, vatStatus);
    if (line.taxEffect === null || base === null) {
      return null;
    }
    priced.push({
      taxEffect: line.taxEffect,
      amount: base.multiply(line.businessSharePct).divide('100'),
    });
  }
  return priced.length > 0 ? priced : null;
}

/** Turnover amount of one line in CZK: net (or gross), no business share. */
function turnoverAmountCzk(doc: OverviewDocument, line: OverviewLine): Money | null {
  const raw = line.net ?? line.gross;
  if (raw === null) {
    return null;
  }
  const amount = inCzk(raw, doc.currency, doc.fxRate);
  if (amount === null) {
    return null;
  }
  return CREDIT_NOTE_CLASSES.has(doc.class) ? amount.abs().negate() : amount;
}

function isExcludedFromTurnover(doc: OverviewDocument, line: OverviewLine): boolean {
  if (line.vatTreatment !== null && TURNOVER_EXCLUDED_TREATMENTS.has(line.vatTreatment)) {
    return true;
  }
  return doc.partnerCountry !== null && doc.partnerCountry !== 'CZ' && doc.partnerVatId !== null;
}

export function computeOverviewTotals(
  docs: readonly OverviewDocument[],
  vatStatus: VatStatus,
  asOf: LegalDate,
): OverviewTotals {
  const monthStart = `${asOf.slice(0, 7)}-01`;
  const ytdStart = `${asOf.slice(0, 4)}-01-01`;
  const inMonth = (date: string): boolean => date >= monthStart && date <= asOf;
  const inYtd = (date: string): boolean => date >= ytdStart && date <= asOf;

  let monthIncome = Money.zero(CZK);
  let monthExpenses = Money.zero(CZK);
  let ytdIncome = Money.zero(CZK);
  let ytdExpenses = Money.zero(CZK);
  let turnover = Money.zero(CZK);
  let countedCount = 0;
  let pendingCount = 0;
  let pendingGross = Money.zero(CZK);

  for (const doc of docs) {
    if (doc.deleted || !BOOKABLE_CLASSES.has(doc.class)) {
      continue;
    }
    const date = overviewDocDate(doc);
    const counted =
      COUNTED_STATUSES.has(doc.status) &&
      (doc.businessFlag === 'business' || doc.businessFlag === 'mixed') &&
      date !== null
        ? pricedLines(doc, vatStatus)
        : null;

    if (counted !== null && date !== null) {
      if (inYtd(date)) {
        countedCount += 1;
        for (const p of counted) {
          if (INCOME_EFFECTS.has(p.taxEffect)) {
            ytdIncome = ytdIncome.add(p.amount);
            if (inMonth(date)) monthIncome = monthIncome.add(p.amount);
          } else if (EXPENSE_EFFECTS.has(p.taxEffect)) {
            ytdExpenses = ytdExpenses.add(p.amount);
            if (inMonth(date)) monthExpenses = monthExpenses.add(p.amount);
          }
        }
        if (doc.direction === 'out') {
          for (const line of doc.lines) {
            if (line.lineType === 'text' || line.taxEffect !== 'taxable_income') continue;
            if (isExcludedFromTurnover(doc, line)) continue;
            const amount = turnoverAmountCzk(doc, line);
            if (amount !== null) turnover = turnover.add(amount);
          }
        }
      }
      continue;
    }

    // Pending: not counted, but still awaiting review or classification in this year.
    const pendingStatus = COUNTED_STATUSES.has(doc.status) || PENDING_STATUSES.has(doc.status);
    if (doc.businessFlag !== 'personal' && pendingStatus && (date === null || inYtd(date))) {
      pendingCount += 1;
      if (doc.totalGross !== null) {
        const gross = inCzk(doc.totalGross, doc.currency, doc.fxRate);
        if (gross !== null) pendingGross = pendingGross.add(gross);
      }
    }
  }

  return {
    month: { income: monthIncome, expenses: monthExpenses },
    ytd: { income: ytdIncome, expenses: ytdExpenses },
    turnoverYtd: turnover,
    countedCount,
    pending: { count: pendingCount, grossCzk: pendingGross },
  };
}
