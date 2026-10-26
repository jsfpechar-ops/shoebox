import type { LedgerInputs, TaxEntryRow, TenantTx, VatEntryRow } from '@shoebox/db';
import { createCzRules } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import { canonicalJson, computeLedgerDrafts, inputHashOf } from '../src/ledger/build';
import {
  createLedgerRebuildOrgHandler,
  createLedgerVerifyHandler,
  type LedgerStore,
  rebuildDocument,
} from '../src/ledger/handler';

const ORG = '11111111-1111-4111-8111-111111111111';
const DOC = '22222222-2222-4222-8222-222222222222';
const LINE = '33333333-3333-4333-8333-333333333331';
const rules = createCzRules();
const tx = {} as TenantTx;
const silent = { info: () => undefined, warn: () => undefined };

function inputs(over: Partial<LedgerInputs> = {}): LedgerInputs {
  return {
    doc: {
      id: DOC,
      orgId: ORG,
      revision: 1,
      class: 'received_receipt',
      direction: 'in',
      status: 'ready',
      deleted: false,
      taxDocStatus: 'simplified_tax_document',
      businessFlag: 'business',
      currency: 'CZK',
      documentNumber: 'R-1',
      totalGross: '1198.00',
      issueDate: '2026-09-12',
      duzp: '2026-09-12',
      receivedDate: null,
      dueDate: null,
      servicePeriodFrom: null,
      servicePeriodTo: null,
      paidAt: '2026-09-12',
      vatPointDate: '2026-09-12',
      isPaidPerDocument: true,
      paymentMethod: 'card',
      fxRate: null,
      fxRateDate: null,
      partnerId: 'p1',
    },
    lines: [
      {
        id: LINE,
        position: 1,
        lineType: 'item',
        net: '990.08',
        vat: '207.92',
        gross: '1198.00',
        categoryCode: 'exp_small_assets',
        businessSharePct: '100',
        coveredByDocumentId: null,
        vatTreatment: 'rcv_domestic_vat',
        vatRateType: 'standard',
        vatRatePct: '21',
      },
    ],
    recap: [{ vatRateType: 'standard', vatRatePct: '21.00', base: '990.08', vat: '207.92' }],
    partner: { country: 'CZ', dic: 'CZ27082440', vatId: null },
    profiles: [
      {
        validFrom: '2026-01-01',
        validTo: null,
        vatStatus: 'identifikovana_osoba',
        vatPeriod: 'monthly',
        foreignServiceDppdPolicy: 'issue_date',
        mainActivityNace: null,
      },
    ],
    fxRates: [],
    current: null,
    ...over,
  };
}
function fakeStore(docs: Record<string, LedgerInputs>, listed: string[] = Object.keys(docs)) {
  const replaced: Array<{
    documentId: string;
    inputHash: string;
    tax: TaxEntryRow[];
    vat: VatEntryRow[];
  }> = [];
  let bv = 10;
  const stored: Record<
    string,
    { tax: TaxEntryRow[]; vat: VatEntryRow[]; buildVersion: string | null }
  > = {};
  const store: LedgerStore = {
    load: async (_tx, id) => docs[id] ?? null,
    replace: async (_tx, w) => {
      bv += 1;
      replaced.push({
        documentId: w.documentId,
        inputHash: w.inputHash,
        tax: [...w.tax],
        vat: [...w.vat],
      });
      stored[w.documentId] = { tax: [...w.tax], vat: [...w.vat], buildVersion: String(bv) };
      const d = docs[w.documentId];
      if (d)
        docs[w.documentId] = {
          ...d,
          current: { v: w.algoVersion, h: w.inputHash, buildVersion: String(bv) },
        };
      return String(bv);
    },
    read: async (_tx, id) => stored[id] ?? { tax: [], vat: [], buildVersion: null },
    list: async (_tx, _org, _from, offset, limit) => listed.slice(offset, offset + limit),
  };
  return { store, replaced, stored };
}

