# 0048: Save a document's reading in the database

Status: review
Ticket: P1-EXT-07 (trimmed, Phase 1 core loop) | Depends on: none | Base commit: 6b5a98e | Branch: task/0048-reading-store | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Add the database functions the `doc.extract` job needs: load a document with its file and the org's IČO/DIČ, and save one reading in one go (document columns and status, VAT recap, extracted fields, check results, the extraction run), or record a failed reading. All of it runs inside `withTenant`, so it can only touch the job's own org.

## 2. Context

- Hard rule 3: every query is org-scoped. These functions take a `TenantTx` (from `withTenant`, role `app_worker`, RLS on `app.org_id`), never the service connection.
- Money columns are `numeric(15,2)` and Drizzle gives them as strings; never convert to numbers (hard rule 1).
- Tables and Drizzle names (all exported from `packages/db/src/schema/*`): `documents` (`id, orgId, sourceFileId, status, class, classSource, direction, taxDocStatus, partnerSnapshot, buyerSnapshot, documentNumber, variableSymbol, issueDate, duzp, dueDate, currency, totalNet, totalVat, totalGross, paymentMethod, payToAccount, isPaidPerDocument, deletedAt`), `sourceFiles` (`id, storagePath, mimeType`), `organizations` (`id, ico, dic`), `documentVatSummary` (`orgId, documentId, vatRateType, vatRatePct, base, vat`; key document + type + pct), `documentFields` (`orgId, documentId, fieldKey, valueText, source, extractionRunId, isCurrent`), `validationResults` (`orgId, documentId, ruleId, ruleVersion, severity, state, params`; `unique (document_id, rule_id)`), `extractionRuns` (`orgId, documentId, stage, method, model, promptVersion, attempt, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, latencyMs, ok, error`).
- A re-read (same document read again) must leave one VAT recap per rate, mark the earlier fields `is_current = false`, replace the `open` check results and keep `dismissed`/`resolved` ones.
- A local database is running for this session: `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres` and `WORKER_DATABASE_URL=postgresql://app_worker:ci-local-only@127.0.0.1:54322/postgres` (migrations are applied; tests call `runMigrations` again, which is a no-op). Pattern for DB tests: `packages/db/test/with-tenant.db.test.ts` (read lines 1–80 only).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/src/document-reading.ts` | create | the functions below |
| `packages/db/src/index.ts` | edit | `export * from './document-reading';` |
| `packages/db/test/document-reading.db.test.ts` | create | the test file below, verbatim |

No other file may change.

## 4. Steps

1. Create `packages/db/test/document-reading.db.test.ts` (below, verbatim). Commit `0048 step 1`.
2. Create `packages/db/src/document-reading.ts` with exactly these exports and implement until the tests pass (do not edit the test file):

```ts
import type { TenantTx } from './tenant';

export interface DocumentForRead {
  readonly id: string;
  readonly orgId: string;
  readonly status: string;
  readonly storagePath: string;
  readonly mimeType: string;
  readonly orgIco: string | null;
  readonly orgDic: string | null;
}

export interface ReadingPatch {
  readonly class: string;
  readonly classSource: 'llm';
  readonly direction: 'in';
  readonly taxDocStatus: 'full_tax_document' | 'not_tax_document' | 'unknown';
  readonly partnerSnapshot: Record<string, string | null> | null;
  readonly buyerSnapshot: Record<string, string | null> | null;
  readonly documentNumber: string | null;
  readonly variableSymbol: string | null;
  readonly issueDate: string | null;
  readonly duzp: string | null;
  readonly dueDate: string | null;
  readonly currency: string;
  readonly totalNet: string | null;
  readonly totalVat: string | null;
  readonly totalGross: string | null;
  readonly paymentMethod: 'bank_transfer' | 'card' | 'cash' | 'cod' | 'other' | null;
  readonly payToAccount: Record<string, string | null> | null;
  readonly isPaidPerDocument: boolean | null;
}

