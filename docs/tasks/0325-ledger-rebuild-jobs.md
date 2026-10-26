# 0325: P1-LEDG-03b the ledger jobs: `ledger.rebuild_document`, `ledger.rebuild_org`, `ledger.verify`

Status: todo
Ticket: P1-LEDG-03 | Depends on: 0308, 0311 (builders), 0317 (job defs), 0324 (I/O), all merged | Base commit: lane branch head | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 25 tool calls, 60k tokens

## 1. Objective

Wire the two pure builders to the database: one job rebuilds one document's ledger rows (no-op when the canonical input hash is unchanged, AC-5), one fans out over an org in `issue_date` order, and a nightly dry-run rebuilds a sample and logs an alert on any diff (hidden inputs). After this brief, every categorized document has tax and VAT ledger rows, which 0326/0327 read for Přehled.

## 2. Context

- M04 §4.13 (see 0324 §2 for the verbatim text). `inputHash = sha256(canonical JSON of: document row (minus nothing), lines, recap, partner, profiles, fx rows, payments ([]), rule-set version, LEDGER_ALGO_VERSION)`. Canonical JSON = keys sorted recursively, no whitespace (`canonicalJson` of `packages/testkit/src/llm/cassette.ts` is the reference; copy its 5 lines, do not import testkit into the worker). Rule-set version: `createCzRules()` has no version string yet → use the constant `'cz-rules-2026-10'` in `hash.ts` with `TODO(rules-version)`.
- Job keys: `${orgId}:ledger.rebuild_document:${documentId}-${reason}[-nonce]:1` (0317). Full org rebuild: batches of 200 (`listDocumentsForRebuild`), enqueue `ledger.rebuild_document {reason}` per document with `nonce = batchIndex`; `reason` maps `profile_changed → 'profile_changed'`, `rules_changed → 'rules_changed'`, `manual → 'verify'`.
- Mapping raw rows (0324) → builder inputs (0308/0311): `Money.parse(text, currency)` for `net/vat/gross/totalGross` (document currency), recap `base/vat` likewise; `LegalDate` via `parseLegalDate`; `deductionAllowed = profileAt(vatPointDate ?? issueDate).vatStatus === 'platce'` (TODO(decision-deduction), same as 0319); `profileAt` as in 0319 (latest profile with `validFrom ≤ date`; default `{vatStatus: 'neplatce', vatPeriod: null, foreignServiceDppdPolicy: 'issue_date'}`); `fxRates` rows → `{rateDate, currency, amount, rate}`; `payments: []`; `partner` null → `{country: null, dic: null, vatId: null, vatIdValid: null}` for VAT; `businessFlag` cast; `userVatPointDate = doc.vatPointDate` only when the document has a current `user` field `document.vat_point_date` — not loaded by 0324, so `null` (TODO(cat-04-vat-point-override)).
- Drafts → rows: every 2-decimal column (`amount_czk, business_amount_czk, base_czk, vat_czk, base_foreign, kh_document_total_czk`) and every pct column (`business_share_pct, vat_rate_pct, deduction_pct`) is written as `money.toDecimal().toFixed(2)` / `new Decimal(pct).toFixed(2)` so that drafts compare equal to what `numeric(15,2)`/`numeric(5,2)` columns read back (`Money.toString()` prints `'1198'`, the DB returns `'1198.00'`; `ledger.verify` compares strings); `fx_rate` as `toFixed(6)`; `TaxLedgerEntryDraft.{paymentLinkId, transactionId}` pass through; `VatLedgerEntryDraft.lineId` is `null`; `dphdp3Rows` array as is; `khSection`, `shvCode` as is.
- `buildVatLedgerEntries` returns `{entries, issues}`: issues are logged as counts by code (`S_FX_MISSING` etc.), never content; they do not block the write (M03 will surface them; TODO(P1-VAL-08)).
- Idempotency: `inputs.current?.h === inputHash && inputs.current.v === LEDGER_ALGO_VERSION` → return `{changed: false}` without any write. Else `replaceLedgerEntries`. Log `event: 'ledger.document_rebuilt' {documentId, buildVersion, periodsAffected: distinct vat period starts, taxYearsAffected: distinct tax years}`.
- `ledger.verify` (system job, no tenant): iterate orgs — `withServiceRole('admin', …)` is not for this; instead `db.withTenant` per org id listed by a service query `select id from organizations` through `deps.listOrgIds()` (inject; default implementation uses `withServiceRole('export', tx => tx.select({id: organizations.id}).from(organizations))`). For each org: `listDocumentsForRebuild(tx, orgId, null, 0, 10_000)`, take every k-th id with `k = round(100 / samplePct)` (at least 1 document), compute drafts in dry-run, compare with `readLedgerEntries` (same ordering as 0324; compare JSON of rows) → on a diff log `warn {event: 'ledger.verify.diff', orgId, documentId}` and count. Never writes.
- Logger: `Pick<Logger, 'info' | 'warn'>`. Clock injected (`pragueToday` not needed; the builders take dates from the data).

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/worker/src/ledger/build.ts` | create | `canonicalJson`, `inputHashOf`, `toLedgerInputs`, `computeLedgerDrafts` (pure) |
| `apps/worker/src/ledger/handler.ts` | create | the three handlers + `LedgerStore` |
| `apps/worker/src/ledger/register.ts` + `apps/worker/src/main.ts` | create + edit | registration (`registerLedgerJobs(registry, logger)`; main: import + call after `registerDocCategorize`) |
| `apps/worker/test/ledger-rebuild.test.ts` | create | the test below, verbatim |

## 4. Steps

1. Create `apps/worker/src/ledger/build.ts` exporting exactly:
```ts
import type { LedgerInputs, TaxEntryRow, VatEntryRow } from '@shoebox/db';
import type { RULE_SCHEMAS, RuleResolver, TaxLedgerInput, VatLedgerInput } from '@shoebox/domain';
export const RULES_VERSION = 'cz-rules-2026-10';   // TODO(rules-version)
export function canonicalJson(value: unknown): string;
export function inputHashOf(inputs: LedgerInputs, algoVersion: number): string;   // sha256 hex of canonicalJson({doc, lines, recap, partner, profiles, fxRates, payments: [], rules: RULES_VERSION, algo: algoVersion}) — `current` excluded
export function toLedgerInputs(inputs: LedgerInputs, rules: RuleResolver<typeof RULE_SCHEMAS>): { tax: TaxLedgerInput; vat: VatLedgerInput } | null;   // null when issueDate is null or direction is null (nothing bookable yet)
export interface LedgerDrafts { readonly tax: TaxEntryRow[]; readonly vat: VatEntryRow[]; readonly issues: Record<string, number>; readonly periods: string[]; readonly taxYears: number[]; }
export function computeLedgerDrafts(inputs: LedgerInputs, rules: RuleResolver<typeof RULE_SCHEMAS>): LedgerDrafts;   // empty drafts when toLedgerInputs is null or the builders return nothing; rows sorted like readLedgerEntries
```
   Command: `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30` → 0 errors.

2. Create `apps/worker/src/ledger/handler.ts` exporting exactly:
```ts
import { type LedgerInputs, listDocumentsForRebuild, loadLedgerInputs, readLedgerEntries, replaceLedgerEntries, type TenantTx } from '@shoebox/db';
import type { RULE_SCHEMAS, RuleResolver } from '@shoebox/domain';
import type { LedgerRebuildDocumentPayload, LedgerRebuildOrgPayload, LedgerVerifyPayload, TenantJobDefinition } from '@shoebox/pipeline';
import type { Logger } from '@shoebox/platform';
import type { SystemHandler, TenantHandler } from '../registry';
export interface LedgerStore { readonly load: typeof loadLedgerInputs; readonly replace: typeof replaceLedgerEntries; readonly read: typeof readLedgerEntries; readonly list: typeof listDocumentsForRebuild; }
export const dbLedgerStore: LedgerStore;
export interface Enqueue { <P extends { orgId: string }>(def: TenantJobDefinition<P>, payload: P): Promise<string | null>; }
export interface LedgerDeps { readonly logger: Pick<Logger, 'info' | 'warn'>; readonly rules?: RuleResolver<typeof RULE_SCHEMAS>; readonly store?: LedgerStore; readonly enqueue: Enqueue; }
export const ORG_REBUILD_BATCH = 200;
export function createLedgerRebuildDocumentHandler(deps: LedgerDeps): TenantHandler<LedgerRebuildDocumentPayload>;
export function createLedgerRebuildOrgHandler(deps: LedgerDeps): TenantHandler<LedgerRebuildOrgPayload>;
export interface VerifyDeps extends LedgerDeps { readonly listOrgIds: () => Promise<string[]>; readonly withTenant: <T>(orgId: string, fn: (tx: TenantTx) => Promise<T>) => Promise<T>; }
export function createLedgerVerifyHandler(deps: VerifyDeps): SystemHandler<LedgerVerifyPayload>;
/** Exposed for tests: the per-document decision without I/O side effects beyond the store. */
export async function rebuildDocument(tx: TenantTx, orgId: string, documentId: string, deps: Required<Pick<LedgerDeps, 'store' | 'rules' | 'logger'>>): Promise<{ changed: boolean; buildVersion?: string; skipped?: 'missing' }>;
```
   Command: `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30` → 0 errors.

3. Create `apps/worker/src/ledger/register.ts` (`registerLedgerJobs(registry: Pick<JobRegistry, 'registerTenant' | 'registerSystem' | 'enqueue'>, db: Pick<TenantDb, 'withTenant' | 'withServiceRole'>, logger): void` registering the three jobs; `listOrgIds` via `db.withServiceRole('export', …)`) and edit `apps/worker/src/main.ts` (import + `registerLedgerJobs(registry, db, logger)` after the categorize line). Check how `startWorker`'s `register` callback exposes the db: `grep -n "register" apps/worker/src/worker.ts | head`; if it passes only the registry, extend the callback signature to `(registry, db)` **in `worker.ts` only at that one call site** and report it. Command: `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30` → 0 errors; `pnpm --filter @shoebox/worker test -- registry 2>&1 | tail -30` → unchanged.

4. Create `apps/worker/test/ledger-rebuild.test.ts` verbatim; implement until it passes, do not edit it:
```ts
import type { LedgerInputs, TaxEntryRow, TenantTx, VatEntryRow } from '@shoebox/db';
import { createCzRules } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import { canonicalJson, computeLedgerDrafts, inputHashOf } from '../src/ledger/build';
import { createLedgerRebuildOrgHandler, createLedgerVerifyHandler, type LedgerStore, rebuildDocument } from '../src/ledger/handler';

