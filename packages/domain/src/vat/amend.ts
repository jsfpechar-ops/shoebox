// Filing diff and amendment kind (M05 §4.11, TA-10). Pure: snapshots and rules in, values out.
// Amendment windows come from `vat.amendment_windows`; the SHV rules and the row 66 sign are defaults.

import { type LegalDate, parseLegalDate } from '../dates/index';
import type { FilingKind } from '../enums/index';
import type { Money } from '../money/index';
import { isCzWorkingDay } from '../overview/deadlines';
import type { Dphdp3Computation } from './dphdp3';
import type { KhAmounts, KhComputation } from './kh';
import { type CzRules, monthAfter, periodEndOf, vatDueDate } from './period';
import type { ShvComputation } from './shv';

export type KhRowKey = string;
export type ShvKey = string;

export interface FilingSnapshot {
  readonly type: 'DPHDP3' | 'DPHKH1' | 'DPHSHV';
  readonly kind: FilingKind;
  readonly periodStart: LegalDate;
  readonly periodEnd: LegalDate;
  readonly rows: Readonly<Record<string, { readonly base?: number; readonly tax?: number }>>;
  readonly documents: Readonly<Record<string, number>>;
  readonly kh: Readonly<Record<KhRowKey, string>>;
  readonly shv: Readonly<Record<ShvKey, string>>;
}

export interface FilingDiff {
  readonly rows: Array<{
    row: string;
    attr: 'base' | 'tax';
    filed: number;
    now: number;
    delta: number;
  }>;
  readonly documents: {
    added: string[];
    removed: string[];
    changed: Array<{ documentId: string; fromRevision: number; toRevision: number }>;
  };
  readonly kh: { added: KhRowKey[]; removed: KhRowKey[]; changed: KhRowKey[] };
  readonly shv: { changed: ShvKey[] };
}

export type AmendmentProposal =
  | {
      readonly kind: FilingKind;
      readonly dueDate: LegalDate;
      readonly discoveredOn: LegalDate | null;
      readonly row66?: number;
    }
  | { readonly kind: 'needs_accountant'; readonly reason: 'amend_of_dodatecne' };

type SnapshotMeta = Pick<FilingSnapshot, 'kind' | 'periodStart' | 'periodEnd'>;
type RowValues = { base?: number; tax?: number };

/** Whole-CZK number from a Money that must already be whole. Read through the decimal string, no float math. */
function wholeCzk(m: Money): number {
  const d = m.toDecimal();
  if (!d.isInteger()) throw new Error(`amend: expected whole CZK, got ${m.toFixed2()}`);
  const n = Number.parseInt(d.toFixed(0), 10);
  return n === 0 ? 0 : n;
}

function khValue(a: KhAmounts): string {
  return [a.zaklDane1, a.dan1, a.zaklDane2, a.dan2].map((m) => m.toFixed2()).join('|');
}

function putUnique(target: Record<string, string>, key: string, value: string): void {
  if (Object.hasOwn(target, key)) throw new Error(`amend: duplicate snapshot key ${key}`);
  target[key] = value;
}

export function snapshotOfDphdp3(
  c: Dphdp3Computation,
  documents: Readonly<Record<string, number>>,
  meta: SnapshotMeta,
): FilingSnapshot {
  const rows: Record<string, RowValues> = {};
  for (const [row, v] of Object.entries(c.rows)) {
    rows[row] = { base: wholeCzk(v.base), tax: wholeCzk(v.tax) };
  }
  const carried: Array<[string, Money]> = [
    ['62', c.row62],
    ['63', c.row63],
    ['64', c.row64],
    ['65', c.row65],
  ];
  for (const [row, m] of carried) rows[row] = { tax: wholeCzk(m) };
  return {
    type: 'DPHDP3',
    kind: meta.kind,
    periodStart: meta.periodStart,
    periodEnd: meta.periodEnd,
    rows,
    documents: { ...documents },
    kh: {},
    shv: {},
  };
}

export function snapshotOfKh(
  kh: KhComputation,
  documents: Readonly<Record<string, number>>,
  meta: SnapshotMeta,
): FilingSnapshot {
  const values: Record<KhRowKey, string> = {};
  for (const r of kh.a2) putUnique(values, `A2:${r.vatidDod}:${r.cEvidDd}:${r.dppd}`, khValue(r));
  for (const r of kh.a4) putUnique(values, `A4:${r.dicOdb}:${r.cEvidDd}:${r.dppd}`, khValue(r));
  for (const r of kh.b2) putUnique(values, `B2:${r.dicDod}:${r.cEvidDd}:${r.dppd}`, khValue(r));
  if (kh.a5 !== null) putUnique(values, 'A5', khValue(kh.a5));
  if (kh.b3 !== null) putUnique(values, 'B3', khValue(kh.b3));
  return {
    type: 'DPHKH1',
    kind: meta.kind,
    periodStart: meta.periodStart,
    periodEnd: meta.periodEnd,
    rows: {},
    documents: { ...documents },
    kh: values,
    shv: {},
  };
}

export function snapshotOfShv(
  sh: ShvComputation,
  documents: Readonly<Record<string, number>>,
  meta: SnapshotMeta,
): FilingSnapshot {
  const values: Record<ShvKey, string> = {};
  for (const r of sh.rows) {
    putUnique(values, `${r.kStat}:${r.cVat}:${r.kPlnEu}`, r.plnHodnota.toFixed2());
  }
  return {
    type: 'DPHSHV',
    kind: meta.kind,
    periodStart: meta.periodStart,
    periodEnd: meta.periodEnd,
    rows: {},
    documents: { ...documents },
    kh: {},
    shv: values,
  };
}

