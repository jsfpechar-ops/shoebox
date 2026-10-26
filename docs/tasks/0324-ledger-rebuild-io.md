# 0324: P1-LEDG-03a ledger rebuild DB I/O: inputs, locked delete+insert, build_version, stage_version hash

Status: done
Ticket: P1-LEDG-03 | Depends on: 0314 (merged), 0317 (profile/fx row types) | Base commit: lane branch head | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 25 tool calls, 60k tokens

## 1. Objective

The Drizzle side of M04 §4.13: load everything the two pure builders (0308 `buildTaxLedgerEntries`, 0311 `buildVatLedgerEntries`) read for one document, and replace that document's ledger rows atomically under `pg_advisory_xact_lock`, stamping a global monotonic `build_version` and `documents.stage_version.ledger = {v, h, build_version}`. The worker job (0325) decides *whether* to write (hash compare); this file only knows *how*.

## 2. Context

M04 §4.13 (verbatim): "In one DB transaction holding `pg_advisory_xact_lock(hashtext(org_id || ':ledger:' || document_id))`: compute drafts; compute `inputHash`; if equal to `documents.stage_version.ledger.h` → no-op; else `delete from tax_ledger_entries where document_id=$1` and same for VAT, insert drafts with `build_version = nextval('ledger_build_version_seq')` (monotonic, global), update `stage_version.ledger = {v, h, build_version}`." Determinism: "rebuilding twice yields identical rows except `id`/`build_version`" (AC-5).

Tables (migration 0041, Drizzle `packages/db/src/schema/ledgers.ts`: `taxLedgerEntries`, `vatLedgerEntries`, `ledgerBuildVersionSeq`): `tax_ledger_entries(entry_date, tax_year, basis, document_id, line_id, payment_link_id, transaction_id, category_code, tax_effect, amount_czk, business_share_pct, business_amount_czk, build_version)`; `vat_ledger_entries(period_start, period_end, vat_point_date, vat_point_rule, document_id, line_id, vat_treatment, vat_rate_type, vat_rate_pct, base_czk, vat_czk, deduction_pct, currency, base_foreign, fx_rate, fx_amount, fx_rate_date, dphdp3_rows, kh_section, kh_document_total_czk, shv_code, counterparty_vat_id, evidence_number, build_version)`. Users select only; the worker (`app_worker` inside `withTenant`) writes. Payment links / transactions do not exist yet (TODO(P0-DB-08)): `payments` is always `[]` for now.

Builder inputs (0308 / 0311 types, in `@shoebox/domain`): `TaxLedgerDocument {documentId, class, status, deleted, currency, issueDate, dueDate, paidAt, vatPointDate, isPaidPerDocument, paymentMethod, deductionAllowed, lines: TaxLedgerLine[]}` with `TaxLedgerLine {lineId, position, lineType, net, vat, gross, categoryCode, businessSharePct, coveredByDocumentId}`; `VatLedgerDocument extends VatPointDocument {documentId, status, deleted, businessFlag, currency, documentNumber, totalGross, lines: VatLedgerLine[], recap: VatLedgerRecapRow[]}` with `VatPointDocument {class, direction, taxDocStatus, issueDate, duzp, receivedDate, servicePeriodFrom, servicePeriodTo, paidAt, userVatPointDate}`, `VatLedgerLine {lineId, position, lineType, net, vat, gross, vatTreatment, vatRateType, categoryCode, businessSharePct}`, `VatLedgerPartner {country, dic, vatId, vatIdValid}`. This brief returns **raw string rows**; the worker maps them to `Money`/`LegalDate` (keeps `@shoebox/db` free of domain logic).

