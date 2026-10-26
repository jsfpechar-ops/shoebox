/**
 * Prototype deterministic checks (M03 subset, decisions 2026-10-18 [proto]): VAT lines against
 * the total, VAT per rate against base × rate with ADR-007 rounding, IČO modulo 11, DIČ format and
 * date plausibility. Pure: Money in, pass/warn/fail with an i18n key out. VAT rates come from
 * `packages/domain/rules` (`vat.rates`), never from this file.
 */
import {
  CZK,
  compareLegalDates,
  createCzRules,
  isCurrency,
  isLegalDate,
  type LegalDate,
  Money,
  roundingLineAllowed,
  vatForRate,
} from '@shoebox/domain';
import { createT, type Locale, type MessageKey, type Params } from '@shoebox/i18n';

export const PROTO_CHECK_IDS = [
  'vat_sum',
  'vat_rate_math',
  'ico_checksum',
  'dic_format',
  'date_issue',
  'date_duzp',
  'date_due',
  'vat_rate_missing',
  'vat_payer',
  'paid',
  'buyer',
  'totals_math',
  'recap_vs_totals',
  'qr_amount',
] as const;
export type ProtoCheckId = (typeof PROTO_CHECK_IDS)[number];

export type ProtoCheckSeverity = 'pass' | 'warn' | 'fail';

/** The fields the checks read; `ProtoExtraction` from @shoebox/extraction is assignable to it. */
export interface ProtoCheckInput {
  /** 04 class; `non_document` and `unreadable` get no v3 checks. */
  readonly document_class?: string;
  readonly supplier: {
    readonly ico: string | null;
    readonly dic: string | null;
    readonly country?: string | null;
  };
  readonly buyer?: { readonly ico: string | null; readonly dic: string | null };
  readonly dates: {
    readonly issue_date: string | null;
    readonly duzp: string | null;
    readonly due_date: string | null;
  };
  readonly currency: string | null;
  readonly totals: {
    readonly gross: string | null;
    readonly vat?: string | null;
    readonly net?: string | null;
  };
  readonly vat_recap: readonly {
    readonly rate_pct: string;
    readonly base: string;
    readonly vat: string;
  }[];
  /** Amount read from the payment QR code (0201), dot decimal. */
  readonly qr?: { readonly amount: string | null };
  readonly payment?: { readonly method: string | null };
  readonly flags?: {
    readonly non_vat_payer_text: boolean;
    readonly reverse_charge_text: boolean;
    readonly paid_text: boolean;
  };
  /** Parser issues; `vat_recap[N]` marks a recap row that was dropped (0-based). */
  readonly issues?: readonly string[];
}

/** The firm the prototype reads for (0041c: from the environment). */
export interface ProtoOrg {
  readonly ico: string | null;
  readonly dic: string | null;
}

export interface ProtoCheckResult {
  readonly id: ProtoCheckId;
  readonly severity: ProtoCheckSeverity;
  readonly key: MessageKey;
  readonly params: Params;
}

export interface ProtoCheckOptions {
  /** Prague calendar date of the run (`pragueToday(clock)` or the golden set's `today`). */
  readonly today: LegalDate;
  /** The user's firm; without it the buyer check is skipped. */
  readonly org?: ProtoOrg;
}

/** `true` for 8 digits whose last digit is the modulo-11 check digit (weights 8..2). */
export function icoChecksumValid(ico: string): boolean {
  if (!/^\d{8}$/.test(ico)) return false;
  let sum = 0;
  for (let i = 0; i < 7; i += 1) {
    sum += Number(ico[i]) * (8 - i);
  }
  const remainder = sum % 11;
  let check: number;
  if (remainder === 0) check = 1;
  else if (remainder === 1) check = 0;
  else check = 11 - remainder;
  return Number(ico[7]) === check;
}

export const DIC_CZ_RE = /^CZ\d{8,10}$/;
export const FOREIGN_VAT_ID_RE = /^[A-Z]{2}[A-Z0-9]{2,12}$/;

const DATE_FIELDS = [
  ['date_issue', 'issue_date'],
  ['date_duzp', 'duzp'],
  ['date_due', 'due_date'],
] as const;

const DATE_FIELD_LABEL: Readonly<Record<string, MessageKey>> = {
  date_issue: 'proto.field.issue_date',
  date_duzp: 'proto.field.duzp',
  date_due: 'proto.field.due_date',
};

