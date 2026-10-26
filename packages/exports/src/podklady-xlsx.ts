import {
  type AnnualTotals,
  type CategoryTotal,
  findCategory,
  type Money,
  type PodkladySummary,
} from '@shoebox/domain';
import { type XlsxCell, type XlsxSheet as Sheet, createXlsxWorkbook } from './xlsx';

export const PODKLADY_SHEETS = [
  'Summary',
  'Income',
  'Expenses',
  'Categories',
  'Assets',
  'Small assets',
  'Private',
  'Tax and insurance payments',
  'Flat-rate tax',
  'Missing',
  'Checklist',
  'Unpaid at year end',
] as const;

export interface PodkladyXlsxOptions {
  readonly appOrigin: string;
  readonly label: (key: string) => string;
}

type Row = XlsxCell[];

const num = (m: Money): XlsxCell => ({ num: m.toFixed2() });
const pct = (s: string): XlsxCell => ({ num: s });
const yn = (b: boolean): string => (b ? 'yes' : 'no');
const catLabel = (code: string): string => findCategory(code)?.labelEn ?? code;

function docLink(o: PodkladyXlsxOptions, documentId: string): string {
  return `${o.appOrigin}/documents/${documentId}`;
}

function drillRows(cats: readonly CategoryTotal[], o: PodkladyXlsxOptions): Row[] {
  return cats.flatMap((c) =>
    c.entries.map(
      (e): Row => [
        String(e.entryDate),
        c.categoryCode,
        catLabel(c.categoryCode),
        e.documentId,
        docLink(o, e.documentId),
        num(e.amountCzk),
        pct(e.businessSharePct),
        num(e.businessAmountCzk),
        num(e.amountCzk.subtract(e.businessAmountCzk)),
      ],
    ),
  );
}

const DRILL_HEADER: Row = [
  'Date',
  'Category',
  'Label',
  'Document',
  'Link',
  'Amount CZK',
  'Share %',
  'Business CZK',
  'Private CZK',
];

function summaryRows(s: PodkladySummary, o: PodkladyXlsxOptions): Row[] {
  const { totals, headline, flatRate } = s;
  const rows: Row[] = [
    ['Taxpayer', s.taxpayer.legalName, s.taxpayer.ico ?? ''],
    ['Year', String(s.year)],
    ['Regime', s.regime],
    ['Generated', String(s.generatedOn)],
    ['Interim', yn(s.watermark)],
    [],
    ['Income', num(headline.income)],
    [headline.label === 'flat' ? 'Flat-rate expenses' : 'Expenses', num(headline.expenses)],
    ['Base before adjustments', num(headline.base)],
    ['Advances paid', num(s.advancesPaid)],
    ['Private part', num(totals.privatePart)],
    ['Non-deductible', num(totals.nonDeductibleTotal)],
  ];
  if (flatRate) {
    rows.push(
      ['Flat rate %', pct(String(flatRate.rate))],
      ['Flat-rate expenses', num(flatRate.flat)],
      ['Cap reached', yn(flatRate.capReached)],
      ['Base with flat rate', num(flatRate.baseFlat)],
      ['Base with actual expenses', num(flatRate.baseActual)],
      ['Better', flatRate.better],
      ['Difference', num(flatRate.difference)],
    );
  }
  rows.push(['Disclaimer', o.label(s.disclaimerKey)]);
  return rows;
}

function categoryRows(totals: AnnualTotals): Row[] {
  const buckets: readonly (readonly CategoryTotal[])[] = [
    totals.income,
    totals.nonTaxableIncome,
    totals.deductible,
    totals.nonDeductible,
    totals.privateItems,
    totals.assets,
    totals.passThrough,
    totals.taxAndInsurancePayments,
  ];
  const rows: Row[] = [
    ['Category', 'Label', 'Tax effect', 'Entries', 'Amount CZK', 'Business CZK', 'Private CZK'],
  ];
  for (const bucket of buckets) {
    for (const c of bucket) {
      rows.push([
        c.categoryCode,
        catLabel(c.categoryCode),
        c.taxEffect,
        String(c.entryCount),
        num(c.amount),
        num(c.businessAmount),
        num(c.privateAmount),
      ]);
    }
  }
  rows.push(
    [],
    ['Income total', '', '', '', num(totals.incomeTotal)],
    ['Deductible total', '', '', '', '', num(totals.deductibleTotal)],
  );
  return rows;
}

const ASSET_HEADER: Row = [
  'Date',
  'Supplier',
  'Description',
  'Document',
  'Price CZK',
  'Paid in year CZK',
  'Share %',
  'Car',
  'Link',
];

function assetRows(list: PodkladySummary['assets']['assets'], o: PodkladyXlsxOptions): Row[] {
  return list.map(
    (a): Row => [
      a.date ? String(a.date) : '',
      a.partnerName ?? '',
      a.description ?? '',
      a.documentNumber ?? '',
      num(a.price),
      num(a.paidInYear),
      pct(a.businessSharePct),
      yn(a.carFlag),
      docLink(o, a.documentId),
    ],
  );
}