const ORG = '11111111-1111-4111-8111-111111111111';
const DOC = '22222222-2222-4222-8222-222222222222';
const LINE = '33333333-3333-4333-8333-333333333331';
const rules = createCzRules();
const tx = {} as TenantTx;
const silent = { info: () => undefined, warn: () => undefined };

function inputs(over: Partial<LedgerInputs> = {}): LedgerInputs {
  return {
    doc: { id: DOC, orgId: ORG, revision: 1, class: 'received_receipt', direction: 'in', status: 'ready', deleted: false, taxDocStatus: 'simplified_tax_document', businessFlag: 'business', currency: 'CZK', documentNumber: 'R-1', totalGross: '1198.00', issueDate: '2026-09-12', duzp: '2026-09-12', receivedDate: null, dueDate: null, servicePeriodFrom: null, servicePeriodTo: null, paidAt: '2026-09-12', vatPointDate: '2026-09-12', isPaidPerDocument: true, paymentMethod: 'card', fxRate: null, fxRateDate: null, partnerId: 'p1' },
    lines: [{ id: LINE, position: 1, lineType: 'item', net: '990.08', vat: '207.92', gross: '1198.00', categoryCode: 'exp_small_assets', businessSharePct: '100', coveredByDocumentId: null, vatTreatment: 'rcv_domestic_vat', vatRateType: 'standard', vatRatePct: '21' }],
    recap: [{ vatRateType: 'standard', vatRatePct: '21.00', base: '990.08', vat: '207.92' }],
    partner: { country: 'CZ', dic: 'CZ27082440', vatId: null },
    profiles: [{ validFrom: '2026-01-01', validTo: null, vatStatus: 'identifikovana_osoba', vatPeriod: 'monthly', foreignServiceDppdPolicy: 'issue_date', mainActivityNace: null }],
    fxRates: [], current: null, ...over,
  };
}
function fakeStore(docs: Record<string, LedgerInputs>, listed: string[] = Object.keys(docs)) {
  const replaced: Array<{ documentId: string; inputHash: string; tax: TaxEntryRow[]; vat: VatEntryRow[] }> = [];
  let bv = 10;
  const stored: Record<string, { tax: TaxEntryRow[]; vat: VatEntryRow[]; buildVersion: string | null }> = {};
  const store: LedgerStore = {
    load: async (_tx, id) => docs[id] ?? null,
    replace: async (_tx, w) => { bv += 1; replaced.push({ documentId: w.documentId, inputHash: w.inputHash, tax: [...w.tax], vat: [...w.vat] }); stored[w.documentId] = { tax: [...w.tax], vat: [...w.vat], buildVersion: String(bv) }; const d = docs[w.documentId]; if (d) docs[w.documentId] = { ...d, current: { v: w.algoVersion, h: w.inputHash, buildVersion: String(bv) } }; return String(bv); },
    read: async (_tx, id) => stored[id] ?? { tax: [], vat: [], buildVersion: null },
    list: async (_tx, _org, _from, offset, limit) => listed.slice(offset, offset + limit),
  };
  return { store, replaced, stored };
}

