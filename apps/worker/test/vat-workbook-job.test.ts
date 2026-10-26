import {
  type FilingInsert,
  type FilingRow,
  ledgerHashOf,
  type PeriodDocumentRow,
  type PeriodEntryRow,
  type PeriodLedger,
  type ProfileVersionRow,
  type TenantTx,
} from '@shoebox/db';
import { type LegalDate, parseLegalDate } from '@shoebox/domain';
import { XLSX_MIME } from '@shoebox/exports';
import type { TenantJobDefinition } from '@shoebox/pipeline';
import { describe, expect, it } from 'vitest';
import type { TenantHandler, TenantJobContext } from '../src/registry';
import type { VatDeps, VatStore } from '../src/vat/service';
import { createVatWorkbookGenerateHandler, generateWorkbook } from '../src/vat/workbook';

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const AUG = parseLegalDate('2026-08-01');
const NOW = Date.parse('2026-09-20T10:00:00Z');
const tx = {} as TenantTx;

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected a value');
  return value;
}

const OPEN = ['draft', 'generated', 'downloaded'];

// Ledger fixture: copied from filing-lifecycle.test.ts (profile, entry, doc helpers).
const profile = (over: Partial<ProfileVersionRow> = {}): ProfileVersionRow => ({
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

const entry = (
  period: LegalDate,
  documentId: string,
  rowsOf: string[],
  base: string,
  vat: string,
  o: Partial<PeriodEntryRow> = {},
): PeriodEntryRow => ({
  periodStart: period,
  periodEnd: '2026-08-31',
  vatPointDate: '2026-08-03',
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

const doc = (
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

const ledgerOf = (
  entries: PeriodEntryRow[],
  documents: PeriodDocumentRow[],
  profiles: ProfileVersionRow[],
): PeriodLedger => ({ entries, documents, profiles, ledgerHash: ledgerHashOf(entries) });

const nl = {
  dic: null,
  vatId: 'NL805734958B01',
  country: 'NL',
  vatIdValid: true,
  documentShowsDic: false,
};

// Two AUG entries (one CZK, one EUR with an FX rate) and an issued domestic invoice that makes
// S_IO_OUTPUT_VAT needs_accountant, as in the filing-lifecycle needs_accountant case.
const fixture = (): PeriodLedger => {
  const booking = entry(AUG, 'booking-aug', ['5'], '13699.77', '2876.95', {
    counterpartyVatId: 'NL805734958B01',
    evidenceNumber: '1234567890',
  });
  const fx = entry(AUG, 'fx-doc', ['5'], '24580.00', '5161.80', {
    currency: 'EUR',
    baseForeign: '1000.00',
    fxRate: '24.580000',
    fxRateDate: '2026-08-03',
    counterpartyVatId: 'NL805734958B01',
  });
  return ledgerOf(
    [booking, fx],
    [
      doc('booking-aug', 'rcv_eu_service_reverse_charge', {}, nl),
      doc('fx-doc', 'rcv_eu_service_reverse_charge', {}, nl),
      doc('inv-x', 'iss_domestic_vat', { class: 'issued_invoice' }),
    ],
    [profile()],
  );
};

// Minimal in-memory store: the workbook job only reads the ledger and writes one filing row.
function memory(initial: PeriodLedger | null) {
  const rows: FilingRow[] = [];
  const store: VatStore = {
    readPeriodLedger: async () => must(initial),
    insertFiling: async (_tx, f: FilingInsert) => {
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
        origin: 'generated',
        periodStart: f.periodStart,
        periodEnd: f.periodEnd,
        state: f.state,
        amendsFilingId: null,
        bundleId: null,
        formVersion: null,
        totals: f.totals,
        simpleCheck: f.simpleCheck,
        xmlPath: null,
        pdfPath: null,
        xlsxPath: null,
        xsdValid: null,
        xsdErrors: null,
        generatedAt: null,
        markedFiledAt: null,
        filedOn: null,
        submissionRef: null,
        discoveredOn: null,
        sourceDocumentId: null,
      });
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
    setFilingState: async (_tx, _org, id, state, extra) => {
      const i = rows.findIndex((r) => r.id === id);
      if (i < 0) return false;
      rows[i] = {
        ...must(rows[i]),
        state,
        xlsxPath: extra?.xlsxPath ?? must(rows[i]).xlsxPath,
      };
      return true;
    },
    listFilings: async () => {
      throw new Error('not used by the workbook job');
    },
    upsertVatObligations: async () => {
      throw new Error('not used by the workbook job');
    },
  };
  return { store, rows };
}

// The ZIP is written with the stored method, so entries can be read straight from the bytes.
function unzip(bytes: Uint8Array): Map<string, string> {
  const out = new Map<string, string>();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = new TextDecoder();
  let at = 0;
  while (at + 30 <= bytes.length && view.getUint32(at, true) === 0x04034b50) {
    const size = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const extraLength = view.getUint16(at + 28, true);
    const name = text.decode(bytes.subarray(at + 30, at + 30 + nameLength));
    const start = at + 30 + nameLength + extraLength;
    out.set(name, text.decode(bytes.subarray(start, start + size)));
    at = start + size;
  }
  return out;
}

function setup(initial: PeriodLedger | null) {
  const mem = memory(initial);
  const blobs: Array<{ path: string; body: Uint8Array; contentType: string }> = [];
  const warns: Array<Record<string, unknown>> = [];
  const deps: VatDeps = {
    store: mem.store,
    blobs: {
      put: async (path, body, contentType) => {
        blobs.push({ path, body, contentType: String(contentType) });
      },
    },
    logger: {
      info: () => undefined,
      warn: (obj: unknown) => void warns.push(obj as Record<string, unknown>),
    },
    now: () => NOW,
    appVersion: '0.0.0',
    enqueue: async <P extends { orgId: string }>(_def: TenantJobDefinition<P>, _payload: P) =>
      'job',
  };
  return { ...mem, blobs, warns, deps };
}

const workbookRows = (t: ReturnType<typeof setup>) =>
  t.rows.filter((r) => r.type === 'VAT_WORKBOOK');

describe('vat.workbook.generate (0350)', () => {
  it('writes an XLSX with every ledger entry, the failed check and the FX rate', async () => {
    const t = setup(fixture());
    const out = await generateWorkbook(tx, ORG, AUG, USER, t.deps);
    expect(out).toMatchObject({ outcome: 'generated', path: expect.stringContaining('.xlsx') });

    const [filing] = workbookRows(t);
    expect(filing).toMatchObject({ state: 'generated', xlsxPath: must(filing).xlsxPath });
    const blob = must(t.blobs[0]);
    expect(blob.path).toBe(`org/${ORG}/filings/${must(filing).id}/VAT_WORKBOOK.xlsx`);
    expect(blob.contentType).toBe(XLSX_MIME);
    expect(Array.from(blob.body.subarray(0, 2))).toEqual([0x50, 0x4b]);

    const sheets = unzip(blob.body);
    const summary = must(sheets.get('xl/worksheets/sheet1.xml'));
    const ledger = must(sheets.get('xl/worksheets/sheet2.xml'));
    const resolve = must(sheets.get('xl/worksheets/sheet3.xml'));
    const rates = must(sheets.get('xl/worksheets/sheet4.xml'));

    expect(summary).toContain('Unverified computation');
    // Header plus one row per ledger entry.
    expect(ledger.match(/<row /g)).toHaveLength(3);
    expect(ledger).toContain('booking-aug');
    expect(ledger).toContain('fx-doc');
    expect(ledger).toContain('24.580000');
    // The failing check appears in the resolve sheet.
    expect(resolve).toContain('S_IO_OUTPUT_VAT');
    expect(resolve).toContain('needs_accountant');
    // The distinct FX rate of the period: header plus one row.
    expect(rates.match(/<row /g)).toHaveLength(2);
    expect(rates).toContain('2026-08-03');
    expect(rates).toContain('24.580000');
  });

  it('supersedes the previous open workbook of the period on regeneration', async () => {
    const t = setup(fixture());
    await generateWorkbook(tx, ORG, AUG, USER, t.deps);
    await generateWorkbook(tx, ORG, AUG, USER, t.deps);
    const states = t.rows.filter((r) => r.type === 'VAT_WORKBOOK').map((r) => r.state);
    expect(states).toEqual(['superseded', 'generated']);
    expect(t.blobs).toHaveLength(2);
  });

  it('skips a period without a profile: no filing, no blob', async () => {
    const base = fixture();
    const t = setup(ledgerOf(base.entries as PeriodEntryRow[], [...base.documents], []));
    const out = await generateWorkbook(tx, ORG, AUG, USER, t.deps);
    expect(out).toEqual({ outcome: 'skipped', reason: 'no_profile' });
    expect(workbookRows(t)).toHaveLength(0);
    expect(t.blobs).toHaveLength(0);
  });

  it('the job handler runs the generation with the tenant transaction', async () => {
    const t = setup(fixture());
    const handler: TenantHandler<{ orgId: string; periodStart: string; requestedBy?: string }> =
      createVatWorkbookGenerateHandler(t.deps);
    await handler({ orgId: ORG, periodStart: '2026-08-01', requestedBy: USER }, {
      tx,
    } as unknown as TenantJobContext);
    expect(workbookRows(t).map((r) => r.state)).toEqual(['generated']);
    expect(t.blobs).toHaveLength(1);
  });
});
