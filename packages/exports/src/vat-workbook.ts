// M05 §4.10 VAT workbook: the working file an accountant gets for a period. Pure: rows in, bytes out.
// Money and rates arrive as decimal strings (ADR-007) and are written as numeric cells unchanged.
// Labels are English until cs.json wakes (AGENTS rule 6). TODO(i18n-cs): Czech names from M05 §4.10.

import { createXlsxWorkbook, type XlsxCell } from './xlsx';

export interface WorkbookEntry {
  readonly documentId: string;
  readonly documentNumber: string | null;
  readonly partnerName: string | null;
  readonly partnerVatId: string | null;
  readonly partnerCountry: string | null;
  readonly issueDate: string | null;
  readonly duzp: string | null;
  readonly receivedDate: string | null;
  readonly vatPointDate: string;
  readonly vatTreatment: string;
  readonly vatRatePct: number;
  readonly currency: string;
  readonly baseForeign: string | null;
  readonly fxRate: string | null;
  readonly fxRateDate: string | null;
  readonly baseCzk: string;
  readonly vatCzk: string;
  readonly dphdp3Rows: readonly string[];
  readonly khSection: string | null;
  readonly shvCode: number | null;
}

export interface VatWorkbookInput {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly profile: {
    readonly legalName: string;
    readonly dic: string | null;
    readonly vatStatus: string;
  };
  readonly verdict: string;
  readonly checks: ReadonlyArray<{
    code: string;
    outcome: string;
    documentIds: readonly string[];
    params: Record<string, string | number>;
  }>;
  readonly rows: Readonly<Record<string, { base: string; tax: string }>>;
  readonly result: { row62: string; row63: string; row64: string; row65: string };
  readonly entries: readonly WorkbookEntry[];
  readonly documentNumbers: Readonly<Record<string, string | null>>;
}

export interface Sheet {
  readonly name: string;
  readonly rows: readonly (readonly XlsxCell[])[];
}

// TODO(i18n-cs): Czech sheet names and headers when cs.json wakes.
export const WORKBOOK_SHEETS = [
  'Summary',
  'VAT ledger',
  'Documents to resolve',
  'CNB rates',
] as const;

const LEDGER_HEADER = [
  'Document ID',
  'Document number',
  'Partner',
  'Partner VAT ID',
  'Partner country',
  'Issue date',
  'DUZP',
  'Received',
  'VAT point date',
  'VAT treatment',
  'VAT rate %',
  'Currency',
  'Base (foreign)',
  'FX rate',
  'FX rate date',
  'Base CZK',
  'VAT CZK',
  'DPHDP3 rows',
  'KH section',
  'SH code',
];

const num = (value: string | null): XlsxCell => (value === null ? null : { num: value });
const text = (value: string | null | undefined): XlsxCell =>
  value === null || value === undefined || value === '' ? null : value;

function summarySheet(input: VatWorkbookInput): Sheet {
  const rows: XlsxCell[][] = [
    ['Period', input.periodStart, input.periodEnd],
    ['Taxpayer', input.profile.legalName, input.profile.dic ?? ''],
    ['VAT status', input.profile.vatStatus],
    ['Verdict', input.verdict],
    [],
    ['Unverified computation'],
    ['Row', 'Base CZK', 'Tax CZK'],
    ...Object.entries(input.rows).map(([row, value]) => [row, num(value.base), num(value.tax)]),
    ['Row 62', num(input.result.row62)],
    ['Row 63', num(input.result.row63)],
    ['Row 64', num(input.result.row64)],
    ['Row 65', num(input.result.row65)],
  ];
  return { name: WORKBOOK_SHEETS[0], rows };
}

function ledgerRow(e: WorkbookEntry): XlsxCell[] {
  return [
    e.documentId,
    text(e.documentNumber),
    text(e.partnerName),
    text(e.partnerVatId),
    text(e.partnerCountry),
    text(e.issueDate),
    text(e.duzp),
    text(e.receivedDate),
    e.vatPointDate,
    e.vatTreatment,
    { num: String(e.vatRatePct) },
    e.currency,
    num(e.baseForeign),
    num(e.fxRate),
    text(e.fxRateDate),
    { num: e.baseCzk },
    { num: e.vatCzk },
    e.dphdp3Rows.join(','),
    text(e.khSection),
    e.shvCode === null ? null : { num: String(e.shvCode) },
  ];
}

function ledgerSheet(input: VatWorkbookInput): Sheet {
  return {
    name: WORKBOOK_SHEETS[1],
    rows: [LEDGER_HEADER, ...input.entries.map(ledgerRow)],
  };
}

function resolveSheet(input: VatWorkbookInput): Sheet {
  const rows: XlsxCell[][] = [['Check', 'Outcome', 'Document', 'Document number', 'Params']];
  for (const check of input.checks) {
    if (check.outcome === 'pass') continue;
    const params = Object.entries(check.params)
      .map(([key, value]) => `${key}=${value}`)
      .join(', ');
    if (check.documentIds.length === 0) {
      rows.push([check.code, check.outcome, null, null, params]);
      continue;
    }
    for (const documentId of check.documentIds) {
      rows.push([
        check.code,
        check.outcome,
        documentId,
        text(input.documentNumbers[documentId] ?? null),
        params,
      ]);
    }
  }
  return { name: WORKBOOK_SHEETS[2], rows };
}

function ratesSheet(input: VatWorkbookInput): Sheet {
  const seen = new Map<string, { currency: string; date: string; rate: string }>();
  for (const e of input.entries) {
    if (e.fxRate === null || e.fxRateDate === null) continue;
    const key = `${e.currency}|${e.fxRateDate}|${e.fxRate}`;
    if (!seen.has(key)) seen.set(key, { currency: e.currency, date: e.fxRateDate, rate: e.fxRate });
  }
  const sorted = [...seen.values()].sort(
    (a, b) =>
      a.currency.localeCompare(b.currency) ||
      a.date.localeCompare(b.date) ||
      a.rate.localeCompare(b.rate),
  );
  return {
    name: WORKBOOK_SHEETS[3],
    rows: [
      ['Currency', 'Rate date', 'Rate'],
      ...sorted.map((r) => [r.currency, r.date, { num: r.rate }]),
    ],
  };
}

/** The four sheets of the VAT workbook, in order. */
export function vatWorkbookSheets(input: VatWorkbookInput): Sheet[] {
  return [summarySheet(input), ledgerSheet(input), resolveSheet(input), ratesSheet(input)];
}

export function buildVatWorkbook(input: VatWorkbookInput, at: Date): Uint8Array {
  return createXlsxWorkbook(vatWorkbookSheets(input), at);
}