function parseMoney(text: string, currency: string): Money | null {
  try {
    return Money.parse(text, currency);
  } catch {
    return null;
  }
}

function allowedRates(input: ProtoCheckInput, today: LegalDate): { rates: string[]; date: string } {
  const issue = input.dates.issue_date;
  const date = issue !== null && isLegalDate(issue) ? issue : today;
  try {
    const rates = createCzRules().at(date).get('vat.rates');
    return { rates: ['0', String(rates.reduced), String(rates.standard)], date };
  } catch {
    const rates = createCzRules().at(today).get('vat.rates');
    return { rates: ['0', String(rates.reduced), String(rates.standard)], date: today };
  }
}

function rateKey(rate: string): string {
  return Money.parse(rate, CZK).toFixed2();
}

function checkVat(input: ProtoCheckInput, currency: string, today: LegalDate): ProtoCheckResult[] {
  const results: ProtoCheckResult[] = [];
  if (input.vat_recap.length === 0) return results;
  const allowed = allowedRates(input, today);
  const allowedKeys = allowed.rates.map(rateKey);
  const tolerance = Money.parse('0.01', currency);
  let sum: Money | null = Money.zero(currency);
  for (const line of input.vat_recap) {
    const base = parseMoney(line.base, currency);
    const vat = parseMoney(line.vat, currency);
    const rateValid = /^\d+(\.\d+)?$/.test(line.rate_pct);
    if (base === null || vat === null || !rateValid) {
      results.push({
        id: 'vat_rate_math',
        severity: 'fail',
        key: 'proto.check.vat_rate_math.invalid',
        params: { rate: line.rate_pct },
      });
      sum = null;
      continue;
    }
    if (sum !== null) sum = sum.add(base).add(vat);
    if (!allowedKeys.includes(rateKey(line.rate_pct))) {
      results.push({
        id: 'vat_rate_math',
        severity: 'warn',
        key: 'proto.check.vat_rate_math.unknown_rate',
        params: { rate: line.rate_pct, date: allowed.date },
      });
      continue;
    }
    const expected = vatForRate(base, line.rate_pct);
    const diff = vat.subtract(expected);
    const params: Params = {
      rate: line.rate_pct,
      base: base.toFixed2(),
      vat: vat.toFixed2(),
      expected: expected.toFixed2(),
    };
    if (diff.isZero()) {
      results.push({
        id: 'vat_rate_math',
        severity: 'pass',
        key: 'proto.check.vat_rate_math.pass',
        params,
      });
    } else if (roundingLineAllowed(diff, tolerance)) {
      results.push({
        id: 'vat_rate_math',
        severity: 'warn',
        key: 'proto.check.vat_rate_math.warn',
        params,
      });
    } else {
      results.push({
        id: 'vat_rate_math',
        severity: 'fail',
        key: 'proto.check.vat_rate_math.fail',
        params,
      });
    }
  }
  const gross = input.totals.gross === null ? null : parseMoney(input.totals.gross, currency);
  if (sum !== null && gross !== null) {
    const diff = gross.subtract(sum);
    const params: Params = { total: gross.toFixed2(), sum: sum.toFixed2(), diff: diff.toFixed2() };
    if (diff.isZero()) {
      results.push({ id: 'vat_sum', severity: 'pass', key: 'proto.check.vat_sum.pass', params });
    } else if (roundingLineAllowed(diff, Money.parse('1.00', currency))) {
      results.push({ id: 'vat_sum', severity: 'warn', key: 'proto.check.vat_sum.warn', params });
    } else {
      results.push({ id: 'vat_sum', severity: 'fail', key: 'proto.check.vat_sum.fail', params });
    }
  }
  return results;
}

const RECAP_KEYS = {
  recap_net: {
    pass: 'proto.check.recap_net.pass',
    warn: 'proto.check.recap_net.warn',
    fail: 'proto.check.recap_net.fail',
  },
  recap_vat: {
    pass: 'proto.check.recap_vat.pass',
    warn: 'proto.check.recap_vat.warn',
    fail: 'proto.check.recap_vat.fail',
  },
} as const;