describe('build', () => {
  it('canonical JSON sorts keys and the hash ignores `current`', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { f: 1, e: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[2,{"e":2,"f":1}]},"b":1}',
    );
    const h = inputHashOf(inputs(), 1);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(inputHashOf(inputs({ current: { v: 1, h: 'x', buildVersion: '3' } }), 1)).toBe(h);
    expect(inputHashOf(inputs({ lines: [] }), 1)).not.toBe(h);
    expect(inputHashOf(inputs(), 2)).not.toBe(h);
  });
  it('IKEA-like card receipt for an identified person (AC-9j): one tax row on the issue date incl. VAT, no VAT rows', () => {
    const d = computeLedgerDrafts(inputs(), rules);
    expect(d.tax).toEqual([
      expect.objectContaining({
        entryDate: '2026-09-12',
        taxYear: 2026,
        basis: 'document_evidence',
        lineId: LINE,
        categoryCode: 'exp_small_assets',
        taxEffect: 'deductible_expense',
        amountCzk: '1198.00',
        businessSharePct: '100.00',
        businessAmountCzk: '1198.00',
      }),
    ]);
    expect(d.vat).toEqual([]);
    expect(d.taxYears).toEqual([2026]);
    expect(d.periods).toEqual([]);
  });
  it('a deleted or duplicate document, or one without issue date, yields no drafts', () => {
    expect(
      computeLedgerDrafts(inputs({ doc: { ...inputs().doc, deleted: true } }), rules),
    ).toMatchObject({ tax: [], vat: [] });
    expect(
      computeLedgerDrafts(inputs({ doc: { ...inputs().doc, status: 'duplicate' } }), rules),
    ).toMatchObject({ tax: [], vat: [] });
    expect(
      computeLedgerDrafts(inputs({ doc: { ...inputs().doc, issueDate: null, duzp: null } }), rules),
    ).toMatchObject({ tax: [], vat: [] });
  });
  it('Booking July for an identified person (AC-9c): VAT rows {5}, Σ base 13 699,77, Σ VAT 2 876,95, period 2026-08', () => {
    const booking = inputs({
      doc: {
        ...inputs().doc,
        class: 'received_invoice',
        taxDocStatus: 'foreign_document',
        documentNumber: '1574300000',
        totalGross: '13699.77',
        issueDate: '2026-08-03',
        duzp: null,
        servicePeriodFrom: '2026-07-01',
        servicePeriodTo: '2026-07-31',
        paidAt: null,
        vatPointDate: '2026-08-03',
        isPaidPerDocument: null,
        paymentMethod: 'bank_transfer',
        partnerId: 'p4',
      },
      lines: [
        {
          id: LINE,
          position: 1,
          lineType: 'item',
          net: '12990.12',
          vat: null,
          gross: '12990.12',
          categoryCode: 'exp_platform_commission',
          businessSharePct: '100',
          coveredByDocumentId: null,
          vatTreatment: 'rcv_eu_service_reverse_charge',
          vatRateType: 'standard',
          vatRatePct: '21',
        },
        {
          id: '33333333-3333-4333-8333-333333333332',
          position: 2,
          lineType: 'fee',
          net: '709.65',
          vat: null,
          gross: '709.65',
          categoryCode: 'exp_payment_fees',
          businessSharePct: '100',
          coveredByDocumentId: null,
          vatTreatment: 'rcv_eu_service_reverse_charge',
          vatRateType: 'standard',
          vatRatePct: '21',
        },
      ],
      recap: [],
      partner: { country: 'NL', dic: null, vatId: 'NL805734958B01' },
    });
    const d = computeLedgerDrafts(booking, rules);
    expect(
      d.vat.every(
        (v) => v.dphdp3Rows.includes('5') && v.khSection === null && v.periodStart === '2026-08-01',
      ),
    ).toBe(true);
    const sum = (k: 'baseCzk' | 'vatCzk') =>
      d.vat.reduce((a, v) => a + Math.round(Number(v[k]) * 100), 0);
    expect(sum('baseCzk')).toBe(1369977);
    expect(sum('vatCzk')).toBe(287695);
    expect(d.periods).toEqual(['2026-08-01']);
  });
});