Pattern: `packages/db/src/document-reading.ts`; test pattern: `packages/db/test/document-reading.db.test.ts` (raw `postgres` for fixtures, `createTenantDb(...).withTenant(ORG, tx => …)` for the functions under test, org prefix of your own so the RLS suite's cleanup never touches it; `describe.skipIf(DATABASE_URL === undefined)`). Advisory lock in Drizzle: `await tx.execute(sql\`select pg_advisory_xact_lock(hashtext(${orgId} || ':ledger:' || ${documentId}))\`)`. Sequence: `select nextval('ledger_build_version_seq')` via `tx.execute`, read as `string` (bigint) and keep it as a string in TypeScript (never `Number()` on a bigint column; `build_version` fits `number` today but the type stays `string`).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/src/ledger-rebuild.ts` | create | the four functions below |
| `packages/db/src/index.ts` | edit | one export line after `document-categorize` |
| `packages/db/test/ledger-rebuild.db.test.ts` | create | the test below, verbatim |

## 4. Steps

1. Create `packages/db/src/ledger-rebuild.ts` exporting exactly:
```ts
import type { CategorizeFxRow, CategorizeProfileRow } from './document-categorize';
import type { TenantTx } from './tenant';
export interface LedgerDocumentRow { readonly id: string; readonly orgId: string; readonly revision: number; readonly class: string; readonly direction: string | null; readonly status: string; readonly deleted: boolean; readonly taxDocStatus: string; readonly businessFlag: string; readonly currency: string; readonly documentNumber: string | null; readonly totalGross: string | null; readonly issueDate: string | null; readonly duzp: string | null; readonly receivedDate: string | null; readonly dueDate: string | null; readonly servicePeriodFrom: string | null; readonly servicePeriodTo: string | null; readonly paidAt: string | null; readonly vatPointDate: string | null; readonly isPaidPerDocument: boolean | null; readonly paymentMethod: string | null; readonly fxRate: string | null; readonly fxRateDate: string | null; readonly partnerId: string | null; }
export interface LedgerLineRow { readonly id: string; readonly position: number; readonly lineType: string; readonly net: string | null; readonly vat: string | null; readonly gross: string | null; readonly categoryCode: string | null; readonly businessSharePct: string; readonly coveredByDocumentId: string | null; readonly vatTreatment: string | null; readonly vatRateType: string; readonly vatRatePct: string | null; }
export interface LedgerRecapRow { readonly vatRateType: string; readonly vatRatePct: string; readonly base: string; readonly vat: string; }
export interface LedgerPartnerRow { readonly country: string; readonly dic: string | null; readonly vatId: string | null; }
export interface LedgerInputs {
  readonly doc: LedgerDocumentRow; readonly lines: readonly LedgerLineRow[]; readonly recap: readonly LedgerRecapRow[];
  readonly partner: LedgerPartnerRow | null; readonly profiles: readonly CategorizeProfileRow[]; readonly fxRates: readonly CategorizeFxRow[];
  /** stage_version.ledger of the document, when present. */
  readonly current: { readonly v: number; readonly h: string; readonly buildVersion: string } | null;
}
/** Everything the builders read, including soft-deleted documents (their rebuild removes stale rows). Null when the id is unknown to this org. fx rows: the document currency, 120 days back from issue_date (none for CZK). */
export async function loadLedgerInputs(tx: TenantTx, documentId: string): Promise<LedgerInputs | null>;
export interface TaxEntryRow { readonly entryDate: string; readonly taxYear: number; readonly basis: string; readonly lineId: string | null; readonly paymentLinkId: string | null; readonly transactionId: string | null; readonly categoryCode: string; readonly taxEffect: string; readonly amountCzk: string; readonly businessSharePct: string; readonly businessAmountCzk: string; }
export interface VatEntryRow { readonly periodStart: string; readonly periodEnd: string; readonly vatPointDate: string; readonly vatPointRule: string; readonly lineId: string | null; readonly vatTreatment: string; readonly vatRateType: string; readonly vatRatePct: string; readonly baseCzk: string; readonly vatCzk: string; readonly deductionPct: string; readonly currency: string; readonly baseForeign: string | null; readonly fxRate: string | null; readonly fxAmount: number | null; readonly fxRateDate: string | null; readonly dphdp3Rows: readonly string[]; readonly khSection: string | null; readonly khDocumentTotalCzk: string | null; readonly shvCode: number | null; readonly counterpartyVatId: string | null; readonly evidenceNumber: string | null; }
export interface LedgerReplaceWrite { readonly orgId: string; readonly documentId: string; readonly algoVersion: number; readonly inputHash: string; readonly tax: readonly TaxEntryRow[]; readonly vat: readonly VatEntryRow[]; }
/** Takes the advisory lock, deletes the document's rows in both ledgers, inserts the new ones with one fresh build_version, writes stage_version.ledger = {v, h, build_version}. Returns the build_version (as a decimal string). */
export async function replaceLedgerEntries(tx: TenantTx, write: LedgerReplaceWrite): Promise<string>;
/** Current rows of one document, ordered deterministically (tax: entry_date, line_id, basis; vat: vat_point_date, vat_treatment, vat_rate_type), without id/build_version: for AC-5 and ledger.verify. */
export async function readLedgerEntries(tx: TenantTx, documentId: string): Promise<{ tax: TaxEntryRow[]; vat: VatEntryRow[]; buildVersion: string | null }>;
/** Document ids of the org for a full rebuild: not deleted, issue_date >= from (when given), ordered by issue_date nulls last then id, with offset/limit. */
export async function listDocumentsForRebuild(tx: TenantTx, orgId: string, from: string | null, offset: number, limit: number): Promise<string[]>;
```
   `stage_version` update: `set stage_version = stage_version || jsonb_build_object('ledger', jsonb_build_object('v', $v, 'h', $h, 'build_version', $bv::bigint))`. `current` parses `stage_version->'ledger'` defensively (missing or malformed → null).
   Command: `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30` → 0 errors.

2. Edit `packages/db/src/index.ts`: add `export * from './ledger-rebuild';` after the `document-categorize` export line.

3. Create `packages/db/test/ledger-rebuild.db.test.ts` verbatim; implement until it passes, do not edit it:
```ts
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type LedgerReplaceWrite, listDocumentsForRebuild, loadLedgerInputs, readLedgerEntries, replaceLedgerEntries } from '../src/ledger-rebuild';
import { runMigrations } from '../src/migrate';
import { closeDb, createTenantDb, type TenantDb } from '../src/tenant';

const DATABASE_URL = process.env.DATABASE_URL;
const ORG = 'cccccccc-0000-4000-8000-000000000051';
const ORG_S = 'cccccccc-0000-4000-8000-000000000052';
const PARTNER = 'cccccccc-0000-4000-8000-0000000000a1';
const DOC = 'cccccccc-0000-4000-8000-0000000000d1';
const DOC2 = 'cccccccc-0000-4000-8000-0000000000d2';
const LINE = 'cccccccc-0000-4000-8000-0000000000e1';

function workerUrlFrom(serviceUrl: string): string {
  const u = new URL(serviceUrl);
  u.username = 'app_worker';
  u.password = '';
  return u.toString();
}

function write(over: Partial<LedgerReplaceWrite> = {}): LedgerReplaceWrite {
  return {
    orgId: ORG, documentId: DOC, algoVersion: 1, inputHash: 'h1',
    tax: [{ entryDate: '2026-09-12', taxYear: 2026, basis: 'document_evidence', lineId: LINE, paymentLinkId: null, transactionId: null, categoryCode: 'exp_other_deductible', taxEffect: 'deductible_expense', amountCzk: '249.00', businessSharePct: '100.00', businessAmountCzk: '249.00' }],
    vat: [{ periodStart: '2026-09-01', periodEnd: '2026-09-30', vatPointDate: '2026-09-12', vatPointRule: 'duzp', lineId: null, vatTreatment: 'rcv_domestic_vat', vatRateType: 'standard', vatRatePct: '21.00', baseCzk: '205.79', vatCzk: '43.21', deductionPct: '100.00', currency: 'CZK', baseForeign: null, fxRate: null, fxAmount: null, fxRateDate: null, dphdp3Rows: ['40'], khSection: 'B3', khDocumentTotalCzk: '249.00', shvCode: null, counterpartyVatId: 'CZ26151006', evidenceNumber: 'R-1' }],
    ...over,
  };
}

describe.skipIf(DATABASE_URL === undefined)('ledger rebuild I/O', () => {
  const serviceUrl = DATABASE_URL ?? '';
  let sql: Sql;
  let db: TenantDb;

  beforeAll(async () => {
    sql = postgres(serviceUrl, { max: 1, onnotice: () => undefined });
    await runMigrations(serviceUrl);
    await sql`delete from organizations where id in (${ORG}, ${ORG_S})`;
    await sql`insert into organizations (id, name, ico, dic, inbound_email_slug, inbound_email_secret) values (${ORG}, 'Org L', '12345678', 'CZ12345678', 'org-l-0324', 'LLLLLLLL'), (${ORG_S}, 'Org M', null, null, 'org-m-0324', 'MMMMMMMM')`;
    await sql`insert into taxpayer_profiles (org_id, valid_from, vat_status, vat_period, legal_name, ico) values (${ORG}, '2026-01-01', 'identifikovana_osoba', 'monthly', 'Org L', '12345678')`;
    await sql`insert into partners (id, org_id, name, ico, dic, country) values (${PARTNER}, ${ORG}, 'Decathlon', '26151006', 'CZ26151006', 'CZ')`;
    await sql`insert into documents (id, org_id, entry_mode, status, class, direction, currency, issue_date, duzp, total_gross, partner_id, revision) values (${DOC}, ${ORG}, 'manual', 'ready', 'received_receipt', 'in', 'CZK', '2026-09-12', '2026-09-12', '249.00', ${PARTNER}, 1), (${DOC2}, ${ORG}, 'manual', 'ready', 'received_invoice', 'in', 'CZK', '2026-08-01', null, '10.00', null, 1)`;
    await sql`insert into document_lines (id, org_id, document_id, position, line_type, net, vat, gross, vat_rate_type, vat_rate_pct, category_code, business_share_pct, vat_treatment) values (${LINE}, ${ORG}, ${DOC}, 1, 'item', '205.79', '43.21', '249.00', 'standard', '21', 'exp_other_deductible', '100', 'rcv_domestic_vat')`;
    await sql`insert into document_vat_summary (org_id, document_id, vat_rate_type, vat_rate_pct, base, vat) values (${ORG}, ${DOC}, 'standard', '21', '205.79', '43.21')`;
    db = createTenantDb({ workerUrl: process.env.WORKER_DATABASE_URL ?? workerUrlFrom(serviceUrl), serviceUrl }, { max: 1 });
  }, 30_000);

  afterAll(async () => {
    if (sql) await sql`delete from organizations where id in (${ORG}, ${ORG_S})`;
    await sql?.end();
    await db?.close();
    await closeDb();
  });

  it('loads the inputs with lines, recap, partner, profiles and no current hash', async () => {
    const inputs = await db.withTenant(ORG, (tx) => loadLedgerInputs(tx, DOC));
    expect(inputs?.doc).toMatchObject({ id: DOC, orgId: ORG, class: 'received_receipt', status: 'ready', deleted: false, currency: 'CZK', issueDate: '2026-09-12', totalGross: '249.00', revision: 1 });
    expect(inputs?.lines).toEqual([expect.objectContaining({ id: LINE, position: 1, net: '205.79', vat: '43.21', gross: '249.00', categoryCode: 'exp_other_deductible', vatTreatment: 'rcv_domestic_vat', vatRateType: 'standard' })]);
    expect(inputs?.recap).toEqual([{ vatRateType: 'standard', vatRatePct: '21.00', base: '205.79', vat: '43.21' }]);
    expect(inputs?.partner).toEqual({ country: 'CZ', dic: 'CZ26151006', vatId: null });
    expect(inputs?.profiles).toEqual([expect.objectContaining({ validFrom: '2026-01-01', vatStatus: 'identifikovana_osoba', vatPeriod: 'monthly' })]);
    expect(inputs?.fxRates).toEqual([]);
    expect(inputs?.current).toBeNull();
    expect(await db.withTenant(ORG_S, (tx) => loadLedgerInputs(tx, DOC))).toBeNull();
  });

  it('replaces rows under one build_version and stamps stage_version.ledger; a second replace is identical except id/build_version (AC-5)', async () => {
    const bv1 = await db.withTenant(ORG, (tx) => replaceLedgerEntries(tx, write()));
    const first = await db.withTenant(ORG, (tx) => readLedgerEntries(tx, DOC));
    expect(first.buildVersion).toBe(bv1);
    expect(first.tax).toEqual(write().tax);
    expect(first.vat).toEqual(write().vat);
    const after = await db.withTenant(ORG, (tx) => loadLedgerInputs(tx, DOC));
    expect(after?.current).toEqual({ v: 1, h: 'h1', buildVersion: bv1 });

    const bv2 = await db.withTenant(ORG, (tx) => replaceLedgerEntries(tx, write({ inputHash: 'h2' })));
    expect(BigInt(bv2) > BigInt(bv1)).toBe(true);
    const second = await db.withTenant(ORG, (tx) => readLedgerEntries(tx, DOC));
    expect(second.tax).toEqual(first.tax);
    expect(second.vat).toEqual(first.vat);
    const count = await sql<{ n: string }[]>`select count(*)::text as n from tax_ledger_entries where document_id = ${DOC}`;
    expect(count[0]?.n).toBe('1');
    const vatCount = await sql<{ n: string }[]>`select count(*)::text as n from vat_ledger_entries where document_id = ${DOC}`;
    expect(vatCount[0]?.n).toBe('1');
  });

  it('an empty write removes every row and still stamps the hash', async () => {
    await db.withTenant(ORG, (tx) => replaceLedgerEntries(tx, write({ inputHash: 'h3', tax: [], vat: [] })));
    const rows = await db.withTenant(ORG, (tx) => readLedgerEntries(tx, DOC));
    expect(rows).toEqual({ tax: [], vat: [], buildVersion: null });
    const after = await db.withTenant(ORG, (tx) => loadLedgerInputs(tx, DOC));
    expect(after?.current?.h).toBe('h3');
  });

  it('lists documents for a full rebuild in issue_date order with from/offset/limit', async () => {
    expect(await db.withTenant(ORG, (tx) => listDocumentsForRebuild(tx, ORG, null, 0, 10))).toEqual([DOC2, DOC]);
    expect(await db.withTenant(ORG, (tx) => listDocumentsForRebuild(tx, ORG, '2026-09-01', 0, 10))).toEqual([DOC]);
    expect(await db.withTenant(ORG, (tx) => listDocumentsForRebuild(tx, ORG, null, 1, 10))).toEqual([DOC]);
    expect(await db.withTenant(ORG_S, (tx) => listDocumentsForRebuild(tx, ORG_S, null, 0, 10))).toEqual([]);
  });
});
```
   If the `taxpayer_profiles` insert needs more not-null columns, add them with neutral values in the fixture insert (that one line is the only test edit allowed; report it).
   Command: `pnpm --filter @shoebox/db test -- ledger-rebuild 2>&1 | tail -30` → all pass (with `DATABASE_URL` set; without it the suite is skipped — say so in the report and the orchestrator runs it in CI).

## 5. Do not touch

`migrations/*`, `schema/*`, `rls-catalog.ts`. Hard rules 1 (no amounts computed here: strings in, strings out), 3 (tenant tx only; `withTenant` sets `app.org_id`), 5.

## 6. Commands

`pnpm --filter @shoebox/db test -- ledger-rebuild 2>&1 | tail -30`; `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30`.

## 7. Acceptance

- [ ] Test passes against a database; typecheck clean. - [ ] `replaceLedgerEntries` takes the advisory lock as its first statement.

## 8. Stop and ask

Per TEMPLATE §8.

## 9. Report

`docs/tasks/0324-report.md`.

## Risk list

`ledger-rebuild.ts` entirely (money columns as strings, lock, stage_version merge).

## Owner steps

None.
