import { ledgerHashOf, type PeriodLedger, type TenantTx } from '@shoebox/db';
import { type LegalDate, parseLegalDate } from '@shoebox/domain';
import type { TenantJobDefinition } from '@shoebox/pipeline';
import { describe, expect, it } from 'vitest';
import { type AmendStore, detectAmendments } from '../src/vat/amendment-detect';
import type { VatDeps } from '../src/vat/service';
import { AUG, doc, entry, ioLedger, ledgerOf, memory, must, nl } from './helpers/vat-store';

const ORG = '11111111-1111-4111-8111-111111111111';
const tx = {} as TenantTx;

type Kind = 'radne' | 'opravne' | 'dodatecne';

async function setup(opts: { filedKind?: Kind; ledger: PeriodLedger; today: string }) {
  const mem = memory(ioLedger());
  const filedId = await mem.store.insertFiling(
    tx,
    {
      orgId: ORG,
      type: 'DPHDP3',
      kind: opts.filedKind ?? 'radne',
      periodStart: AUG,
      periodEnd: '2026-08-31',
      state: 'marked_filed',
      totals: {
        ledgerHash: ioLedger().ledgerHash,
        rows: { '5': { base: 13700, tax: 2877 } },
        row62: 2877,
        row63: 0,
        row64: 2877,
        row65: 0,
      },
      simpleCheck: {},
    },
    [{ documentId: 'booking-aug', revision: 1 }],
    [],
  );
  mem.setLedger(opts.ledger);
  const enqueued: string[] = [];
  const obligations: Array<Record<string, unknown>> = [];
  const events: string[] = [];
  const amendStore: AmendStore = {
    readFilingDocuments: async (_tx, _org, id) => [...(mem.stored.get(id)?.docs ?? [])],
    readFilingEntries: async () => [],
    updateFilingTotals: async (_tx, _org, id, totals, simpleCheck) => {
      const i = mem.rows.findIndex((r) => r.id === id);
      mem.rows[i] = { ...must(mem.rows[i]), totals, simpleCheck };
      return true;
    },
    upsertAmendmentObligation: async (_tx, _org, input) => void obligations.push({ ...input }),
  };
  const deps: VatDeps & { today: () => LegalDate; amendStore: AmendStore } = {
    store: mem.store,
    blobs: { put: async () => undefined },
    logger: {
      info: (o: unknown) => void events.push(String((o as { event?: string }).event)),
      warn: () => undefined,
    },
    now: () => Date.parse('2026-09-20T10:00:00Z'),
    enqueue: async <P extends { orgId: string }>(def: TenantJobDefinition<P>) => {
      enqueued.push(def.name);
      return 'job';
    },
    today: () => parseLegalDate(opts.today),
    amendStore,
  };
  return { mem, filedId, enqueued, obligations, events, deps };
}

const withCloudflare = (): PeriodLedger => {
  const base = ioLedger();
  const entries = [
    ...base.entries,
    entry(AUG, 'c', ['12'], '247.62', '52.00', {
      counterpartyVatId: 'NL805734958B01',
      evidenceNumber: 'CF-1',
    }),
  ];
  return ledgerOf(
    entries,
    [...base.documents, doc('c', 'rcv_eu_service_reverse_charge', {}, nl)],
    [...base.profiles],
  );
};

describe('detectAmendments', () => {
  it('unchanged ledger: no_change, nothing inserted', async () => {
    const s = await setup({ ledger: ioLedger(), today: '2026-09-22' });
    const res = await detectAmendments(tx, ORG, AUG, s.deps);
    expect(res).toEqual([{ outcome: 'no_change' }]);
    expect(s.mem.rows).toHaveLength(1);
    expect(s.obligations).toHaveLength(0);
  });

  it('before the deadline: opravne draft, obligation due 25 Sep, amount 52.00', async () => {
    const s = await setup({ ledger: withCloudflare(), today: '2026-09-22' });
    const res = await detectAmendments(tx, ORG, AUG, s.deps);
    const r = must(res[0]);
    expect(r.outcome).toBe('amendment_proposed');
    if (r.outcome !== 'amendment_proposed') return;
    expect(r.kind).toBe('opravne');
    expect(r.dueDate).toBe('2026-09-25');
    const draft = must(s.mem.rows.find((x) => x.id === r.draftFilingId));
    expect(draft.state).toBe('draft');
    expect(draft.amendsFilingId).toBe(s.filedId);
    expect(s.obligations).toEqual([
      expect.objectContaining({
        kind: 'vat_amendment',
        dueDate: '2026-09-25',
        amountEstimate: '52.00',
        filingId: r.draftFilingId,
        sourceRule: 'm05.amendment.v1',
      }),
    ]);
    expect(s.events).toContain('filing.amendment_needed');
  });

  it('after the deadline: dodatecne, discovered_on set, due 31 Dec, row66 52', async () => {
    const s = await setup({ ledger: withCloudflare(), today: '2026-11-10' });
    const r = must((await detectAmendments(tx, ORG, AUG, s.deps))[0]);
    expect(r.outcome).toBe('amendment_proposed');
    if (r.outcome !== 'amendment_proposed') return;
    expect(r.kind).toBe('dodatecne');
    expect(r.dueDate).toBe('2026-12-31');
    const draft = must(s.mem.rows.find((x) => x.id === r.draftFilingId));
    expect(draft.discoveredOn).toBe('2026-11-10');
    const totals = draft.totals as { proposal: { row66: number } };
    expect(totals.proposal.row66).toBe(52);
  });

  it('filed filing is dodatecne: needs_accountant, workbook enqueued', async () => {
    const s = await setup({
      filedKind: 'dodatecne',
      ledger: withCloudflare(),
      today: '2026-11-10',
    });
    const res = await detectAmendments(tx, ORG, AUG, s.deps);
    expect(res).toEqual([{ outcome: 'needs_accountant', reason: 'amend_of_dodatecne' }]);
    expect(s.enqueued).toContain('vat.workbook.generate');
    expect(s.mem.rows).toHaveLength(1);
  });

  it('verdict not simple: needs_accountant, workbook enqueued', async () => {
    const base = withCloudflare();
    const entries = [
      ...base.entries,
      entry(AUG, 'dom', ['1'], '1000.00', '210.00', { vatTreatment: 'iss_domestic_vat' }),
    ];
    const ledger = {
      ...base,
      entries,
      ledgerHash: ledgerHashOf(entries),
      documents: [
        ...base.documents,
        doc('dom', 'iss_domestic_vat', {
          class: 'issued_invoice',
          taxDocStatus: 'full_tax_document',
        }),
      ],
    };
    const s = await setup({ ledger, today: '2026-09-22' });
    const res = await detectAmendments(tx, ORG, AUG, s.deps);
    expect(must(res[0]).outcome).toBe('needs_accountant');
    expect(s.enqueued).toContain('vat.workbook.generate');
    expect(s.mem.rows).toHaveLength(1);
  });
});