describe('rebuildDocument', () => {
  it('writes on the first run, no-ops on the second with the same inputs, writes again when a line changes (AC-5)', async () => {
    const docs = { [DOC]: inputs() };
    const { store, replaced } = fakeStore(docs);
    const first = await rebuildDocument(tx, ORG, DOC, { store, rules, logger: silent });
    expect(first).toEqual({ changed: true, buildVersion: '11' });
    const second = await rebuildDocument(tx, ORG, DOC, { store, rules, logger: silent });
    expect(second).toEqual({ changed: false });
    expect(replaced).toHaveLength(1);
    docs[DOC] = { ...docs[DOC]!, lines: [{ ...docs[DOC]!.lines[0]!, businessSharePct: '50' }] };
    const third = await rebuildDocument(tx, ORG, DOC, { store, rules, logger: silent });
    expect(third.changed).toBe(true);
    expect(replaced[1]?.tax[0]?.businessAmountCzk).toBe('599.00');
    expect(replaced[1]?.inputHash).not.toBe(replaced[0]?.inputHash);
  });
  it('an unknown document is skipped; an algo bump forces a rewrite', async () => {
    const { store } = fakeStore({});
    expect(await rebuildDocument(tx, ORG, DOC, { store, rules, logger: silent })).toEqual({
      changed: false,
      skipped: 'missing',
    });
    const bumped = fakeStore({
      [DOC]: inputs({ current: { v: 0, h: inputHashOf(inputs(), 1), buildVersion: '1' } }),
    });
    expect(
      (await rebuildDocument(tx, ORG, DOC, { store: bumped.store, rules, logger: silent })).changed,
    ).toBe(true);
  });
});

describe('ledger.rebuild_org and ledger.verify', () => {
  it('fans out in batches of 200 with the mapped reason', async () => {
    const ids = Array.from(
      { length: 450 },
      (_, i) => `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`,
    );
    const { store } = fakeStore({}, ids);
    const enqueued: Array<{ name: string; payload: Record<string, unknown> }> = [];
    const handler = createLedgerRebuildOrgHandler({
      logger: silent,
      rules,
      store,
      enqueue: async (def, payload) => {
        enqueued.push({ name: def.name, payload: payload as Record<string, unknown> });
        return 'j';
      },
    });
    await handler(
      { orgId: ORG, reason: 'profile_changed' },
      { tx, attempt: 1, jobId: 'j', signal: new AbortController().signal },
    );
    expect(enqueued).toHaveLength(450);
    expect(
      enqueued.every(
        (e) => e.name === 'ledger.rebuild_document' && e.payload.reason === 'profile_changed',
      ),
    ).toBe(true);
    expect(new Set(enqueued.map((e) => e.payload.documentId)).size).toBe(450);
  });
  it('verify never writes and reports a diff when the stored rows differ from a dry run', async () => {
    const { store, replaced, stored } = fakeStore({ [DOC]: inputs() });
    stored[DOC] = { tax: [], vat: [], buildVersion: '5' };
    const warns: unknown[] = [];
    const handler = createLedgerVerifyHandler({
      logger: {
        info: () => undefined,
        warn: (obj: unknown) => {
          warns.push(obj);
        },
      } as never,
      rules,
      store,
      enqueue: async () => 'j',
      listOrgIds: async () => [ORG],
      withTenant: async (_org, fn) => fn(tx),
    });
    await handler(
      { samplePct: 100 },
      { attempt: 1, jobId: 'v', signal: new AbortController().signal },
    );
    expect(replaced).toEqual([]);
    expect(warns.some((w) => (w as { event?: string }).event === 'ledger.verify.diff')).toBe(true);
  });
});