function privateRows(s: PodkladySummary): Row[] {
  const p = s.privateUse;
  const rows: Row[] = [
    ['Personal documents', String(p.personalCount), num(p.personalSum)],
    [],
    ['Document', 'Line', 'Description', 'Total CZK', 'Share %', 'Business CZK', 'Private CZK'],
  ];
  for (const r of p.partialShares) {
    rows.push([
      r.documentId,
      r.lineId,
      r.description ?? '',
      num(r.totalCzk),
      pct(r.businessSharePct),
      num(r.businessPart),
      num(r.privatePart),
    ]);
  }
  rows.push([], ['Car regime', p.carRegime, p.carBusinessSharePct ?? '']);
  return rows;
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

function paymentRows(s: PodkladySummary): Row[] {
  const rows: Row[] = [['Category', 'Label', 'Total CZK', ...MONTHS]];
  for (const p of s.payments) {
    rows.push([p.categoryCode, catLabel(p.categoryCode), num(p.total), ...p.byMonth.map(num)]);
  }
  return rows;
}

function flatRateRows(s: PodkladySummary): Row[] | null {
  const pd = s.pausalniDan;
  if (!pd) return null;
  const lastSegment = s.segments[s.segments.length - 1];
  const rows: Row[] = [
    ['Band', lastSegment?.pausalDanBand != null ? String(lastSegment.pausalDanBand) : ''],
    ['Fits band', pd.fitBand != null ? String(pd.fitBand) : 'none'],
    ['Limit CZK', num(pd.limit)],
    ['Expected CZK', num(pd.expected)],
    ['Paid CZK', num(pd.paid)],
    ['Difference CZK', num(pd.delta)],
    ['Notice deadline', String(pd.noticeDue)],
    [],
    ['Month', 'Due', 'Expected CZK', 'Paid CZK'],
  ];
  for (const m of pd.months) {
    rows.push([String(m.month), String(m.due), num(m.expected), num(m.paid)]);
  }
  rows.push([]);
  for (const w of pd.warnings) {
    rows.push([w.code, JSON.stringify(w.params)]);
  }
  return rows;
}

function missingRows(s: PodkladySummary, o: PodkladyXlsxOptions): Row[] {
  const rows: Row[] = [['Code', 'Severity', 'Text', 'Document']];
  for (const c of s.readiness) {
    rows.push([c.code, c.severity, o.label(`podklady.readiness.${c.code}`), '']);
  }
  for (const w of s.assets.warnings) {
    rows.push([w.code, 'warning', o.label(w.code), w.documentId]);
  }
  if (s.vatNote.registrationWarning) {
    rows.push([
      'podklady.vat.registration_warning',
      'warning',
      o.label('podklady.vat.registration_warning'),
      '',
    ]);
  }
  return rows;
}

/** Sheets of the accountant's workbook (M06 §4.9), in PODKLADY_SHEETS order. */
export function podkladySheets(s: PodkladySummary, o: PodkladyXlsxOptions): Sheet[] {
  const sheets: Sheet[] = [
    { name: 'Summary', rows: summaryRows(s, o) },
    {
      name: 'Income',
      rows: [
        DRILL_HEADER,
        ...drillRows(s.totals.income, o).concat(drillRows(s.totals.nonTaxableIncome, o)),
      ],
    },
    {
      name: 'Expenses',
      rows: [
        DRILL_HEADER,
        ...drillRows(s.totals.deductible, o)
          .concat(drillRows(s.totals.nonDeductible, o))
          .concat(drillRows(s.totals.privateItems, o)),
      ],
    },
    { name: 'Categories', rows: categoryRows(s.totals) },
    {
      name: 'Assets',
      rows: [ASSET_HEADER, ...assetRows(s.assets.assets, o), [o.label('podklady.assets.note')]],
    },
    { name: 'Small assets', rows: [ASSET_HEADER, ...assetRows(s.assets.smallAssets, o)] },
    { name: 'Private', rows: privateRows(s) },
    { name: 'Tax and insurance payments', rows: paymentRows(s) },
  ];
  const flat = flatRateRows(s);
  if (flat) sheets.push({ name: 'Flat-rate tax', rows: flat });
  sheets.push(
    { name: 'Missing', rows: missingRows(s, o) },
    {
      name: 'Checklist',
      rows: s.checklistKeys.map((k): Row => [k, o.label(k)]),
    },
    { name: 'Unpaid at year end', rows: [DRILL_HEADER, ...drillRows(s.totals.provisional, o)] },
  );
  return sheets;
}

export function buildPodkladyXlsx(
  s: PodkladySummary,
  o: PodkladyXlsxOptions,
  at: Date,
): Uint8Array {
  return createXlsxWorkbook(podkladySheets(s, o), at);
}
