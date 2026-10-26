import {
  type FilingInsert,
  type FilingRow,
  ledgerHashOf,
  type PeriodDocumentRow,
  type PeriodEntryRow,
  type PeriodLedger,
  type ProfileVersionRow,
} from '@shoebox/db';
import { type LegalDate, type ObligationDraft, parseLegalDate } from '@shoebox/domain';
import type { VatStore } from '../../src/vat/service';

export function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected a value');
  return value;
}

export const AUG = parseLegalDate('2026-08-01');
export const SEP = parseLegalDate('2026-09-01');

const OPEN = ['draft', 'generated', 'downloaded'];

export interface Stored {
  readonly filing: FilingInsert;
  readonly docs: ReadonlyArray<{ documentId: string; revision: number }>;
  readonly entries: readonly PeriodEntryRow[];
}

export function memory(initial: PeriodLedger) {
  let ledger = initial;
  const rows: FilingRow[] = [];
  const stored = new Map<string, Stored>();
  const obligations = new Map<string, ObligationDraft>();
  const store: VatStore = {
    readPeriodLedger: async () => ledger,
    insertFiling: async (_tx, f, docs, entries) => {
      const clash = rows.some(
        (r) =>
          r.type === f.type &&
          r.kind === f.kind &&
          r.periodStart === f.periodStart &&
          OPEN.includes(r.state) &&
          OPEN.includes(f.state),
      );
      if (clash) throw new Error('unique slot violated');
      const id = `filing-${rows.length + 1}`;
      rows.push({
        id,
        type: f.type,
        kind: f.kind,
        origin: f.origin ?? 'generated',
        periodStart: f.periodStart,
        periodEnd: f.periodEnd,
        state: f.state,
        amendsFilingId: f.amendsFilingId ?? null,
        bundleId: f.bundleId ?? null,
        formVersion: f.formVersion ?? null,
        totals: f.totals,
        simpleCheck: f.simpleCheck,
        xmlPath: f.xmlPath ?? null,
        pdfPath: null,
        xlsxPath: null,
        xsdValid: f.xsdValid ?? null,
        xsdErrors: f.xsdErrors ?? null,
        generatedAt: f.generatedAt?.toISOString() ?? null,
        markedFiledAt: null,
        filedOn: null,
        submissionRef: null,
        discoveredOn: f.discoveredOn ?? null,
        sourceDocumentId: null,
      });
      stored.set(id, { filing: f, docs, entries });
      return id;
    },
    supersedeOpenFilings: async (_tx, _org, type, periodStart, kind) => {
      const ids: string[] = [];
      for (const [i, r] of rows.entries()) {
        if (
          r.type === type &&
          r.periodStart === periodStart &&
          r.kind === kind &&
          OPEN.includes(r.state)
        ) {
          rows[i] = { ...r, state: 'superseded' };
          ids.push(r.id);
        }
      }
      return ids;
    },
    listFilings: async (_tx, _org, filter) =>
      rows.filter(
        (r) =>
          (filter.periodStart === undefined || r.periodStart === filter.periodStart) &&
          (filter.types === undefined || filter.types.includes(r.type)) &&
          (filter.states === undefined || filter.states.includes(r.state)),
      ),
    setFilingState: async (_tx, _org, id, state) => {
      const i = rows.findIndex((r) => r.id === id);
      if (i < 0) return false;
      rows[i] = { ...must(rows[i]), state };
      return true;
    },
    upsertVatObligations: async (_tx, _org, drafts) => {
      for (const d of drafts) obligations.set(`${d.kind}:${d.periodStart}`, d as ObligationDraft);
      return drafts.length;
    },
  };
  return {
    store,
    rows,
    stored,
    obligations,
    setLedger: (next: PeriodLedger) => {
      ledger = next;
    },
  };
}

export const profile = (over: Partial<ProfileVersionRow> = {}): ProfileVersionRow => ({
  validFrom: '2026-01-01',
  validTo: null,
  vatStatus: 'identifikovana_osoba',
  vatPeriod: 'monthly',
  entityType: 'osvc',
  dic: 'CZ7801011229',
  firstName: 'Jan',
  lastName: 'Novák',
  title: null,
  address: {
    street: 'Vinohradská',
    house_number: '1',
    orientation_number: null,
    city: 'Praha',
    zip: '130 00',
  },
  fuCode: '451',
  ufoCode: '2003',
  mainActivityNace: '5520',
  filingEmail: 'jan@example.com',
  filingPhone: null,
  foreignServiceDppdPolicy: 'issue_date',
  ...over,
});

export const entry = (
  period: LegalDate,
  documentId: string,
  rowsOf: string[],
  base: string,
  vat: string,
  o: Partial<PeriodEntryRow> = {},
): PeriodEntryRow => ({
  periodStart: period,
  periodEnd: period === AUG ? '2026-08-31' : '2026-09-30',
  vatPointDate: period === AUG ? '2026-08-03' : '2026-09-03',
  vatPointRule: 'issue_date',
  lineId: null,
  vatTreatment: 'rcv_eu_service_reverse_charge',
  vatRateType: 'standard',
  vatRatePct: '21.00',
  baseCzk: base,
  vatCzk: vat,
  deductionPct: '100',
  currency: 'CZK',
  baseForeign: null,
  fxRate: null,
  fxAmount: null,
  fxRateDate: null,
  dphdp3Rows: rowsOf,
  khSection: null,
  khDocumentTotalCzk: null,
  shvCode: null,
  counterpartyVatId: null,
  evidenceNumber: documentId,
  documentId,
  documentRevision: 1,
  buildVersion: '1',
  ...o,
});

export const doc = (
  id: string,
  treatment: string,
  o: Partial<PeriodDocumentRow> = {},
  partner: PeriodDocumentRow['partner'] = null,
): PeriodDocumentRow => ({
  id,
  revision: 1,
  class: 'received_invoice',
  status: 'finalized',
  taxDocStatus: 'foreign_document',
  businessFlag: 'business',
  vatPointDate: '2026-08-03',
  issueDate: '2026-08-03',
  duzp: '2026-08-03',
  documentNumber: id,
  partner,
  correctsDocumentId: null,
  correctsVatPointDate: null,
  hasBlockingValidation: false,
  lines: [
    {
      lineType: 'item',
      vatTreatment: treatment,
      vatRateType: 'standard',
      businessSharePct: '100',
      rcCommodityCode: null,
      categoryCode: 'exp_software_saas',
      linkedIssuedInvoiceId: null,
    },
  ],
  ...o,
});

export const ledgerOf = (
  entries: PeriodEntryRow[],
  documents: PeriodDocumentRow[],
  profiles: ProfileVersionRow[],
): PeriodLedger => ({ entries, documents, profiles, ledgerHash: ledgerHashOf(entries) });

export const nl = {
  dic: null,
  vatId: 'NL805734958B01',
  country: 'NL',
  vatIdValid: true,
  documentShowsDic: false,
};
export const ioLedger = (build = '1', prof = profile()) =>
  ledgerOf(
    [
      entry(AUG, 'booking-aug', ['5'], '13699.77', '2876.95', {
        counterpartyVatId: 'NL805734958B01',
        evidenceNumber: '1234567890',
        buildVersion: build,
      }),
    ],
    [doc('booking-aug', 'rcv_eu_service_reverse_charge', {}, nl)],
    [prof],
  );
