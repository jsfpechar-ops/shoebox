import type {
  FilingRow,
  PodkladyFilingInsert,
  PodkladyRows,
  ReserveRow,
  TenantTx,
} from '@shoebox/db';
import {
  CZK,
  createCzRules,
  EMPTY_ANSWERS,
  type IncomeTaxObligationDraft,
  Money,
  type ProfileSegment,
  parseLegalDate,
} from '@shoebox/domain';
import { PDF_MIME, XLSX_MIME } from '@shoebox/exports';
import type { PodkladyGeneratePayload } from '@shoebox/pipeline';
import { podkladyReserveRefreshJob } from '@shoebox/pipeline';
import { describe, expect, it } from 'vitest';
import {
  type GenerateResult,
  generatePodklady,
  type PodkladyDeps,
  type PodkladyStore,
} from '../src/podklady/generate';
import {
  createReserveNightlyHandler,
  createReserveRefreshHandler,
  refreshReserve,
} from '../src/podklady/reserve';

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const tx = {} as TenantTx;
const d = parseLegalDate;
const czk = (s: string) => Money.parse(s, CZK);
const rules = createCzRules();

const seg = (o: Partial<ProfileSegment> = {}): ProfileSegment => ({
  validFrom: d('2025-01-01'),
  validTo: null,
  entityType: 'osvc',
  taxRegime: 'danova_evidence',
  vatStatus: 'neplatce',
  pausalRate: null,
  pausalDanBand: null,
  hasAccountant: true,
  ...o,
});

let n = 0;
const entry = (
  categoryCode: string,
  taxEffect: PodkladyRows['entries'][number]['taxEffect'],
  amount: string,
  share = '100',
  business = amount,
): PodkladyRows['entries'][number] => {
  n += 1;
  return {
    entryDate: d('2026-04-10'),
    taxYear: 2026,
    basis: 'payment',
    documentId: n <= 4 ? 'doc-a' : 'doc-b',
    lineId: `l-${n}`,
    categoryCode,
    taxEffect,
    amountCzk: amount,
    businessSharePct: share,
    businessAmountCzk: business,
  };
};

// The S2 input of the podklady summary test, mapped to the rows 0363 reads.
function s2Rows(over: Partial<PodkladyRows> = {}): PodkladyRows {
  return {
    privateUseFxMissing: [],
    profiles: [seg()],
    entries: [
      entry('income_services', 'taxable_income', '1400000.00'),
      entry('exp_material', 'deductible_expense', '400000.00'),
      entry('exp_fuel', 'deductible_expense', '60000.00'),
      entry('exp_telecom', 'deductible_expense', '24000.00', '50', '12000.00'),
      entry('exp_small_assets', 'deductible_expense', '48000.00'),
      entry('exp_representation', 'non_deductible_expense', '4000.00'),
      entry('asset_long_term', 'asset', '650000.00'),
    ],
    assetLines: [],
    privateUse: { personalDocuments: [], partialShareLines: [], carRegimeAnswers: [] },
    vatFilings: [],
    transactions: [
      ...Array.from({ length: 12 }, (_, i) => ({
        categoryCode: 'ins_social_own',
        bookedOn: d(`2026-${String(i + 1).padStart(2, '0')}-08`),
        amount: czk('5005.00'),
      })),
      { categoryCode: 'tax_income_payment', bookedOn: d('2026-06-15'), amount: czk('15000.00') },
    ],
    readiness: {
      ledger: { staleEntries: 0, documentsFinalizedAfterBuild: 0 },
      pendingDocuments: 0,
      unpaidIssued: 0,
      unexplainedTransactions: { count: 0, sum: czk('0') },
      businessFlagUnknown: { count: 0, sum: czk('0') },
    },
    taxpayer: { legalName: 'Test Taxpayer', ico: '12345678' },
    ledgerHash: 'h1',
    documents: [
      { documentId: 'doc-a', revision: 1 },
      { documentId: 'doc-b', revision: 1 },
    ],
    ...over,
  };
}

