// VAT obligation drafts (M05 §4.12). Pure: the periods, filings and payments in, the drafts out.
// M09 `obligations.generate` upserts these; M05 never writes `obligations` itself.

import { addDays, compareLegalDates, type LegalDate } from '../dates/index';
import type { FilingKind, FilingState } from '../enums/index';
import { Money } from '../money/index';
import { type CzRules, vatDueDate } from './period';

export type VatObligationKind = 'vat_return' | 'kh' | 'sh' | 'vat_payment';

export interface VatPeriodSummary {
  readonly start: LegalDate;
  readonly end: LegalDate;
  readonly kind: 'month' | 'quarter';
  /** IO: an entry on rows 3–13; payer: always true once the period exists. */
  readonly hasReturnRows: boolean;
  readonly row64: Money | null;
  /** null until computed. */
  readonly row65: Money | null;
  readonly shMonths: readonly {
    readonly monthStart: LegalDate;
    readonly monthEnd: LegalDate;
    readonly plnHodnotaSum: Money;
  }[];
}

export interface VatFilingSummary {
  readonly type: 'DPHDP3' | 'DPHKH1' | 'DPHSHV';
  readonly kind: FilingKind;
  readonly periodStart: LegalDate;
  readonly state: FilingState;
}

/** Matched tax_vat_payment transactions. */
export interface VatPaymentSummary {
  readonly bookedOn: LegalDate;
  readonly amount: Money;
}

export interface VatObligationsInput {
  readonly status: 'platce' | 'identifikovana_osoba';
  readonly periods: readonly VatPeriodSummary[];
  readonly filings: readonly VatFilingSummary[];
  readonly payments: readonly VatPaymentSummary[];
  readonly today: LegalDate;
}

export interface ObligationDraft {
  readonly kind: VatObligationKind;
  readonly periodStart: LegalDate;
  readonly periodEnd: LegalDate;
  readonly legalDueDate: LegalDate;
  readonly dueDate: LegalDate;
  readonly amountEstimate: Money | null;
  readonly state: 'open' | 'done' | 'overdue';
  readonly doneSource: 'filing' | 'bank_payment' | null;
  readonly sourceRule: string;
}

export const VAT_OBLIGATION_SOURCE = 'm05.vat_obligations.v1';

/** Window after the due date in which a payment still counts for vat_payment (M05 §4.12). */
const PAYMENT_WINDOW_DAYS = 30;

const KIND_ORDER: Record<VatObligationKind, number> = {
  vat_return: 0,
  kh: 1,
  sh: 2,
  vat_payment: 3,
};

// TODO(0348): vat_amendment and kh_nasledne drafts come with brief 0348.

function vatReturnAmount(p: VatPeriodSummary): Money | null {
  if (p.row64?.isPositive()) return p.row64;
  if (p.row65?.isPositive()) return p.row65.negate();
  if (p.row64 !== null && p.row65 !== null) return Money.zero('CZK');
  return null;
}

export function vatObligationsFor(input: VatObligationsInput, rules: CzRules): ObligationDraft[] {
  const isPayer = input.status === 'platce';
  const out: ObligationDraft[] = [];

  const hasFiling = (
    type: VatFilingSummary['type'],
    periodStart: LegalDate,
    states: readonly FilingState[],
  ): boolean =>
    input.filings.some(
      (f) => f.type === type && f.periodStart === periodStart && states.includes(f.state),
    );

  const build = (
    kind: VatObligationKind,
    periodStart: LegalDate,
    periodEnd: LegalDate,
    legalDueDate: LegalDate,
    dueDate: LegalDate,
    amountEstimate: Money | null,
    doneSource: ObligationDraft['doneSource'],
  ): ObligationDraft => {
    let state: ObligationDraft['state'];
    if (doneSource !== null) state = 'done';
    else if (compareLegalDates(dueDate, input.today) < 0) state = 'overdue';
    else state = 'open';
    return {
      kind,
      periodStart,
      periodEnd,
      legalDueDate,
      dueDate,
      amountEstimate,
      state,
      doneSource,
      sourceRule: VAT_OBLIGATION_SOURCE,
    };
  };

  for (const p of input.periods) {
    const { legal, due } = vatDueDate(p.end, rules);

    if (isPayer || p.hasReturnRows) {
      const filed = hasFiling('DPHDP3', p.start, ['marked_filed']);
      out.push(
        build(
          'vat_return',
          p.start,
          p.end,
          legal,
          due,
          vatReturnAmount(p),
          filed ? 'filing' : null,
        ),
      );
    }

    if (isPayer) {
      const filed = hasFiling('DPHKH1', p.start, ['marked_filed']);
      out.push(build('kh', p.start, p.end, legal, due, null, filed ? 'filing' : null));
    }

    if (
      p.row64?.isPositive() &&
      hasFiling('DPHDP3', p.start, ['generated', 'downloaded', 'marked_filed'])
    ) {
      const windowEnd = addDays(due, PAYMENT_WINDOW_DAYS);
      const booked = input.payments.filter(
        (x) =>
          compareLegalDates(x.bookedOn, p.end) > 0 && compareLegalDates(x.bookedOn, windowEnd) <= 0,
      );
      const paid =
        Money.sum(
          booked.map((x) => x.amount),
          'CZK',
        ).compare(p.row64) >= 0;
      out.push(
        build('vat_payment', p.start, p.end, legal, due, p.row64, paid ? 'bank_payment' : null),
      );
    }

    for (const sh of p.shMonths) {
      const shDue = vatDueDate(sh.monthEnd, rules);
      const filed = hasFiling('DPHSHV', sh.monthStart, ['marked_filed']);
      out.push(
        build(
          'sh',
          sh.monthStart,
          sh.monthEnd,
          shDue.legal,
          shDue.due,
          sh.plnHodnotaSum,
          filed ? 'filing' : null,
        ),
      );
    }
  }

  return out.sort(
    (a, b) =>
      compareLegalDates(a.dueDate, b.dueDate) ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      compareLegalDates(a.periodStart, b.periodStart),
  );
}
