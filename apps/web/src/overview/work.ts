import { compareLegalDates, type LegalDate, Money } from '@shoebox/domain';

/** A document as the work and bills cards see it (money stays a decimal string, ADR-007). */
export interface WorkRow {
  readonly id: string;
  readonly status: string;
  readonly direction: 'in' | 'out' | null;
  readonly dueDate: LegalDate | null;
  readonly paidAt: string | null;
  readonly totalGross: string | null;
  readonly currency: string;
  readonly documentNumber: string | null;
  readonly partnerName: string | null;
  /** True when a current field was typed or fixed by the user (`source === 'user'`). */
  readonly hasUserField: boolean;
}

export interface WorkSummary {
  readonly waiting: number;
  readonly reading: number;
  readonly done: number;
  readonly autoReadPct: number | null;
}

export interface BillToPay {
  readonly id: string;
  readonly partnerName: string | null;
  readonly number: string | null;
  readonly due: LegalDate;
  readonly amount: string;
  readonly currency: string;
  readonly overdue: boolean;
  readonly daysLeft: number;
}

export interface BillsToPay {
  readonly items: readonly BillToPay[];
  readonly count: number;
  readonly totalCzk: string | null;
}

const READING = new Set([
  'received',
  'splitting',
  'classifying',
  'extracting',
  'validating',
  'categorizing',
]);
const DONE = new Set(['ready', 'finalized']);
const PAYABLE = new Set(['ready', 'needs_review']);
const MAX_BILLS = 5;

export const EMPTY_WORK: WorkSummary = { waiting: 0, reading: 0, done: 0, autoReadPct: null };
export const EMPTY_BILLS: BillsToPay = { items: [], count: 0, totalCzk: null };

/** Pure: how many documents wait for the user, are being read, or are done, and how many were read untouched. */
export function computeWorkSummary(rows: readonly WorkRow[], _asOf: LegalDate): WorkSummary {
  let waiting = 0;
  let reading = 0;
  let done = 0;
  let untouched = 0;
  for (const row of rows) {
    if (row.status === 'needs_review') waiting += 1;
    else if (READING.has(row.status)) reading += 1;
    else if (DONE.has(row.status)) {
      done += 1;
      if (!row.hasUserField) untouched += 1;
    }
  }
  const autoReadPct = done === 0 ? null : Math.floor((untouched * 100) / done);
  return { waiting, reading, done, autoReadPct };
}

function dayNumber(date: LegalDate): number {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
}

/** Pure: unpaid received bills with a due date, oldest due first, at most five, with the true count. */
export function computeBillsToPay(rows: readonly WorkRow[], asOf: LegalDate): BillsToPay {
  const bills: BillToPay[] = [];
  for (const row of rows) {
    if (
      row.direction !== 'in' ||
      row.paidAt !== null ||
      row.dueDate === null ||
      row.totalGross === null ||
      !PAYABLE.has(row.status)
    ) {
      continue;
    }
    const daysLeft = dayNumber(row.dueDate) - dayNumber(asOf);
    bills.push({
      id: row.id,
      partnerName: row.partnerName,
      number: row.documentNumber,
      due: row.dueDate,
      amount: row.totalGross,
      currency: row.currency,
      overdue: compareLegalDates(row.dueDate, asOf) < 0,
      daysLeft,
    });
  }
  bills.sort((a, b) => compareLegalDates(a.due, b.due));
  const czk = bills.filter((bill) => bill.currency === 'CZK');
  let totalCzk: string | null = null;
  if (czk.length > 0) {
    totalCzk = Money.sum(
      czk.map((bill) => Money.parse(bill.amount, 'CZK')),
      'CZK',
    ).toFixed2();
  }
  return { items: bills.slice(0, MAX_BILLS), count: bills.length, totalCzk };
}