function diffRows(filed: FilingSnapshot, next: FilingSnapshot): FilingDiff['rows'] {
  const out: FilingDiff['rows'] = [];
  const rowKeys = new Set([...Object.keys(filed.rows), ...Object.keys(next.rows)]);
  for (const row of rowKeys) {
    for (const attr of ['base', 'tax'] as const) {
      const f = filed.rows[row]?.[attr] ?? 0;
      const n = next.rows[row]?.[attr] ?? 0;
      if (f !== n) out.push({ row, attr, filed: f, now: n, delta: n - f });
    }
  }
  return out.sort(
    (a, b) =>
      Number.parseInt(a.row, 10) - Number.parseInt(b.row, 10) || a.attr.localeCompare(b.attr),
  );
}

function diffDocuments(filed: FilingSnapshot, next: FilingSnapshot): FilingDiff['documents'] {
  const ids = (s: FilingSnapshot): string[] => Object.keys(s.documents).sort();
  return {
    added: ids(next).filter((id) => !Object.hasOwn(filed.documents, id)),
    removed: ids(filed).filter((id) => !Object.hasOwn(next.documents, id)),
    changed: ids(next)
      .filter(
        (id) => Object.hasOwn(filed.documents, id) && filed.documents[id] !== next.documents[id],
      )
      .map((id) => ({
        documentId: id,
        fromRevision: filed.documents[id] ?? 0,
        toRevision: next.documents[id] ?? 0,
      })),
  };
}

function diffKeyed(
  filed: Readonly<Record<string, string>>,
  next: Readonly<Record<string, string>>,
): { added: string[]; removed: string[]; changed: string[] } {
  const keys = (o: Readonly<Record<string, string>>): string[] => Object.keys(o).sort();
  return {
    added: keys(next).filter((k) => !Object.hasOwn(filed, k)),
    removed: keys(filed).filter((k) => !Object.hasOwn(next, k)),
    changed: keys(next).filter((k) => Object.hasOwn(filed, k) && filed[k] !== next[k]),
  };
}

export function diffFilings(filed: FilingSnapshot, next: FilingSnapshot): FilingDiff {
  const kh = diffKeyed(filed.kh, next.kh);
  const shv = diffKeyed(filed.shv, next.shv);
  return {
    rows: diffRows(filed, next),
    documents: diffDocuments(filed, next),
    kh: { added: kh.added, removed: kh.removed, changed: kh.changed },
    shv: { changed: [...shv.added, ...shv.removed, ...shv.changed].sort() },
  };
}

export function isEmptyDiff(d: FilingDiff): boolean {
  return (
    d.rows.length === 0 &&
    d.documents.added.length === 0 &&
    d.documents.removed.length === 0 &&
    d.documents.changed.length === 0 &&
    d.kh.added.length === 0 &&
    d.kh.removed.length === 0 &&
    d.kh.changed.length === 0 &&
    d.shv.changed.length === 0
  );
}

/** The day after `date`, as a LegalDate (UTC arithmetic on the calendar date only). */
function nextDay(date: LegalDate): LegalDate {
  const y = Number.parseInt(date.slice(0, 4), 10);
  const m = Number.parseInt(date.slice(5, 7), 10);
  const d = Number.parseInt(date.slice(8, 10), 10);
  return parseLegalDate(new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10));
}

/** `n` CZ working days after `from` (holidays and weekends skipped). */
function addWorkingDays(from: LegalDate, n: number, rules: CzRules): LegalDate {
  let cursor = from;
  let left = n;
  while (left > 0) {
    cursor = nextDay(cursor);
    if (isCzWorkingDay(cursor, rules)) left -= 1;
  }
  return cursor;
}

/** Row 64 minus row 65 (tax), the amount the ř.66 difference is taken from. */
function netTax(s: FilingSnapshot): number {
  return (s.rows['64']?.tax ?? 0) - (s.rows['65']?.tax ?? 0);
}

export function chooseAmendmentKind(
  filed: FilingSnapshot,
  next: FilingSnapshot | null,
  today: LegalDate,
  rules: CzRules,
): AmendmentProposal {
  if (filed.kind === 'dodatecne') return { kind: 'needs_accountant', reason: 'amend_of_dodatecne' };

  const originalDue = vatDueDate(filed.periodEnd, rules).due;
  const onTime = today <= originalDue;
  const windows = rules.at(today).get('vat.amendment_windows');

  if (filed.type === 'DPHDP3') {
    if (onTime) return { kind: 'opravne', dueDate: originalDue, discoveredOn: null };
    // TODO(TA-10): ř.66 sign is [verify] against the EPO DPHDP3 instructions; formula taken from the brief.
    const row66 = next === null ? undefined : netTax(next) - netTax(filed);
    return {
      kind: 'dodatecne',
      // TODO(TA-10): end of the month after discovery (vat.amendment_windows.dp3_dodatecne_due).
      dueDate: periodEndOf(monthAfter(today), 'month'),
      discoveredOn: today,
      ...(row66 === undefined ? {} : { row66 }),
    };
  }

  if (filed.type === 'DPHKH1') {
    if (onTime) return { kind: 'opravne', dueDate: originalDue, discoveredOn: null };
    return {
      kind: 'nasledne',
      dueDate: addWorkingDays(today, windows.kh_nasledne_working_days, rules),
      discoveredOn: today,
    };
  }

  // DPHSHV. TODO(TA-10): regenerate as radne before the deadline, due = original deadline [verify].
  if (onTime) return { kind: 'radne', dueDate: originalDue, discoveredOn: null };
  // TODO(TA-10): SHV nasledne has no own window in rules; reuses the KH working-day window [verify].
  return {
    kind: 'nasledne',
    dueDate: addWorkingDays(today, windows.kh_nasledne_working_days, rules),
    discoveredOn: today,
  };
}