describe('build', () => {
  it('canonical JSON sorts keys and the hash ignores `current`', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { f: 1, e: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[2,{"e":2,"f":1}]},"b":1}');
    const h = inputHashOf(inputs(), 1);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(inputHashOf(inputs({ current: { v: 1, h: 'x', buildVersion: '3' } }), 1)).toBe(h);
    expect(inputHashOf(inputs({ lines: [] }), 1)).not.toBe(h);
    expect(inputHashOf(inputs(), 2)).not.toBe(h);
  });
  it('IKEA-like card receipt for an identified person (AC-9j): one tax row on the issue date incl. VAT, no VAT rows', () => {
    const d = computeLedgerDrafts(inputs(), rules);
    expect(d.tax).toEqual([expect.objectContaining({ entryDate: '2026-09-12', taxYear: 2026, basis: 'document_evidence', lineId: LINE, categoryCode: 'exp_small_assets', taxEffect: 'deductible_expense', amountCzk: '1198.00', businessSharePct: '100.00', businessAmountCzk: '1198.00' })]);
    expect(d.vat).toEqual([]);
    expect(d.taxYears).toEqual([2026]);
    expect(d.periods).toEqual([]);
  });
  it('a deleted or duplicate document, or one without issue date, yields no drafts', () => {
    expect(computeLedgerDrafts(inputs({ doc: { ...inputs().doc, deleted: true } }), rules)).toMatchObject({ tax: [], vat: [] });
    expect(computeLedgerDrafts(inputs({ doc: { ...inputs().doc, status: 'duplicate' } }), rules)).toMatchObject({ tax: [], vat: [] });
    expect(computeLedgerDrafts(inputs({ doc: { ...inputs().doc, issueDate: null, duzp: null } }), rules)).toMatchObject({ tax: [], vat: [] });
  });
  it('Booking July for an identified person (AC-9c): VAT rows {5}, Σ base 13 699,77, Σ VAT 2 876,95, period 2026-08', () => {
    const booking = inputs({
      doc: { ...inputs().doc, class: 'received_invoice', taxDocStatus: 'foreign_document', documentNumber: '1574300000', totalGross: '13699.77', issueDate: '2026-08-03', duzp: null, servicePeriodFrom: '2026-07-01', servicePeriodTo: '2026-07-31', paidAt: null, vatPointDate: '2026-08-03', isPaidPerDocument: null, paymentMethod: 'bank_transfer', partnerId: 'p4' },
      lines: [
        { id: LINE, position: 1, lineType: 'item', net: '12990.12', vat: null, gross: '12990.12', categoryCode: 'exp_platform_commission', businessSharePct: '100', coveredByDocumentId: null, vatTreatment: 'rcv_eu_service_reverse_charge', vatRateType: 'standard', vatRatePct: '21' },
        { id: '33333333-3333-4333-8333-333333333332', position: 2, lineType: 'fee', net: '709.65', vat: null, gross: '709.65', categoryCode: 'exp_payment_fees', businessSharePct: '100', coveredByDocumentId: null, vatTreatment: 'rcv_eu_service_reverse_charge', vatRateType: 'standard', vatRatePct: '21' },
      ],
      recap: [], partner: { country: 'NL', dic: null, vatId: 'NL805734958B01' },
    });
    const d = computeLedgerDrafts(booking, rules);
    expect(d.vat.every((v) => v.dphdp3Rows.includes('5') && v.khSection === null && v.periodStart === '2026-08-01')).toBe(true);
    const sum = (k: 'baseCzk' | 'vatCzk') => d.vat.reduce((a, v) => a + Math.round(Number(v[k]) * 100), 0);
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
    expect(await rebuildDocument(tx, ORG, DOC, { store, rules, logger: silent })).toEqual({ changed: false, skipped: 'missing' });
    const bumped = fakeStore({ [DOC]: inputs({ current: { v: 0, h: inputHashOf(inputs(), 1), buildVersion: '1' } }) });
    expect((await rebuildDocument(tx, ORG, DOC, { store: bumped.store, rules, logger: silent })).changed).toBe(true);
  });
});