/** net + VAT must equal the gross total; a printed rounding line may move it by up to 1.00. */
function checkTotalsMath(input: ProtoCheckInput, currency: string): ProtoCheckResult[] {
  const netText = input.totals.net ?? null;
  const vatText = input.totals.vat ?? null;
  const net = netText === null ? null : parseMoney(netText, currency);
  const vat = vatText === null ? null : parseMoney(vatText, currency);
  const gross = input.totals.gross === null ? null : parseMoney(input.totals.gross, currency);
  if (net === null || vat === null || gross === null) return [];
  const diff = gross.subtract(net.add(vat));
  const params: Params = {
    net: net.toFixed2(),
    vat: vat.toFixed2(),
    gross: gross.toFixed2(),
    diff: diff.toFixed2(),
  };
  if (diff.isZero()) {
    return [{ id: 'totals_math', severity: 'pass', key: 'proto.check.totals_math.pass', params }];
  }
  const within = roundingLineAllowed(diff, Money.parse('1.00', currency));
  return [
    {
      id: 'totals_math',
      severity: within ? 'warn' : 'fail',
      key: within ? 'proto.check.totals_math.warn' : 'proto.check.totals_math.fail',
      params,
    },
  ];
}

/** The VAT recap bases must add up to the net total, and the recap VAT to the VAT total. */
function checkRecapVsTotals(input: ProtoCheckInput, currency: string): ProtoCheckResult[] {
  const results: ProtoCheckResult[] = [];
  if (input.vat_recap.length === 0) return results;
  let bases = Money.zero(currency);
  let vats = Money.zero(currency);
  for (const line of input.vat_recap) {
    const base = parseMoney(line.base, currency);
    const vat = parseMoney(line.vat, currency);
    if (base === null || vat === null) return results;
    bases = bases.add(base);
    vats = vats.add(vat);
  }
  const tolerance = Money.parse('0.01', currency);
  const netText = input.totals.net ?? null;
  const net = netText === null ? null : parseMoney(netText, currency);
  const vatText = input.totals.vat ?? null;
  const totalVat = vatText === null ? null : parseMoney(vatText, currency);
  const compare = (
    prefix: keyof typeof RECAP_KEYS,
    recap: Money,
    total: Money,
  ): ProtoCheckResult => {
    const diff = total.subtract(recap);
    const severity: ProtoCheckSeverity = diff.isZero()
      ? 'pass'
      : roundingLineAllowed(diff, tolerance)
        ? 'warn'
        : 'fail';
    return {
      id: 'recap_vs_totals',
      severity,
      key: RECAP_KEYS[prefix][severity],
      params: { recap: recap.toFixed2(), total: total.toFixed2(), diff: diff.toFixed2() },
    };
  };
  if (net !== null) results.push(compare('recap_net', bases, net));
  if (totalVat !== null) results.push(compare('recap_vat', vats, totalVat));
  return results;
}

/** The amount in the payment QR code must equal the gross total. */
function checkQrAmount(input: ProtoCheckInput, currency: string): ProtoCheckResult[] {
  const qrText = input.qr?.amount ?? null;
  const qr = qrText === null ? null : parseMoney(qrText, currency);
  const gross = input.totals.gross === null ? null : parseMoney(input.totals.gross, currency);
  if (qr === null || gross === null) return [];
  const params: Params = { qr: qr.toFixed2(), total: gross.toFixed2() };
  if (qr.subtract(gross).isZero()) {
    return [{ id: 'qr_amount', severity: 'pass', key: 'proto.check.qr_amount.pass', params }];
  }
  return [{ id: 'qr_amount', severity: 'fail', key: 'proto.check.qr_amount.fail', params }];
}

function checkIdentifiers(input: ProtoCheckInput): ProtoCheckResult[] {
  const results: ProtoCheckResult[] = [];
  const { ico, dic } = input.supplier;
  if (ico !== null) {
    const ok = icoChecksumValid(ico);
    results.push({
      id: 'ico_checksum',
      severity: ok ? 'pass' : 'fail',
      key: ok ? 'proto.check.ico_checksum.pass' : 'proto.check.ico_checksum.fail',
      params: { ico },
    });
  }
  if (dic !== null) {
    let severity: ProtoCheckSeverity = 'fail';
    let key: MessageKey = 'proto.check.dic_format.fail';
    if (DIC_CZ_RE.test(dic)) {
      severity = 'pass';
      key = 'proto.check.dic_format.pass';
    } else if (!dic.startsWith('CZ') && FOREIGN_VAT_ID_RE.test(dic)) {
      severity = 'warn';
      key = 'proto.check.dic_format.warn';
    }
    results.push({ id: 'dic_format', severity, key, params: { dic } });
  }
  return results;
}

