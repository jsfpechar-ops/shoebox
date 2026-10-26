import type {
  FilingRow,
  PeriodDocumentRow,
  PeriodEntryRow,
  PeriodLedger,
  TenantTx,
} from '@shoebox/db';
import type { LegalDate } from '@shoebox/domain';
import type { TenantJobDefinition } from '@shoebox/pipeline';
import { describe, expect, it } from 'vitest';
import { evaluatePeriod, generateBundle, type Validate, type VatDeps } from '../src/vat/service';
import {
  AUG,
  doc,
  entry,
  ioLedger,
  ledgerOf,
  memory,
  must,
  nl,
  profile,
  SEP,
} from './helpers/vat-store';

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const NOW = Date.parse('2026-09-20T10:00:00Z');
const tx = {} as TenantTx;

const czPartner = (dic: string) => ({
  dic,
  vatId: null,
  country: 'CZ',
  vatIdValid: null,
  documentShowsDic: true,
});
const issued = (id: string, treatment: string, partner: PeriodDocumentRow['partner']) =>
  doc(
    id,
    treatment,
    {
      class: 'issued_invoice',
      taxDocStatus: 'full_tax_document',
      vatPointDate: '2026-09-10',
      issueDate: '2026-09-10',
      duzp: '2026-09-10',
    },
    partner,
  );
const payerLedger = () =>
  ledgerOf(
    [
      entry(SEP, 'inv-a', ['1'], '10000.00', '2100.00', {
        vatTreatment: 'iss_domestic_vat',
        khSection: 'A4',
        counterpartyVatId: 'CZ12345678',
        evidenceNumber: '2026-0001',
        vatPointDate: '2026-09-10',
      }),
      entry(SEP, 'inv-b', ['1'], '8264.46', '1735.54', {
        vatTreatment: 'iss_domestic_vat',
        khSection: 'A5',
        counterpartyVatId: 'CZ12345678',
        evidenceNumber: '2026-0002',
        vatPointDate: '2026-09-11',
      }),
      entry(SEP, 'inv-c', ['1'], '8264.47', '1735.54', {
        vatTreatment: 'iss_domestic_vat',
        khSection: 'A4',
        counterpartyVatId: 'CZ12345678',
        evidenceNumber: '2026-0003',
        vatPointDate: '2026-09-12',
      }),
      entry(SEP, 'booking-aug', ['5', '43'], '11549.94', '2425.49', {
        khSection: 'A2',
        counterpartyVatId: 'NL805734958B01',
        evidenceNumber: '1637922054',
      }),
      entry(SEP, 'manager', ['40'], '10711.44', '2249.40', {
        vatTreatment: 'rcv_domestic_vat',
        khSection: 'B2',
        counterpartyVatId: 'CZ87654321',
        evidenceNumber: '2026090001',
        vatPointDate: '2026-09-02',
      }),
      entry(SEP, 'ikea', ['40'], '990.08', '207.92', {
        vatTreatment: 'rcv_domestic_vat',
        khSection: 'B3',
        evidenceNumber: 'R-0757',
      }),
      entry(SEP, 'credit', ['40'], '-9917.36', '-2082.64', {
        vatTreatment: 'rcv_domestic_vat',
        khSection: 'B2',
        counterpartyVatId: 'CZ87654321',
        evidenceNumber: 'DOB-7',
        vatPointDate: '2026-09-15',
      }),
      entry(SEP, 's1', ['21'], '1000.10', '0.00', {
        vatTreatment: 'iss_eu_service',
        shvCode: 3,
        counterpartyVatId: 'DE123456789',
        vatPointDate: '2026-09-05',
      }),
      entry(SEP, 's2', ['21'], '2000.20', '0.00', {
        vatTreatment: 'iss_eu_service',
        shvCode: 3,
        counterpartyVatId: 'DE123456789',
        vatPointDate: '2026-09-20',
      }),
      entry(SEP, 'g1', ['20'], '500.00', '0.00', {
        vatTreatment: 'iss_eu_goods',
        shvCode: 0,
        counterpartyVatId: 'ATU12345678',
        vatPointDate: '2026-09-21',
      }),
    ],
    [
      issued('inv-a', 'iss_domestic_vat', czPartner('CZ12345678')),
      issued('inv-b', 'iss_domestic_vat', czPartner('CZ12345678')),
      issued('inv-c', 'iss_domestic_vat', czPartner('CZ12345678')),
      doc(
        'booking-aug',
        'rcv_eu_service_reverse_charge',
        { vatPointDate: '2026-09-03', issueDate: '2026-09-03', duzp: '2026-09-03' },
        nl,
      ),
      doc(
        'manager',
        'rcv_domestic_vat',
        { taxDocStatus: 'full_tax_document', vatPointDate: '2026-09-02', duzp: '2026-09-02' },
        czPartner('CZ87654321'),
      ),
      doc(
        'ikea',
        'rcv_domestic_vat',
        {
          class: 'received_receipt',
          taxDocStatus: 'simplified_tax_document',
          vatPointDate: '2026-09-03',
          duzp: '2026-09-03',
        },
        czPartner('CZ27082440'),
      ),
      doc(
        'credit',
        'rcv_domestic_vat',
        {
          class: 'received_credit_note',
          taxDocStatus: 'full_tax_document',
          vatPointDate: '2026-09-15',
          duzp: '2026-09-15',
        },
        czPartner('CZ87654321'),
      ),
      issued('s1', 'iss_eu_service', {
        dic: null,
        vatId: 'DE123456789',
        country: 'DE',
        vatIdValid: true,
        documentShowsDic: false,
      }),
      issued('s2', 'iss_eu_service', {
        dic: null,
        vatId: 'DE123456789',
        country: 'DE',
        vatIdValid: true,
        documentShowsDic: false,
      }),
      issued('g1', 'iss_eu_goods', {
        dic: null,
        vatId: 'ATU12345678',
        country: 'AT',
        vatIdValid: true,
        documentShowsDic: false,
      }),
    ],
    [profile({ vatStatus: 'platce' })],
  );