describe('ledger.rebuild_org and ledger.verify', () => {
  it('fans out in batches of 200 with the mapped reason', async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`);
    const { store } = fakeStore({}, ids);
    const enqueued: Array<{ name: string; payload: Record<string, unknown> }> = [];
    const handler = createLedgerRebuildOrgHandler({ logger: silent, rules, store, enqueue: async (def, payload) => { enqueued.push({ name: def.name, payload: payload as Record<string, unknown> }); return 'j'; } });
    await handler({ orgId: ORG, reason: 'profile_changed' }, { tx, attempt: 1, jobId: 'j', signal: new AbortController().signal });
    expect(enqueued).toHaveLength(450);
    expect(enqueued.every((e) => e.name === 'ledger.rebuild_document' && e.payload.reason === 'profile_changed')).toBe(true);
    expect(new Set(enqueued.map((e) => e.payload.documentId)).size).toBe(450);
  });
  it('verify never writes and reports a diff when the stored rows differ from a dry run', async () => {
    const { store, replaced, stored } = fakeStore({ [DOC]: inputs() });
    stored[DOC] = { tax: [], vat: [], buildVersion: '5' };
    const warns: unknown[] = [];
    const handler = createLedgerVerifyHandler({ logger: { info: () => undefined, warn: (obj: unknown) => { warns.push(obj); } } as never, rules, store, enqueue: async () => 'j', listOrgIds: async () => [ORG], withTenant: async (_org, fn) => fn(tx) });
    await handler({ samplePct: 100 }, { attempt: 1, jobId: 'v', signal: new AbortController().signal });
    expect(replaced).toEqual([]);
    expect(warns.some((w) => (w as { event?: string }).event === 'ledger.verify.diff')).toBe(true);
  });
});
```
   The `Math.round(Number(...))` in the Booking test is test-only arithmetic on already-rounded strings; production code uses `Money`.
   Command: `pnpm --filter @shoebox/worker test -- ledger-rebuild 2>&1 | tail -30` → all pass.

## 5. Do not touch

`doc-extract/*`, `categorize/*`, `registry.ts`, `packages/*`; `worker.ts` only per step 3's narrow exception. Hard rules 1 (Money for every amount; strings only at the DB boundary), 3, 4.

## 6. Commands

`pnpm --filter @shoebox/worker test -- ledger-rebuild 2>&1 | tail -30`; `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30`; `pnpm --filter @shoebox/pipeline test -- jobs 2>&1 | tail -30`.

## 7. Acceptance

- [ ] Tests pass; typecheck clean. - [ ] `ledger.verify` has no code path to `replace`. - [ ] No `Number(`/`parseFloat` in `apps/worker/src/ledger/*`.

## 8. Stop and ask

Per TEMPLATE §8. If AC-9c sums differ from 0311's actual output, stop after the second failure and report the actual sums (0311 is the source of truth for VAT amounts).

## 9. Report

`docs/tasks/0325-report.md`. Not in this brief (named for the plan): `POST /documents/{id}/edit-impact`, `document_revisions` on finalized edits, `PERIOD_LOCKED` (need M05 filings: Phase 3); `ledger.rebuild_transaction` and migration 0042 FKs (need P0-DB-08); triggers `payment_link.*`, `fx.rates_imported`, `profile.changed` (callers in lanes A/B/M07 enqueue `ledgerRebuildDocumentJob` / `ledgerRebuildOrgJob`).

## Risk list

`build.ts` (hash inputs, Money mapping), `handler.ts` (no-op rule, verify dry-run).

## Owner steps

None.