function checkDates(input: ProtoCheckInput, today: LegalDate): ProtoCheckResult[] {
  const results: ProtoCheckResult[] = [];
  const issue = input.dates.issue_date;
  for (const [id, field] of DATE_FIELDS) {
    const value = input.dates[field];
    if (value === null) continue;
    if (!isLegalDate(value)) {
      results.push({
        id,
        severity: 'fail',
        key: 'proto.check.date.fail_invalid',
        params: { field: id },
      });
      continue;
    }
    if (id !== 'date_due' && compareLegalDates(value, today) > 0) {
      results.push({
        id,
        severity: 'fail',
        key: 'proto.check.date.fail_future',
        params: { field: id, date: value, today },
      });
      continue;
    }
    if (
      id === 'date_due' &&
      issue !== null &&
      isLegalDate(issue) &&
      compareLegalDates(value, issue) < 0
    ) {
      results.push({
        id,
        severity: 'fail',
        key: 'proto.check.date.fail_due',
        params: { field: id, due: value, issue },
      });
      continue;
    }
    results.push({
      id,
      severity: 'pass',
      key: 'proto.check.date.pass',
      params: { field: id, date: value },
    });
  }
  return results;
}

const SKIPPED_CLASSES = new Set(['non_document', 'unreadable']);
const BUYER_REQUIRED_CLASSES = new Set([
  'received_invoice',
  'received_credit_note',
  'received_proforma',
  'received_advance_tax_doc',
]);
const RECAP_ROW_RE = /^vat_recap\[(\d+)\]$/;

function skipped(input: ProtoCheckInput): boolean {
  return input.document_class !== undefined && SKIPPED_CLASSES.has(input.document_class);
}

/** VAT the document charges: the recap sum, else the printed VAT total; null if unreadable. */
function chargedVat(input: ProtoCheckInput, currency: string): Money | null {
  if (input.vat_recap.length > 0) {
    let sum = Money.zero(currency);
    for (const line of input.vat_recap) {
      const vat = parseMoney(line.vat, currency);
      if (vat === null) return null;
      sum = sum.add(vat);
    }
    return sum;
  }
  const total = input.totals.vat ?? null;
  return total === null ? null : parseMoney(total, currency);
}

function checkVatRateMissing(input: ProtoCheckInput, currency: string): ProtoCheckResult[] {
  if (skipped(input)) return [];
  const rows = new Set<number>();
  for (const issue of input.issues ?? []) {
    const match = RECAP_ROW_RE.exec(issue);
    if (match?.[1] !== undefined) rows.add(Number(match[1]) + 1);
  }
  if (rows.size > 0) {
    return [...rows]
      .sort((a, b) => a - b)
      .map((row) => ({
        id: 'vat_rate_missing' as const,
        severity: 'fail' as const,
        key: 'proto.check.vat_rate_missing.unreadable_row' as const,
        params: { row },
      }));
  }
  if (input.vat_recap.length > 0) return [];
  const total = input.totals.vat ?? null;
  const vat = total === null ? null : parseMoney(total, currency);
  if (vat === null || !vat.isPositive()) return [];
  return [
    {
      id: 'vat_rate_missing',
      severity: 'warn',
      key: 'proto.check.vat_rate_missing.no_recap',
      params: { vat: vat.toFixed2() },
    },
  ];
}

function checkVatPayer(input: ProtoCheckInput, currency: string): ProtoCheckResult[] {
  const flags = input.flags;
  if (flags === undefined || skipped(input) || flags.reverse_charge_text) return [];
  const country = input.supplier.country ?? null;
  if (country !== null && country !== 'CZ') return [];
  const vat = chargedVat(input, currency);
  if (vat === null || !vat.isPositive()) return [];
  const amount = vat.toFixed2();
  if (flags.non_vat_payer_text) {
    return [
      {
        id: 'vat_payer',
        severity: 'fail',
        key: 'proto.check.vat_payer.non_payer',
        params: { vat: amount },
      },
    ];
  }
  const dic = input.supplier.dic;
  if (dic === null) {
    return [
      {
        id: 'vat_payer',
        severity: 'warn',
        key: 'proto.check.vat_payer.no_dic',
        params: { vat: amount },
      },
    ];
  }
  return [
    {
      id: 'vat_payer',
      severity: 'pass',
      key: 'proto.check.vat_payer.pass',
      params: { vat: amount, dic },
    },
  ];
}

