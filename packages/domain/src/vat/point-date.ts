import { addDays, compareLegalDates, type LegalDate, parseLegalDate } from '../dates/index';
import type {
  Direction,
  DocumentClass,
  TaxDocStatus,
  VatPeriod,
  VatStatus,
  VatTreatment,
} from '../enums/index';
import type { RULE_SCHEMAS } from '../rules/keys';
import type { RuleResolver } from '../rules/resolver';

export type VatPointRule =
  | 'duzp'
  | 'max_duzp_received'
  | 'issue_date'
  | 'service_period_end'
  | 'prepayment'
  | 'eu_goods_15th'
  | 'user_override';

export type ForeignServiceDppdPolicy = 'issue_date' | 'service_period_end';

export interface VatProfileSlice {
  readonly vatStatus: VatStatus;
  readonly vatPeriod: VatPeriod | null;
  readonly foreignServiceDppdPolicy: ForeignServiceDppdPolicy;
}

export interface VatPointDocument {
  readonly class: DocumentClass;
  readonly direction: Direction;
  readonly taxDocStatus: TaxDocStatus;
  readonly issueDate: LegalDate | null;
  readonly duzp: LegalDate | null;
  readonly receivedDate: LegalDate | null;
  readonly servicePeriodFrom: LegalDate | null;
  readonly servicePeriodTo: LegalDate | null;
  readonly paidAt: LegalDate | null;
  readonly userVatPointDate: LegalDate | null;
}

export interface PaymentEvidenceDate {
  readonly bookedOn: LegalDate;
}

export interface VatPointResult {
  readonly date: LegalDate;
  readonly rule: VatPointRule;
}

export interface VatPeriodRange {
  readonly start: LegalDate;
  readonly end: LegalDate;
  readonly kind: 'month' | 'quarter';
}

export type ProfileAt = (date: LegalDate) => VatProfileSlice;

export const SELF_ASSESSED_POINT_TREATMENTS: readonly VatTreatment[] = [
  'rcv_eu_service_reverse_charge',
  'rcv_non_eu_service_reverse_charge',
  'rcv_eu_goods_acquisition',
  'rcv_domestic_reverse_charge',
];

type Rules = RuleResolver<typeof RULE_SCHEMAS>;

type PrecedenceClass = 'self_assessed' | 'domestic' | 'issued';

/** Self-assessed beats domestic, domestic beats issued. */
const PRECEDENCE: readonly PrecedenceClass[] = ['self_assessed', 'domestic', 'issued'];

function parts(date: LegalDate): readonly [number, number, number] {
  const [y = '', m = '', dd = ''] = date.split('-');
  return [Number.parseInt(y, 10), Number.parseInt(m, 10), Number.parseInt(dd, 10)];
}

