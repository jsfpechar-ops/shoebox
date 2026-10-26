# 0100: Same invoice uploaded twice becomes a duplicate

Status: todo
Ticket: P1-ING-08 (semantic part only) | Depends on: none | Base commit: 496b1e9 | Branch: claude/project-thread-236iho | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

A user who uploads the same invoice twice as different files (a phone photo and the PDF) must not get it counted twice. After a reading is saved, a document with the same supplier, document number, gross total and currency as an earlier live document becomes `duplicate` with a `duplicate_of` link to the earlier one.

## 2. Context

- M01 §4.6.3: key = supplier + document number + gross total; the earlier document stays primary (fidelity ranking is a later TODO). A document the user marked "Keep both" (`semantic_dedupe_exempt = true`) never matches.
- Existing schema (migration 0005/0006, no migration needed): `documents.status` enum has `duplicate`; `documents.semantic_dedupe_exempt boolean`; `document_links (org_id, from_document_id, to_document_id, kind doc_link_kind)` with kind `duplicate_of`; drizzle table `documentLinks` in `packages/db/src/schema/document-details.ts`.
- `partner_id` is not filled yet, so the supplier is compared from `partner_snapshot`: digits of `ico` when the new document has one, else the lower-cased trimmed name.
- Excerpt in `packages/db/src/document-reading.ts` (find verbatim, near the end of `saveDocumentReading`):

```ts
      .onConflictDoNothing();
  }

  return runId;
}
```

## 3. Files

| Path | Action | What |
|---|---|---|
| packages/db/src/semantic-dedupe.ts | new | `markIfSemanticDuplicate` |
| packages/db/src/document-reading.ts | edit | call it at the end of `saveDocumentReading` |
| packages/db/src/index.ts | edit | export the new module |
| packages/db/test/semantic-dedupe.db.test.ts | new | the test below |

No other file may change.

## 4. Steps

1. Create `packages/db/src/semantic-dedupe.ts` with exactly:

```ts
// Semantic dedupe (M01 §4.6.3): the same invoice uploaded twice as different files, e.g. a phone
// photo and the PDF. Runs right after a reading is saved: the earlier live document stays, the new
// one becomes 'duplicate' with a duplicate_of link. TODO(fidelity): prefer ISDOC/PDF over a photo.
import { type SQL, sql } from 'drizzle-orm';
import { documentLinks } from './schema/document-details';
import type { TenantTx } from './tenant';

/** Supplier key of a documents alias: 'ico:<digits>' when an IČO is printed, else 'name:<lower name>'. */
function supplierKey(alias: string): SQL {
  const a = sql.raw(alias);
  return sql`case when regexp_replace(coalesce(${a}.partner_snapshot->>'ico', ''), '[^0-9]', '', 'g') <> ''
    then 'ico:' || regexp_replace(${a}.partner_snapshot->>'ico', '[^0-9]', '', 'g')
    else 'name:' || regexp_replace(lower(trim(coalesce(${a}.partner_snapshot->>'name', ''))), '[[:space:]]+', ' ', 'g') end`;
}

function numberKey(alias: string): SQL {
  return sql`regexp_replace(upper(${sql.raw(alias)}.document_number), '[^A-Z0-9]', '', 'g')`;
}

/**
 * When `documentId` repeats an earlier live document of the org (same supplier, document number,
 * gross total and currency), marks it 'duplicate', links it to that document and returns the
 * earlier document's id; otherwise returns null and changes nothing.
 */
export async function markIfSemanticDuplicate(
  tx: TenantTx,
  orgId: string,
  documentId: string,
): Promise<string | null> {
  // One dedupe at a time per org, so two copies read at once cannot both stay.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${orgId} || ':semantic-dedupe'))`);
  const rows = await tx.execute<{ id: string }>(sql`
    select o.id from documents n
    join documents o on o.org_id = n.org_id and o.id <> n.id
    where n.id = ${documentId} and n.org_id = ${orgId}
      and not n.semantic_dedupe_exempt and not o.semantic_dedupe_exempt
      and o.deleted_at is null
      and o.status in ('needs_review', 'ready', 'finalized')
      and n.document_number is not null and n.total_gross is not null
      and ${numberKey('n')} <> ''
      and o.total_gross = n.total_gross and o.currency = n.currency
      and ${numberKey('o')} = ${numberKey('n')}
      and regexp_replace(${supplierKey('n')}, '^name:$', '') <> ''
      and ${supplierKey('o')} = ${supplierKey('n')}
    order by o.created_at asc, o.id asc
    limit 1`);
  const original = rows[0]?.id;
  if (original === undefined) return null;

  await tx.execute(
    sql`update documents set status = 'duplicate' where id = ${documentId} and org_id = ${orgId}`,
  );
  await tx
    .insert(documentLinks)
    .values({ orgId, fromDocumentId: documentId, toDocumentId: original, kind: 'duplicate_of' })
    .onConflictDoNothing();
  return original;
}
```

   If `documentLinks` column names differ (check `grep -n -A10 'documentLinks = pgTable' packages/db/src/schema/document-details.ts`), use the schema's names; nothing else may change. Run `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30` → no errors.

2. Edit `packages/db/src/document-reading.ts`. Add `import { markIfSemanticDuplicate } from './semantic-dedupe';` after the `import type { TenantTx } from './tenant';` line, and replace the excerpt in §2 with:

```ts
      .onConflictDoNothing();
  }

  if (write.status !== 'supporting') {
    await markIfSemanticDuplicate(tx, orgId, documentId);
  }

  return runId;
}
```

   Typecheck → no errors.

3. Edit `packages/db/src/index.ts`: after `export * from './rls-catalog';` add `export { markIfSemanticDuplicate } from './semantic-dedupe';`. Typecheck → no errors.

4. Create `packages/db/test/semantic-dedupe.db.test.ts` exactly as below. Implement until it passes; do not edit it. It skips without `DATABASE_URL`; CI runs it.

```ts
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ReadingWrite, saveDocumentReading } from '../src/document-reading';
import { runMigrations } from '../src/migrate';
import { closeDb, createTenantDb, type TenantDb } from '../src/tenant';