function fakeStore(rows: { current: PodkladyRows }) {
  const filings: FilingRow[] = [];
  const superseded: string[][] = [];
  const reserves: Array<Omit<ReserveRow, 'computedAt'>> = [];
  const obligations: IncomeTaxObligationDraft[][] = [];
  const inserts: PodkladyFilingInsert[] = [];
  const pathCalls: Array<{ filingId: string; pdfPath: string | null; xlsxPath: string | null }> =
    [];
  const store: PodkladyStore = {
    readRows: async () => rows.current,
    latestFiling: async () =>
      filings.find((f) => ['generated', 'downloaded', 'marked_filed'].includes(f.state)) ?? null,
    listDrafts: async () => filings.filter((f) => f.state === 'draft'),
    insertFiling: async (_tx, _org, input, r) => {
      inserts.push(input);
      const ids = filings.filter((f) => f.state !== 'superseded').map((f) => f.id);
      superseded.push(ids);
      for (const [i, f] of filings.entries()) {
        if (ids.includes(f.id)) filings[i] = { ...f, state: 'superseded' };
      }
      const id = `filing-${filings.length + 1}`;
      filings.unshift({
        id,
        type: 'PODKLADY_DPFO',
        state: 'generated',
        totals: { ...input.totals, ledgerHash: r.ledgerHash, answersVersion: input.answersVersion },
        inputs: input.answers,
      } as unknown as FilingRow);
      return { filingId: id, supersededIds: ids };
    },
    setPaths: async (_tx, _org, filingId, paths) => {
      pathCalls.push({ filingId, ...paths });
    },
    readReserve: async () => null,
    upsertReserve: async (_org, row) => {
      reserves.push(row);
    },
    upsertObligations: async (_tx, _org, drafts) => {
      obligations.push([...drafts]);
      return drafts.length;
    },
    listActiveOrgIds: async () => [ORG, '33333333-3333-4333-8333-333333333333'],
  };
  return { store, filings, superseded, reserves, obligations, inserts, pathCalls };
}

function setup(rows: PodkladyRows = s2Rows(), now = '2027-02-10T09:00:00Z') {
  const holder = { current: rows };
  const fake = fakeStore(holder);
  const puts: Array<{ path: string; contentType: string }> = [];
  const enqueued: Array<{ name: string; payload: unknown }> = [];
  const logs: unknown[] = [];
  const deps: PodkladyDeps = {
    store: fake.store,
    blobs: {
      put: async (path, _body, contentType) => {
        puts.push({ path, contentType });
      },
    },
    rules,
    now: () => new Date(now),
    appOrigin: 'https://app.example.test',
    translate: (key) => key,
    logger: { info: (o: unknown) => void logs.push(o), warn: (o: unknown) => void logs.push(o) },
    enqueue: async (def, payload) => {
      enqueued.push({ name: def.name, payload });
      return 'job';
    },
  };
  return { holder, fake, puts, enqueued, logs, deps };
}

const payload = (over: Partial<PodkladyGeneratePayload> = {}): PodkladyGeneratePayload => ({
  orgId: ORG,
  year: 2026,
  answersVersion: 1,
  requestedBy: USER,
  ...over,
});

const must = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) throw new Error('expected a value');
  return value;
};

describe('podklady.generate', () => {
  it('first run: one generated filing, PDF and XLSX put under org/{org}/filings/{filingId}/podklady-2026.{pdf,xlsx}, paths set, totals carry ledgerHash and answersVersion', async () => {
    const s = setup();
    const result = await generatePodklady(tx, ORG, payload(), s.deps);
    expect(result).toEqual({
      filingId: 'filing-1',
      created: true,
      blocked: false,
      pdfFailed: false,
    });
    expect(s.puts).toEqual([
      { path: `org/${ORG}/filings/filing-1/podklady-2026.pdf`, contentType: PDF_MIME },
      { path: `org/${ORG}/filings/filing-1/podklady-2026.xlsx`, contentType: XLSX_MIME },
    ]);
    expect(s.fake.pathCalls).toEqual([
      {
        filingId: 'filing-1',
        pdfPath: `org/${ORG}/filings/filing-1/podklady-2026.pdf`,
        xlsxPath: `org/${ORG}/filings/filing-1/podklady-2026.xlsx`,
      },
    ]);
    expect(s.fake.filings).toHaveLength(1);
    expect(s.fake.filings[0]?.totals).toMatchObject({ ledgerHash: 'h1', answersVersion: 1 });
    expect(s.fake.inserts[0]?.generatedBy).toBe(USER);
  });

  it('same ledger hash and answers version → created=false, no new filing, no blob put', async () => {
    const s = setup();
    await generatePodklady(tx, ORG, payload(), s.deps);
    s.puts.length = 0;
    const again = await generatePodklady(tx, ORG, payload(), s.deps);
    expect(again).toEqual({
      filingId: 'filing-1',
      created: false,
      blocked: false,
      pdfFailed: false,
    });
    expect(s.puts).toEqual([]);
    expect(s.fake.filings).toHaveLength(1);
  });

  it('ledger hash h2 → a new filing; the old one is superseded', async () => {
    const s = setup();
    await generatePodklady(tx, ORG, payload(), s.deps);
    s.holder.current = s2Rows({ ledgerHash: 'h2' });
    const second = await generatePodklady(tx, ORG, payload(), s.deps);
    expect(second.created).toBe(true);
    expect(second.filingId).toBe('filing-2');
    expect(s.fake.superseded).toEqual([[], ['filing-1']]);
  });

  it('a draft with answers {comparisonRate: 80} is used: totals.headline.base is 880000.00 for the S2 rows; draft superseded', async () => {
    const s = setup();
    s.fake.filings.push({
      id: 'draft-1',
      type: 'PODKLADY_DPFO',
      state: 'draft',
      totals: { answersVersion: 3 },
      inputs: { ...EMPTY_ANSWERS, comparisonRate: 80 },
    } as unknown as FilingRow);
    const result = await generatePodklady(tx, ORG, payload({ answersVersion: 3 }), s.deps);
    expect(result.created).toBe(true);
    expect(s.fake.inserts[0]?.answers.comparisonRate).toBe(80);
    expect(s.fake.inserts[0]?.totals).toMatchObject({ headline: { base: '880000.00' } });
    expect(s.fake.superseded[0]).toEqual(['draft-1']);
  });

  it('blocked (ucetnictvi profile) → nothing written, blocked=true', async () => {
    const s = setup(s2Rows({ profiles: [seg({ taxRegime: 'ucetnictvi' })] }));
    const result = await generatePodklady(tx, ORG, payload(), s.deps);
    expect(result).toEqual({ filingId: null, created: false, blocked: true, pdfFailed: false });
    expect(s.puts).toEqual([]);
    expect(s.fake.filings).toHaveLength(0);
    expect(s.fake.inserts).toHaveLength(0);
  });

  it('PDF builder throws 3× → filing still generated with xlsxPath only, pdfFailed=true', async () => {
    const s = setup();
    let calls = 0;
    const deps: PodkladyDeps = {
      ...s.deps,
      pdf: async () => {
        calls += 1;
        throw new Error('boom');
      },
    };
    const result: GenerateResult = await generatePodklady(tx, ORG, payload(), deps);
    expect(calls).toBe(3);
    expect(result).toEqual({
      filingId: 'filing-1',
      created: true,
      blocked: false,
      pdfFailed: true,
    });
    expect(s.puts.map((p) => p.contentType)).toEqual([XLSX_MIME]);
    expect(s.fake.pathCalls[0]).toEqual({
      filingId: 'filing-1',
      pdfPath: null,
      xlsxPath: `org/${ORG}/filings/filing-1/podklady-2026.xlsx`,
    });
    expect(JSON.stringify(s.logs)).toContain('podklady.pdf_failed');
  });
});