export interface ReadingWrite {
  readonly orgId: string;
  readonly documentId: string;
  readonly status: 'ready' | 'needs_review' | 'supporting';
  readonly patch: ReadingPatch;
  readonly vatSummary: readonly { vatRateType: 'standard' | 'reduced' | 'zero' | 'none'; vatRatePct: string; base: string; vat: string }[];
  readonly fields: readonly { fieldKey: string; valueText: string; source: 'llm' }[];
  readonly validations: readonly { ruleId: string; ruleVersion: number; severity: 'blocking' | 'warning'; params: Record<string, unknown> }[];
  readonly run: {
    readonly model: string; readonly promptVersion: string; readonly attempt: number;
    readonly inputTokens: number; readonly outputTokens: number;
    readonly cacheReadTokens: number; readonly cacheWriteTokens: number; readonly latencyMs: number;
  };
}

/** The document (not deleted) with its file and the org's IČO/DIČ; null when absent or another org's. */
export function loadDocumentForRead(tx: TenantTx, documentId: string): Promise<DocumentForRead | null>;
/** Sets only the status (e.g. 'extracting' before the model call). */
export function setDocumentStatus(tx: TenantTx, documentId: string, status: 'extracting' | 'failed'): Promise<void>;
/** Writes one successful reading; returns the extraction run id. */
export function saveDocumentReading(tx: TenantTx, write: ReadingWrite): Promise<string>;
/** Records a failed model call; with `final` the document becomes 'failed'. `error` is a code, never content. */
export function recordFailedRead(
  tx: TenantTx,
  failure: { orgId: string; documentId: string; model: string; promptVersion: string; attempt: number; error: string; final: boolean },
): Promise<void>;
```

   Implementation notes: use the Drizzle query builder (`eq`, `and`, `inArray` from `drizzle-orm`), no raw SQL strings. `saveDocumentReading` order: insert `extractionRuns` (`stage: 'extract'`, `method: 'llm'`, `ok: true`) returning `id` → update `documents` with the patch and status → delete the document's `documentVatSummary` rows, insert the new ones → update the document's current `documentFields` to `isCurrent: false`, insert the new ones with `extractionRunId` and `isCurrent: true` → delete the document's `validationResults` with `state = 'open'`, insert the new ones with `.onConflictDoNothing()`. Skip an insert when its list is empty. Run `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres WORKER_DATABASE_URL=postgresql://app_worker:ci-local-only@127.0.0.1:54322/postgres pnpm --filter @shoebox/db exec vitest run test/document-reading.db.test.ts 2>&1 | tail -30`. Expected: all pass. Commit `0048 step 2`.
3. Edit `packages/db/src/index.ts`: after `export * from './rls-catalog';` add `export * from './document-reading';`. Run `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30` and `pnpm exec biome ci packages/db 2>&1 | tail -30`. Expected: clean. Commit `0048 step 3`.

Test file `packages/db/test/document-reading.db.test.ts`:

```ts
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  loadDocumentForRead,
  type ReadingWrite,
  recordFailedRead,
  saveDocumentReading,
  setDocumentStatus,
} from '../src/document-reading';
import { runMigrations } from '../src/migrate';
import { closeDb, createTenantDb, type TenantDb } from '../src/tenant';

const DATABASE_URL = process.env.DATABASE_URL;
const ORG_R = 'eeeeeeee-0000-4000-8000-000000000045';
const ORG_S = 'eeeeeeee-0000-4000-8000-000000000046';
const SF = 'eeeeeeee-0000-4000-8000-0000000000f1';
const DOC = 'eeeeeeee-0000-4000-8000-0000000000d1';
const SHA = 'a'.repeat(64);

function workerUrlFrom(serviceUrl: string): string {
  const u = new URL(serviceUrl);
  u.username = 'app_worker';
  u.password = '';
  return u.toString();
}

function write(overrides: Partial<ReadingWrite> = {}): ReadingWrite {
  return {
    orgId: ORG_R,
    documentId: DOC,
    status: 'ready',
    patch: {
      class: 'received_invoice', classSource: 'llm', direction: 'in', taxDocStatus: 'full_tax_document',
      partnerSnapshot: { name: 'Dodavatel s.r.o.', ico: '27082440', dic: 'CZ27082440', vat_id: null, country: 'CZ' },
      buyerSnapshot: null, documentNumber: 'FV1', variableSymbol: '1', issueDate: '2026-10-01',
      duzp: '2026-10-01', dueDate: '2026-10-15', currency: 'CZK', totalNet: '1000', totalVat: '210',
      totalGross: '1210', paymentMethod: 'bank_transfer',
      payToAccount: { account: '123456789', bank_code: '0100', iban: null }, isPaidPerDocument: null,
    },
    vatSummary: [{ vatRateType: 'standard', vatRatePct: '21', base: '1000', vat: '210' }],
    fields: [
      { fieldKey: 'supplier.ico', valueText: '27082440', source: 'llm' },
      { fieldKey: 'totals.gross', valueText: '1210', source: 'llm' },
    ],
    validations: [{ ruleId: 'PROTO_DIC_FORMAT', ruleVersion: 1, severity: 'warning', params: { a: 1 } }],
    run: {
      model: 'claude-haiku-5-5', promptVersion: 'm02-proto-v3', attempt: 1, inputTokens: 1000,
      outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0, latencyMs: 1500,
    },
    ...overrides,
  };
}

describe.skipIf(DATABASE_URL === undefined)('document reading store', () => {
  const serviceUrl = DATABASE_URL ?? '';
  let sql: Sql;
  let db: TenantDb;

  beforeAll(async () => {
    sql = postgres(serviceUrl, { max: 1, onnotice: () => undefined });
    await runMigrations(serviceUrl);
    await sql`delete from organizations where id in (${ORG_R}, ${ORG_S})`;
    await sql`insert into organizations (id, name, ico, dic, inbound_email_slug, inbound_email_secret)
      values (${ORG_R}, 'Org R', '12345678', 'CZ12345678', 'org-r-0048', 'RRRRRRRR'),
             (${ORG_S}, 'Org S', null, null, 'org-s-0048', 'SSSSSSSS')`;
    await sql`insert into source_files (id, org_id, sha256, storage_path, mime_type, byte_size, channel)
      values (${SF}, ${ORG_R}, ${SHA}, ${`org/${ORG_R}/files/${SHA}`}, 'application/pdf', 10, 'upload')`;
    await sql`insert into documents (id, org_id, source_file_id, status) values (${DOC}, ${ORG_R}, ${SF}, 'received')`;
    db = createTenantDb(
      { workerUrl: process.env.WORKER_DATABASE_URL ?? workerUrlFrom(serviceUrl), serviceUrl },
      { max: 1 },
    );
  }, 30_000);

  afterAll(async () => {
    if (sql) await sql`delete from organizations where id in (${ORG_R}, ${ORG_S})`;
    await sql?.end();
    await db?.close();
    await closeDb();
  });

  it('loads the document with its file and the org identity', async () => {
    const doc = await db.withTenant(ORG_R, (tx) => loadDocumentForRead(tx, DOC));
    expect(doc).toEqual({
      id: DOC, orgId: ORG_R, status: 'received', storagePath: `org/${ORG_R}/files/${SHA}`,
      mimeType: 'application/pdf', orgIco: '12345678', orgDic: 'CZ12345678',
    });
  });

  it('another org cannot see it', async () => {
    expect(await db.withTenant(ORG_S, (tx) => loadDocumentForRead(tx, DOC))).toBeNull();
  });

  it('saves a reading, and a re-read replaces it cleanly', async () => {
    await db.withTenant(ORG_R, (tx) => setDocumentStatus(tx, DOC, 'extracting'));
    const runId = await db.withTenant(ORG_R, (tx) => saveDocumentReading(tx, write()));
    expect(runId).toMatch(/^[0-9a-f-]{36}$/);
    await sql`update validation_results set state = 'dismissed' where document_id = ${DOC}`;
    await db.withTenant(ORG_R, (tx) =>
      saveDocumentReading(tx, write({
        status: 'needs_review',
        validations: [
          { ruleId: 'PROTO_DIC_FORMAT', ruleVersion: 1, severity: 'warning', params: {} },
          { ruleId: 'PROTO_VAT_SUM', ruleVersion: 1, severity: 'blocking', params: {} },
        ],
      })),
    );

    const [doc] = await sql`select status, total_gross, class, partner_snapshot->>'ico' as ico from documents where id = ${DOC}`;
    expect(doc).toEqual({ status: 'needs_review', total_gross: '1210.00', class: 'received_invoice', ico: '27082440' });
    const vat = await sql`select vat_rate_type, base, vat from document_vat_summary where document_id = ${DOC}`;
    expect(vat).toEqual([{ vat_rate_type: 'standard', base: '1000.00', vat: '210.00' }]);
    const [fields] = await sql`select count(*) filter (where is_current)::int as current, count(*)::int as total
      from document_fields where document_id = ${DOC}`;
    expect(fields).toEqual({ current: 2, total: 4 });
    const checks = await sql`select rule_id, state from validation_results where document_id = ${DOC} order by rule_id`;
    expect(checks).toEqual([
      { rule_id: 'PROTO_DIC_FORMAT', state: 'dismissed' },
      { rule_id: 'PROTO_VAT_SUM', state: 'open' },
    ]);
    const [runs] = await sql`select count(*)::int as n from extraction_runs where document_id = ${DOC} and ok`;
    expect(runs).toEqual({ n: 2 });
  });

  it('records a failed read and fails the document on the last attempt', async () => {
    const failure = { orgId: ORG_R, documentId: DOC, model: 'claude-haiku-5-5', promptVersion: 'm02-proto-v3', error: 'http_529' };
    await db.withTenant(ORG_R, (tx) => recordFailedRead(tx, { ...failure, attempt: 1, final: false }));
    const [mid] = await sql`select status from documents where id = ${DOC}`;
    expect(mid?.status).toBe('needs_review');
    await db.withTenant(ORG_R, (tx) => recordFailedRead(tx, { ...failure, attempt: 3, final: true }));
    const [end] = await sql`select status from documents where id = ${DOC}`;
    expect(end?.status).toBe('failed');
    const [runs] = await sql`select count(*)::int as n from extraction_runs where document_id = ${DOC} and not ok and error = 'http_529'`;
    expect(runs).toEqual({ n: 2 });
  });
});
```

## 5. Do not touch

Migrations, `packages/db/src/schema/**`, `packages/db/src/tenant.ts`, everything outside `packages/db`. Hard rules 1 and 3.

## 6. Commands

- the vitest command of step 2 (with both URLs) → all pass.
- `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30` → clean.
- `pnpm exec biome ci packages/db 2>&1 | tail -30` → clean.

## 7. Acceptance

- [ ] The test file is unchanged and passes against the local database.
- [ ] No `sql\`` raw strings and no `withServiceRole` in `document-reading.ts`.
- [ ] Typecheck and biome clean.

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found;
- a test fails twice, or a test the brief wrote seems wrong (for example an RLS or grant error for `app_worker`: report the exact error, do not change migrations);
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a new dependency seems needed;
- a file outside §3 needs a change;
- §5 would be touched;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy (hand that to the owner with the exact command).

## 9. Report

Write `docs/tasks/0048-report.md` (600 tokens at most) and set `Status: review`. The report has the files changed, each command with the last 5 lines of output, §7 ticked, deviations, questions, owner steps left.

## Risk list (for the reviewer)

`packages/db/src/document-reading.ts` (tenant scope, re-read semantics).

## Owner steps

None.