const DATABASE_URL = process.env.DATABASE_URL;
const ORG = 'eeeeeeee-0000-4000-8000-000000000100';
const ORG2 = 'eeeeeeee-0000-4000-8000-000000000101';
const id = (n: number) => `eeeeeeee-0000-4000-8000-0000001001${String(n).padStart(2, '0')}`;

function workerUrlFrom(serviceUrl: string): string {
  const u = new URL(serviceUrl);
  u.username = 'app_worker';
  u.password = '';
  return u.toString();
}

function write(
  orgId: string,
  documentId: string,
  patch: Partial<ReadingWrite['patch']> = {},
  status: ReadingWrite['status'] = 'ready',
): ReadingWrite {
  return {
    orgId,
    documentId,
    status,
    patch: {
      class: 'received_invoice',
      classSource: 'llm',
      direction: 'in',
      taxDocStatus: 'full_tax_document',
      partnerSnapshot: { name: 'Dodavatel s.r.o.', ico: '27082440', dic: null, vat_id: null, country: 'CZ' },
      buyerSnapshot: null,
      documentNumber: 'FV 2026-0001',
      variableSymbol: null,
      issueDate: '2026-10-01',
      duzp: '2026-10-01',
      dueDate: null,
      currency: 'CZK',
      totalNet: '1000',
      totalVat: '210',
      totalGross: '1210',
      paymentMethod: null,
      payToAccount: null,
      isPaidPerDocument: null,
      ...patch,
    },
    vatSummary: [],
    fields: [],
    validations: [],
    run: {
      model: 'claude-haiku-5-5',
      promptVersion: 'test',
      attempt: 1,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      latencyMs: 0,
    },
  };
}