function dateFrom(year: number, month: number, day: number): LegalDate {
  return parseLegalDate(
    `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  );
}

/** First day of a month; `monthNumber` may run past 12 (13 is January of the next year). */
function firstOfMonth(year: number, monthNumber: number): LegalDate {
  const y = year + Math.floor((monthNumber - 1) / 12);
  const m = ((monthNumber - 1) % 12) + 1;
  return dateFrom(y, m, 1);
}

export function fifteenthOfNextMonth(date: LegalDate): LegalDate {
  const [year, month] = parts(date);
  const next = firstOfMonth(year, month + 1);
  const [ny, nm] = parts(next);
  return dateFrom(ny, nm, 15);
}

/** True when the inclusive day span from..to is at most `limit` days. */
function spanWithin(from: LegalDate, to: LegalDate, limit: number): boolean {
  if (compareLegalDates(from, to) > 0) return false;
  let cursor = from;
  let span = 1;
  while (compareLegalDates(cursor, to) < 0) {
    if (span >= limit) return false;
    cursor = addDays(cursor, 1);
    span += 1;
  }
  return span <= limit;
}

/** Later of the DUZP-or-issue anchor and the received date (receipt fallback: issue date, then anchor). */
function domesticBound(doc: VatPointDocument, anchor: LegalDate): LegalDate {
  const received = doc.receivedDate ?? doc.issueDate ?? anchor;
  return compareLegalDates(received, anchor) > 0 ? received : anchor;
}

function earliest(results: readonly VatPointResult[]): VatPointResult | null {
  let best: VatPointResult | null = null;
  for (const result of results) {
    if (best === null || compareLegalDates(result.date, best.date) < 0) best = result;
  }
  return best;
}

function isSelfAssessed(treatment: VatTreatment): boolean {
  return SELF_ASSESSED_POINT_TREATMENTS.includes(treatment);
}

/** M05 §4.1 kernel: the date a single treatment puts the document into a VAT period. */
export function computeVatPointDate(
  doc: VatPointDocument,
  treatment: VatTreatment,
  profile: VatProfileSlice,
): VatPointResult | null {
  const anchor = doc.duzp ?? doc.issueDate;

  if (treatment.startsWith('iss_')) {
    return anchor ? { date: anchor, rule: 'duzp' } : null;
  }

  if (treatment === 'rcv_domestic_vat') {
    if (!anchor) return null;
    if (doc.class === 'received_receipt' || doc.taxDocStatus === 'simplified_tax_document') {
      return { date: anchor, rule: 'duzp' };
    }
    return { date: domesticBound(doc, anchor), rule: 'max_duzp_received' };
  }

  if (
    treatment === 'rcv_eu_service_reverse_charge' ||
    treatment === 'rcv_non_eu_service_reverse_charge'
  ) {
    // TODO(decision-05): policy default is service_period_end; the P4 golden fixture pins issue_date.
    if (profile.foreignServiceDppdPolicy === 'service_period_end' && doc.servicePeriodTo) {
      return { date: doc.servicePeriodTo, rule: 'service_period_end' };
    }
    return doc.issueDate ? { date: doc.issueDate, rule: 'issue_date' } : null;
  }

  if (treatment === 'rcv_eu_goods_acquisition') {
    if (!anchor) return null;
    const fifteenth = fifteenthOfNextMonth(anchor);
    const issue = doc.issueDate;
    const date = issue && compareLegalDates(issue, fifteenth) < 0 ? issue : fifteenth;
    return { date, rule: 'eu_goods_15th' };
  }

  if (treatment === 'rcv_domestic_reverse_charge') {
    return anchor ? { date: anchor, rule: 'duzp' } : null;
  }

  return null;
}

/** M04 §4.8 wrapper: kernel plus the payer override, service-span guard, prepayment and class precedence. */
export function deriveVatPointDate(
  doc: VatPointDocument,
  treatments: readonly VatTreatment[],
  profileAt: ProfileAt,
  payments: readonly PaymentEvidenceDate[],
  rules: Rules,
): VatPointResult | null {
  const anchor = doc.duzp ?? doc.issueDate;
  if (!anchor) return null;
  const profile = profileAt(anchor);
  const rulesAt = rules.at(anchor);

  const one = (treatment: VatTreatment): VatPointResult | null => {
    if (treatment === 'rcv_domestic_vat' && doc.userVatPointDate) {
      const lower = domesticBound(doc, anchor);
      const deferralYears = rulesAt.get('vat.deduction_deferral_years');
      const upper = dateFrom(parts(anchor)[0] + deferralYears, 12, 31);
      const override = doc.userVatPointDate;
      if (compareLegalDates(override, lower) >= 0 && compareLegalDates(override, upper) <= 0) {
        return { date: override, rule: 'user_override' };
      }
    }

    if (
      treatment === 'rcv_eu_service_reverse_charge' ||
      treatment === 'rcv_non_eu_service_reverse_charge'
    ) {
      const from = doc.servicePeriodFrom;
      const to = doc.servicePeriodTo;
      const limit = rulesAt.get('classification.max_service_period_days_for_end');
      // TODO(decision-05): policy default is service_period_end; the P4 golden fixture pins issue_date.
      const usePeriod =
        profile.foreignServiceDppdPolicy === 'service_period_end' &&
        from !== null &&
        to !== null &&
        spanWithin(from, to, limit);
      if (!usePeriod || to === null) {
        return doc.issueDate ? { date: doc.issueDate, rule: 'issue_date' } : null;
      }
      const prepaid = [doc.paidAt, ...payments.map((payment) => payment.bookedOn)].filter(
        (day): day is LegalDate => day !== null && compareLegalDates(day, to) < 0,
      );
      const firstPrepaid = earliest(prepaid.map((date) => ({ date, rule: 'prepayment' })));
      return firstPrepaid ?? { date: to, rule: 'service_period_end' };
    }

    return computeVatPointDate(doc, treatment, profile);
  };

  const classOf = (treatment: VatTreatment): PrecedenceClass | null => {
    if (isSelfAssessed(treatment)) return 'self_assessed';
    if (treatment === 'rcv_domestic_vat') return 'domestic';
    if (treatment.startsWith('iss_')) return 'issued';
    return null;
  };

  for (const wanted of PRECEDENCE) {
    const results: VatPointResult[] = [];
    for (const treatment of treatments) {
      if (classOf(treatment) !== wanted) continue;
      const result = one(treatment);
      if (result) results.push(result);
    }
    const best = earliest(results);
    if (best) return best;
  }
  return null;
}

/** Period range for a date: month for IO and monthly payers, calendar quarter for quarterly payers. */
export function periodFor(date: LegalDate, profile: VatProfileSlice): VatPeriodRange | null {
  if (profile.vatStatus === 'neplatce') return null;
  const [year, month] = parts(date);

  if (profile.vatStatus === 'identifikovana_osoba' || profile.vatPeriod === 'monthly') {
    return {
      start: firstOfMonth(year, month),
      end: addDays(firstOfMonth(year, month + 1), -1),
      kind: 'month',
    };
  }
  if (profile.vatPeriod === 'quarterly') {
    const startMonth = Math.floor((month - 1) / 3) * 3 + 1;
    return {
      start: firstOfMonth(year, startMonth),
      end: addDays(firstOfMonth(year, startMonth + 3), -1),
      kind: 'quarter',
    };
  }
  return null;
}

export function resolveVatPeriod(profile: VatProfileSlice, date: LegalDate): VatPeriodRange | null {
  return periodFor(date, profile);
}