describe('podklady.reserve.refresh', () => {
  it('DE org: upsertReserve called with kind estimate, taxYear 2027 (today), payload.display a string; dap obligation upserted for 2027: legal 2028-05-01, due 2028-05-02', async () => {
    const s = setup();
    const result = await refreshReserve(tx, ORG, 'nightly', s.deps);
    expect(result.kind).toBe('estimate');
    const reserve = must(s.fake.reserves[0]);
    expect(reserve).toMatchObject({ kind: 'estimate', taxYear: 2027, asOf: '2027-02-10' });
    expect(typeof (reserve.payload as { display: unknown }).display).toBe('string');
    const dap = must(s.fake.obligations[0]?.find((o) => o.kind === 'dap'));
    expect([dap.periodStart, dap.legalDueDate, dap.dueDate]).toEqual([
      '2027-01-01',
      '2028-05-01',
      '2028-05-02',
    ]);
  });

  it('PD org: kind pausalni_dan; 12 pausalni_dan_advance obligations for 2027', async () => {
    const s = setup(
      s2Rows({ profiles: [seg({ taxRegime: 'pausalni_dan', pausalRate: 60, pausalDanBand: 1 })] }),
    );
    const result = await refreshReserve(tx, ORG, 'ledger_rebuilt', s.deps);
    expect(result.kind).toBe('pausalni_dan');
    expect(s.fake.reserves[0]?.kind).toBe('pausalni_dan');
    const advances = (s.fake.obligations[0] ?? []).filter((o) => o.kind === 'pausalni_dan_advance');
    expect(advances).toHaveLength(12);
    expect(advances.every((o) => o.periodStart.startsWith('2027-'))).toBe(true);
  });

  it('the refresh handler runs refreshReserve for the payload reason', async () => {
    const s = setup();
    await createReserveRefreshHandler(s.deps)(
      { orgId: ORG, reason: 'profile_changed' },
      { tx, jobId: 'j', attempt: 1, signal: new AbortController().signal },
    );
    expect(s.fake.reserves).toHaveLength(1);
    expect(JSON.stringify(s.logs)).not.toContain('Test Taxpayer');
  });

  it('nightly fan-out enqueues one refresh per active org with reason nightly', async () => {
    const s = setup();
    await createReserveNightlyHandler(s.deps)(
      {},
      { jobId: 'j', attempt: 1, signal: new AbortController().signal },
    );
    expect(s.enqueued).toEqual([
      {
        name: podkladyReserveRefreshJob.name,
        payload: { orgId: ORG, reason: 'nightly', nonce: expect.any(Number) },
      },
      {
        name: podkladyReserveRefreshJob.name,
        payload: {
          orgId: '33333333-3333-4333-8333-333333333333',
          reason: 'nightly',
          nonce: expect.any(Number),
        },
      },
    ]);
  });
});