function checkPaid(input: ProtoCheckInput): ProtoCheckResult[] {
  if (skipped(input)) return [];
  const method = input.payment?.method ?? null;
  let key: MessageKey | null = null;
  if (method === 'card') key = 'proto.check.paid.card';
  else if (method === 'cash') key = 'proto.check.paid.cash';
  else if (input.flags?.paid_text === true) key = 'proto.check.paid.stamp';
  return key === null ? [] : [{ id: 'paid', severity: 'pass', key, params: {} }];
}

function buyerResult(severity: ProtoCheckSeverity, key: MessageKey, id?: string): ProtoCheckResult {
  return { id: 'buyer', severity, key, params: id === undefined ? {} : { id } };
}

function checkBuyer(input: ProtoCheckInput, org: ProtoOrg | undefined): ProtoCheckResult[] {
  if (org === undefined || skipped(input)) return [];
  const { supplier } = input;
  const supplierIsMe =
    (org.ico !== null && supplier.ico === org.ico) ||
    (org.dic !== null && supplier.dic === org.dic);
  if (supplierIsMe) {
    return [buyerResult('fail', 'proto.check.buyer.supplier_is_me', org.ico ?? org.dic ?? '')];
  }
  const buyer = input.buyer ?? { ico: null, dic: null };
  if (buyer.ico !== null && org.ico !== null) {
    return buyer.ico === org.ico
      ? [buyerResult('pass', 'proto.check.buyer.pass', buyer.ico)]
      : [buyerResult('fail', 'proto.check.buyer.other_firm', buyer.ico)];
  }
  if (buyer.dic !== null && org.dic !== null) {
    return buyer.dic === org.dic
      ? [buyerResult('pass', 'proto.check.buyer.pass', buyer.dic)]
      : [buyerResult('fail', 'proto.check.buyer.other_firm', buyer.dic)];
  }
  if (buyer.ico !== null || buyer.dic !== null) return [];
  if (input.document_class !== undefined && BUYER_REQUIRED_CLASSES.has(input.document_class)) {
    return [buyerResult('warn', 'proto.check.buyer.missing')];
  }
  return [];
}

function cleanId(value: string | undefined, upper: boolean): string | null {
  const compact = (value ?? '').replace(/\s/g, '');
  if (compact === '') return null;
  return upper ? compact.toUpperCase() : compact;
}

/** `SHOEBOX_PROTO_ORG_ICO` / `SHOEBOX_PROTO_ORG_DIC` → the firm, or undefined when both are empty. */
export function parseProtoOrg(
  ico: string | undefined,
  dic: string | undefined,
): ProtoOrg | undefined {
  const org = { ico: cleanId(ico, false), dic: cleanId(dic, true) };
  return org.ico === null && org.dic === null ? undefined : org;
}

/** Runs every applicable check; a field that is absent (null) produces no result for its check. */
export function runProtoChecks(
  input: ProtoCheckInput,
  options: ProtoCheckOptions,
): ProtoCheckResult[] {
  const currency = input.currency !== null && isCurrency(input.currency) ? input.currency : CZK;
  return [
    ...checkVat(input, currency, options.today),
    ...checkTotalsMath(input, currency),
    ...checkRecapVsTotals(input, currency),
    ...checkQrAmount(input, currency),
    ...checkIdentifiers(input),
    ...checkDates(input, options.today),
    ...checkVatRateMissing(input, currency),
    ...checkVatPayer(input, currency),
    ...checkPaid(input),
    ...checkBuyer(input, options.org),
  ];
}

export interface RenderedProtoCheck extends ProtoCheckResult {
  readonly message: string;
}

/** Adds the human message in `locale` (cs default); `field` params become translated labels. */
export function renderProtoChecks(
  results: readonly ProtoCheckResult[],
  locale: Locale = 'cs',
): RenderedProtoCheck[] {
  const t = createT(locale);
  return results.map((result) => {
    const label = DATE_FIELD_LABEL[result.id];
    const params =
      label === undefined || typeof result.params.field !== 'string'
        ? result.params
        : { ...result.params, field: t(label) };
    return { ...result, message: t(result.key, params) };
  });
}