function setup(initial: PeriodLedger, validate?: Validate) {
  const mem = memory(initial);
  const puts: Array<{ path: string; xml: string }> = [];
  const enqueued: Array<{ name: string; payload: unknown }> = [];
  const warns: Array<Record<string, unknown>> = [];
  const deps: VatDeps = {
    store: mem.store,
    blobs: {
      put: async (path, body) => void puts.push({ path, xml: new TextDecoder().decode(body) }),
    },
    logger: {
      info: () => undefined,
      warn: (obj: unknown) => void warns.push(obj as Record<string, unknown>),
    },
    now: () => NOW,
    appVersion: '0.0.0',
    validate:
      validate ?? (async () => ({ valid: true, method: 'xsd', xsdAvailable: true, errors: [] })),
    enqueue: async <P extends { orgId: string }>(def: TenantJobDefinition<P>, payload: P) => {
      enqueued.push({ name: def.name, payload });
      return 'job';
    },
  };
  return { ...mem, puts, enqueued, warns, deps };
}

const request = (periodStart: LegalDate) => ({
  periodStart,
  kind: 'radne' as const,
  requestedBy: USER,
});
const totalsOf = (row: FilingRow | undefined) => must(row).totals as Record<string, unknown>;

describe('filing lifecycle (0344)', () => {
  it('August IO: generates one DPHDP3 with totals, blob, snapshots and obligations', async () => {
    const t = setup(ioLedger());
    const out = await generateBundle(tx, ORG, request(AUG), t.deps);
    expect(out.outcome).toBe('generated');
    expect(t.rows).toHaveLength(1);
    const row = must(t.rows[0]);
    expect(row).toMatchObject({ type: 'DPHDP3', state: 'generated', xsdValid: true });
    const totals = totalsOf(row);
    expect((totals.rows as Record<string, unknown>)['5']).toEqual({ base: 13700, tax: 2877 });
    expect(totals.row64).toBe(2877);
    const put = must(t.puts[0]);
    expect(put.path).toBe(`org/${ORG}/filings/${row.bundleId}/DPHDP3.xml`);
    expect(put.xml).toContain('p_sl23_e="13700"');
    const snapshot = must(t.stored.get(row.id));
    expect(snapshot.docs).toHaveLength(1);
    expect(snapshot.entries).toHaveLength(1);
    const ret = must(t.obligations.get('vat_return:2026-08-01'));
    expect(ret.dueDate).toBe('2026-09-25');
    expect(must(t.obligations.get('vat_payment:2026-08-01')).amountEstimate?.toFixed2()).toBe(
      '2877.00',
    );
  });

  it('is idempotent on the ledger hash and supersedes when the ledger changes (#11)', async () => {
    const t = setup(ioLedger());
    const first = await generateBundle(tx, ORG, request(AUG), t.deps);
    const again = await generateBundle(tx, ORG, request(AUG), t.deps);
    expect(first.outcome).toBe('generated');
    expect(again).toEqual({ outcome: 'exists', filingIds: ['filing-1'] });
    expect(t.rows).toHaveLength(1);
    t.setLedger(ioLedger('2'));
    const third = await generateBundle(tx, ORG, request(AUG), t.deps);
    expect(third.outcome).toBe('generated');
    expect(t.rows.map((r) => r.state)).toEqual(['superseded', 'generated']);
  });

  it('payer September: three filings share one bundle; KH has the Veta C turnover', async () => {
    const t = setup(payerLedger());
    const out = await generateBundle(tx, ORG, request(SEP), t.deps);
    expect(out.outcome).toBe('generated');
    expect(t.rows.map((r) => r.type)).toEqual(['DPHDP3', 'DPHKH1', 'DPHSHV']);
    expect(new Set(t.rows.map((r) => r.bundleId)).size).toBe(1);
    expect(new Set(t.rows.map((r) => r.generatedAt)).size).toBe(1);
    const kh = must(t.puts.find((p) => p.path.endsWith('/DPHKH1.xml')));
    expect(kh.xml).toContain('obrat23="26529.00"');
    expect(must(t.rows[2]).periodStart).toBe('2026-09-01');
  });

  it('invalid KH keeps the whole bundle in draft, writes no blob and warns', async () => {
    const validate: Validate = async (_xml, form) =>
      form === 'DPHKH1'
        ? {
            valid: false,
            method: 'xsd',
            xsdAvailable: true,
            errors: [{ line: null, element: null, message: 'bad' }],
          }
        : { valid: true, method: 'xsd', xsdAvailable: true, errors: [] };
    const t = setup(payerLedger(), validate);
    const out = await generateBundle(tx, ORG, request(SEP), t.deps);
    expect(out.outcome).toBe('draft_invalid_xsd');
    expect(t.rows).toHaveLength(3);
    expect(t.rows.every((r) => r.state === 'draft')).toBe(true);
    expect(must(t.rows.find((r) => r.type === 'DPHKH1')).xsdValid).toBe(false);
    expect(t.puts).toHaveLength(0);
    expect(t.warns.some((w) => w.event === 'tax_xml_invalid')).toBe(true);
  });

  it('structural-only validation leaves a draft with xsd_valid null', async () => {
    const t = setup(ioLedger(), async () => ({
      valid: true,
      method: 'structural',
      xsdAvailable: false,
      errors: [],
    }));
    const out = await generateBundle(tx, ORG, request(AUG), t.deps);
    expect(out.outcome).toBe('draft_unvalidated');
    expect(must(t.rows[0])).toMatchObject({ state: 'draft', xsdValid: null });
  });

  it('needs_accountant: not_simple, draft carries the failing check, workbook enqueued', async () => {
    const base = ioLedger();
    const ledger = ledgerOf(
      base.entries as PeriodEntryRow[],
      [...base.documents, doc('inv-x', 'iss_domestic_vat', { class: 'issued_invoice' })],
      [...base.profiles],
    );
    const t = setup(ledger);
    const out = await generateBundle(tx, ORG, request(AUG), t.deps);
    expect(out).toMatchObject({ outcome: 'not_simple', verdict: 'needs_accountant' });
    const check = must(t.rows[0]).simpleCheck as {
      checks: Array<{ code: string; outcome: string }>;
    };
    expect(check.checks.find((c) => c.code === 'S_IO_OUTPUT_VAT')?.outcome).toBe(
      'needs_accountant',
    );
    expect(t.enqueued.map((e) => e.name)).toContain('vat.workbook.generate');
    expect(t.puts).toHaveLength(0);
  });

  it('evaluatePeriod: simple verdict creates a draft, no new draft beside a generated filing', async () => {
    const t = setup(ioLedger());
    const first = await evaluatePeriod(tx, ORG, AUG, t.deps);
    expect(first).toMatchObject({ verdict: 'simple', family: 'IO' });
    if ('skipped' in first) throw new Error('unexpected skip');
    expect(first.draftFilingId).not.toBeNull();
    expect(first.obligations).toBeGreaterThanOrEqual(1);
    await generateBundle(tx, ORG, request(AUG), t.deps);
    const before = t.rows.length;
    const second = await evaluatePeriod(tx, ORG, AUG, t.deps);
    if ('skipped' in second) throw new Error('unexpected skip');
    expect(second.draftFilingId).toBeNull();
    expect(t.rows).toHaveLength(before);
  });

  it('missing fu_code: header_missing and nothing written', async () => {
    const t = setup(ioLedger('1', profile({ fuCode: null })));
    const out = await generateBundle(tx, ORG, request(AUG), t.deps);
    expect(out).toEqual({ outcome: 'header_missing', missing: ['fu_code'] });
    expect(t.rows).toHaveLength(0);
    expect(t.puts).toHaveLength(0);
  });
});