describe.skipIf(DATABASE_URL === undefined)('semantic dedupe after a reading', () => {
  const serviceUrl = DATABASE_URL ?? '';
  let sql: Sql;
  let db: TenantDb;

  async function newDoc(orgId: string, n: number): Promise<string> {
    const sha = String(n).padStart(2, '0').repeat(32);
    await sql`insert into source_files (id, org_id, sha256, storage_path, mime_type, byte_size, channel)
      values (${id(n)}, ${orgId}, ${sha}, ${`org/${orgId}/files/${sha}`}, 'image/jpeg', 10, 'upload')`;
    await sql`insert into documents (id, org_id, source_file_id, status, created_at)
      values (${id(n)}, ${orgId}, ${id(n)}, 'extracting', now() - make_interval(secs => ${100 - n}))`;
    return id(n);
  }
  const statusOf = async (doc: string) =>
    (await sql`select status from documents where id = ${doc}`)[0]?.status;
  const save = (w: ReadingWrite) => db.withTenant(w.orgId, (tx) => saveDocumentReading(tx, w));

  beforeAll(async () => {
    sql = postgres(serviceUrl, { max: 1, onnotice: () => undefined });
    await runMigrations(serviceUrl);
    await sql`delete from organizations where id in (${ORG}, ${ORG2})`;
    await sql`insert into organizations (id, name, inbound_email_slug, inbound_email_secret)
      values (${ORG}, 'Org D', 'org-d-0100', 'DDDDDDDD'), (${ORG2}, 'Org E', 'org-e-0100', 'EEEEEEEE')`;
    db = createTenantDb(
      { workerUrl: process.env.WORKER_DATABASE_URL ?? workerUrlFrom(serviceUrl), serviceUrl },
      { max: 1 },
    );
  }, 30_000);

  afterAll(async () => {
    if (sql) await sql`delete from organizations where id in (${ORG}, ${ORG2})`;
    await sql?.end();
    await db?.close();
    await closeDb();
  });

  it('the second copy becomes a duplicate of the first, even with a differently written number', async () => {
    const first = await newDoc(ORG, 1);
    const second = await newDoc(ORG, 2);
    await save(write(ORG, first));
    await save(write(ORG, second, { documentNumber: 'fv2026/0001' }));
    expect(await statusOf(first)).toBe('ready');
    expect(await statusOf(second)).toBe('duplicate');
    const links = await sql`select to_document_id, kind from document_links where from_document_id = ${second}`;
    expect(links).toEqual([{ to_document_id: first, kind: 'duplicate_of' }]);
  });

  it('a different total, number or supplier is not a duplicate', async () => {
    const a = await newDoc(ORG, 3);
    const b = await newDoc(ORG, 4);
    const c = await newDoc(ORG, 5);
    await save(write(ORG, a, { totalGross: '1211' }));
    await save(write(ORG, b, { documentNumber: 'FV 2026-0002' }));
    await save(write(ORG, c, { partnerSnapshot: { name: 'Jiný s.r.o.', ico: '12345679', dic: null, vat_id: null, country: 'CZ' } }));
    expect([await statusOf(a), await statusOf(b), await statusOf(c)]).toEqual(['ready', 'ready', 'ready']);
  });

  it('without an IČO the supplier name decides, ignoring case and spaces', async () => {
    const noIco = { name: 'Kavárna  U Lípy', ico: null, dic: null, vat_id: null, country: 'CZ' };
    const a = await newDoc(ORG, 6);
    const b = await newDoc(ORG, 7);
    await save(write(ORG, a, { partnerSnapshot: noIco, documentNumber: 'U-77' }));
    await save(write(ORG, b, { partnerSnapshot: { ...noIco, name: 'kavárna u lípy ' }, documentNumber: 'U-77' }));
    expect(await statusOf(b)).toBe('duplicate');
  });

  it('a document kept as separate ("Keep both") never matches', async () => {
    const a = await newDoc(ORG, 8);
    const b = await newDoc(ORG, 9);
    await save(write(ORG, a, { documentNumber: 'K-1' }));
    await sql`update documents set semantic_dedupe_exempt = true where id = ${a}`;
    await save(write(ORG, b, { documentNumber: 'K-1' }));
    expect(await statusOf(b)).toBe('ready');
  });

  it('a supporting document, a document without a number and another org are never duplicates', async () => {
    const a = await newDoc(ORG, 10);
    const b = await newDoc(ORG, 11);
    const c = await newDoc(ORG, 12);
    const d = await newDoc(ORG, 13);
    const e = await newDoc(ORG2, 14);
    await save(write(ORG, a, { documentNumber: 'S-1' }));
    await save(write(ORG, b, { documentNumber: 'S-1' }, 'supporting'));
    await save(write(ORG, c, { documentNumber: null }));
    await save(write(ORG, d, { documentNumber: null }));
    await save(write(ORG2, e, { documentNumber: 'S-1' }));
    expect([await statusOf(b), await statusOf(d), await statusOf(e)]).toEqual(['supporting', 'ready', 'ready']);
  });
});
```

   Run the commands in §6.

## 5. Do not touch

`apps/`, other `packages/`, migrations. Hard rules 3 (org-scoped: every query filters `org_id`) and 4 (no document content in logs).

## 6. Commands

- `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30` → no errors.
- `pnpm --filter @shoebox/db test -- semantic-dedupe document-reading 2>&1 | tail -30` → passes, or "skipped" without `DATABASE_URL` (CI runs it).
- `pnpm exec biome check packages/db 2>&1 | tail -30` → clean (run `pnpm exec biome format --write packages/db` if only formatting).

## 7. Acceptance

- [ ] The test file passes in CI (`db` job).
- [ ] `git diff --stat origin/phase/0` lists only the 4 files in §3 plus this brief and its report.

## 8. Stop and ask

Stop and write the report as `blocked` if an excerpt is not found, a test fails twice, a file outside §3 needs a change, or you reach 25 tool calls.

## 9. Report

`docs/tasks/0100-report.md`, 300 tokens at most: files changed, last 5 lines of each command, anything odd. Set `Status: review`.
