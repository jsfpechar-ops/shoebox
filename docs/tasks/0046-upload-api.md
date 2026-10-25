# 0046: Upload API that stores a file and queues its reading

Status: review
Ticket: P1-ING-03 (trimmed, Phase 1 core loop) | Depends on: none | Base commit: 37d843b | Branch: task/0046-upload-api | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

`POST /api/documents` takes one or more files from the signed-in user, stores each in the org's storage, creates its `source_files` and `documents` rows, and queues the `doc.extract` job that reads it with Haiku 5.5. The same file uploaded twice shows up once.

## 2. Context

- Every query is org-scoped (hard rule 3). The route works only for the active org of the signed-in user, and uses the user's Supabase session so RLS applies (`apply_tenant_rls`: members with role `owner` or `member` may insert; storage policy `org_files_insert` the same for paths `org/{org_id}/…`).
- Auth helper (do not edit, import only): `requireActiveRole(roles)` from `apps/web/src/auth/org-context.ts` returns `{ ok: true, orgId, userId, role } | { ok: false, code: 'unauthenticated' | 'no_org' | 'forbidden' }`. Supabase client: `createSupabaseServerClient()` and `appOrigin()` from `apps/web/src/supabase/server.ts`.
- Storage path: `filePath(orgId, sha256)` from `@shoebox/platform` gives `org/{orgId}/files/{sha256}`; bucket `org-files`.
- `source_files` columns used: `org_id, sha256, storage_path, mime_type, byte_size, original_filename, filename_nfc, uploaded_by, channel ('upload')`; `unique (org_id, sha256)`.
- `documents` columns used: `org_id, source_file_id, status ('received'), received_date` (date). `entry_mode` defaults to `captured`.
- Job: `doc.extract`, payload `documentStagePayload` (`{ orgId, documentId }`, in `packages/pipeline/src/jobs.ts`), version 1, entity = the document id. The worker today derives the pg-boss job id in `apps/worker/src/registry.ts`:

```ts
/** A UUID (version-5 layout) derived from an idempotency key: same key, same pg-boss job id. */
export function jobIdFromKey(key: string): string {
```

  and sends with `boss.send(def.name, data, { id: jobIdFromKey(key), singletonKey: key });`. The web must send the same way, so move `jobIdFromKey` into `@shoebox/pipeline` and re-export it from the worker.
- pg-boss 12.35.1 is an owner-approved dependency (decisions 2026-10-18 [deps]); the web uses it only to send. Constructor: `new PgBoss({ connectionString, schema: 'pgboss', supervise: false, schedule: false, migrate: false })`, then `await boss.start()`. Connection: `process.env.DATABASE_URL`.
- Accepted files: `application/pdf`, `image/jpeg`, `image/png`, `image/webp`; at most 20 MiB each; at most 50 files per request. HEIC comes in a later brief.
- Privacy (hard rule 4): never log file names or content.
- Same-origin check: a POST whose `Origin` header is not `appOrigin()` gets 403.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/pipeline/src/jobs.ts` | edit | add `jobIdFromKey` and `docExtractJob` |
| `packages/pipeline/test/jobs.test.ts` | edit | append the tests below |
| `apps/worker/src/registry.ts` | edit | use and re-export `jobIdFromKey` from `@shoebox/pipeline` |
| `apps/web/src/documents/upload.ts` | create | pure upload flow with injected deps |
| `apps/web/test/upload.test.ts` | create | the test file below, verbatim |
| `apps/web/src/documents/enqueue.ts` | create | lazy PgBoss sender for `doc.extract` |
| `apps/web/src/documents/supabase-deps.ts` | create | `UploadDeps` over the user's Supabase client |
| `apps/web/app/api/documents/route.ts` | create | the POST handler |
| `apps/web/package.json` | edit | add `@shoebox/pipeline`, `@shoebox/platform` (`workspace:*`) and `pg-boss` (`12.35.1`) |
| `pnpm-lock.yaml` | edit | only through `pnpm install` |

No other file may change.

## 4. Steps

1. Edit `packages/pipeline/src/jobs.ts`. After the line `import { z } from 'zod';` add `import { createHash } from 'node:crypto';` (put it first, biome sorts imports). At the end of the file append:

```ts
/** A UUID (version-5 layout) derived from an idempotency key: same key, same pg-boss job id. */
export function jobIdFromKey(key: string): string {
  const bytes = createHash('sha1').update(`shoebox.job:${key}`).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** M02: read one document (Haiku 5.5), then run the checks. Enqueued by the upload API. */
export const docExtractJob = defineTenantJob({
  name: 'doc.extract',
  payload: documentStagePayload,
  version: 1,
  entityId: (payload) => payload.documentId,
});
```

   Append to `packages/pipeline/test/jobs.test.ts` (add `docExtractJob, jobIdFromKey, jobKey` to its existing `../src/jobs` import if not there):

```ts
describe('docExtractJob and jobIdFromKey', () => {
  const ORG = '11111111-1111-4111-8111-111111111111';
  const DOC = '22222222-2222-4222-8222-222222222222';
  it('keys on the document', () => {
    expect(jobKey(docExtractJob, { orgId: ORG, documentId: DOC })).toBe(`${ORG}:doc.extract:${DOC}:1`);
  });
  it('derives a stable UUID from the key', () => {
    const id = jobIdFromKey(`${ORG}:doc.extract:${DOC}:1`);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(jobIdFromKey(`${ORG}:doc.extract:${DOC}:1`)).toBe(id);
  });
});
```

   Run `pnpm --filter @shoebox/pipeline test -- jobs 2>&1 | tail -30`. Expected: pass. Commit `0046 step 1`.
2. Edit `apps/worker/src/registry.ts`: delete the line `import { createHash } from 'node:crypto';` and the whole `jobIdFromKey` function with its doc comment (lines quoted in §2 through its closing `}`). Add `jobIdFromKey` to the existing `from '@shoebox/pipeline'` import, and below the imports add `export { jobIdFromKey };`. Run `pnpm --filter @shoebox/worker test -- registry.test 2>&1 | tail -30`. Expected: pass (registry.db tests need a database; skip them). Commit `0046 step 2`.
3. Edit `apps/web/package.json` dependencies: add `"@shoebox/pipeline": "workspace:*"`, `"@shoebox/platform": "workspace:*"`, `"pg-boss": "12.35.1"` in alphabetical order. Run `pnpm install 2>&1 | tail -5`. Commit `0046 step 3`.
4. Create `apps/web/test/upload.test.ts` (below, verbatim), then `apps/web/src/documents/upload.ts` with exactly these exports; implement until the tests pass:

```ts
export const UPLOAD_MEDIA_TYPES: readonly string[]; // the four types of §2
export const UPLOAD_MAX_BYTES: number;              // 20 * 1024 * 1024
export const UPLOAD_MAX_FILES: number;              // 50
export interface UploadFile { readonly name: string; readonly type: string; readonly bytes: Uint8Array }
export interface SourceFileInsert {
  readonly orgId: string; readonly sha256: string; readonly storagePath: string; readonly mimeType: string;
  readonly byteSize: number; readonly originalFilename: string; readonly filenameNfc: string; readonly uploadedBy: string;
}
export interface UploadDeps {
  putFile(path: string, bytes: Uint8Array, contentType: string): Promise<void>; // an existing object is not an error
  insertSourceFile(row: SourceFileInsert): Promise<{ id: string; created: boolean }>; // created false = same org+sha256 existed
  findDocumentBySource(sourceFileId: string): Promise<string | null>;
  insertDocument(row: { orgId: string; sourceFileId: string; receivedDate: string }): Promise<string>;
  enqueueRead(orgId: string, documentId: string): Promise<void>;
  today(): string; // Prague date YYYY-MM-DD
}
export type UploadItem =
  | { readonly fileName: string; readonly status: 'accepted' | 'duplicate'; readonly documentId: string }
  | { readonly fileName: string; readonly status: 'rejected'; readonly reason: 'type' | 'size' | 'empty' };
export function sha256Hex(bytes: Uint8Array): string; // node:crypto
export function uploadDocuments(
  deps: UploadDeps, ctx: { orgId: string; userId: string }, files: readonly UploadFile[],
): Promise<UploadItem[]>;
```

   Flow per file, in order: reject (`empty` for 0 bytes, `type`, `size`) → sha256 → `putFile(filePath(orgId, sha), bytes, type)` → `insertSourceFile` → if not created and a document exists for it: `duplicate` with that id, no enqueue → else `insertDocument` then `enqueueRead`; if `enqueueRead` throws, the item is still `accepted` (the document waits as `received`). `filenameNfc` is `name.normalize('NFC')`. Run `pnpm --filter @shoebox/web test -- upload 2>&1 | tail -30`. Expected: pass. Commit `0046 step 4`.

```ts
import { describe, expect, it } from 'vitest';
import {
  sha256Hex,
  type SourceFileInsert,
  UPLOAD_MAX_BYTES,
  type UploadDeps,
  uploadDocuments,
} from '../src/documents/upload';

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '33333333-3333-4333-8333-333333333333';
const pdf = (text: string) => ({ name: 'Faktura ř.pdf', type: 'application/pdf', bytes: new TextEncoder().encode(text) });

function fakeDeps(options: { failEnqueue?: boolean } = {}) {
  const puts: string[] = [];
  const sources = new Map<string, { id: string; row: SourceFileInsert }>();
  const docs = new Map<string, string>();
  const enqueued: string[] = [];
  let n = 0;
  const deps: UploadDeps = {
    async putFile(path) { puts.push(path); },
    async insertSourceFile(row) {
      const existing = sources.get(row.sha256);
      if (existing) return { id: existing.id, created: false };
      const id = `sf-${++n}`;
      sources.set(row.sha256, { id, row });
      return { id, created: true };
    },
    async findDocumentBySource(id) { return docs.get(id) ?? null; },
    async insertDocument(row) { const id = `doc-${++n}`; docs.set(row.sourceFileId, id); return id; },
    async enqueueRead(_org, documentId) { if (options.failEnqueue) throw new Error('down'); enqueued.push(documentId); },
    today: () => '2026-10-25',
  };
  return { deps, puts, sources, enqueued };
}

describe('sha256Hex', () => {
  it('hashes bytes to 64 hex chars', () => {
    expect(sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('uploadDocuments', () => {
  it('stores, records and queues a new file', async () => {
    const { deps, puts, sources, enqueued } = fakeDeps();
    const items = await uploadDocuments(deps, { orgId: ORG, userId: USER }, [pdf('a')]);
    const sha = sha256Hex(new TextEncoder().encode('a'));
    expect(puts).toEqual([`org/${ORG}/files/${sha}`]);
    expect(items).toEqual([{ fileName: 'Faktura ř.pdf', status: 'accepted', documentId: expect.any(String) }]);
    expect(enqueued).toHaveLength(1);
    expect(sources.get(sha)?.row).toMatchObject({
      orgId: ORG, sha256: sha, storagePath: `org/${ORG}/files/${sha}`, mimeType: 'application/pdf',
      byteSize: 1, uploadedBy: USER, filenameNfc: 'Faktura ř.pdf'.normalize('NFC'),
    });
  });

  it('shows the same file once', async () => {
    const { deps, enqueued } = fakeDeps();
    const [first] = await uploadDocuments(deps, { orgId: ORG, userId: USER }, [pdf('a')]);
    const [second] = await uploadDocuments(deps, { orgId: ORG, userId: USER }, [pdf('a')]);
    expect(second).toEqual({ fileName: 'Faktura ř.pdf', status: 'duplicate', documentId: (first as { documentId: string }).documentId });
    expect(enqueued).toHaveLength(1);
  });

  it('rejects empty, wrong type and too large files without storing them', async () => {
    const { deps, puts } = fakeDeps();
    const items = await uploadDocuments(deps, { orgId: ORG, userId: USER }, [
      { name: 'e.pdf', type: 'application/pdf', bytes: new Uint8Array() },
      { name: 'x.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: new Uint8Array([1]) },
      { name: 'big.pdf', type: 'application/pdf', bytes: new Uint8Array(UPLOAD_MAX_BYTES + 1) },
    ]);
    expect(items.map((i) => (i.status === 'rejected' ? i.reason : i.status))).toEqual(['empty', 'type', 'size']);
    expect(puts).toEqual([]);
  });

  it('keeps the document when the queue is down', async () => {
    const { deps } = fakeDeps({ failEnqueue: true });
    const [item] = await uploadDocuments(deps, { orgId: ORG, userId: USER }, [pdf('b')]);
    expect(item?.status).toBe('accepted');
  });
});
```

5. Create `apps/web/src/documents/enqueue.ts`:

```ts
import { docExtractJob, jobIdFromKey, jobKey } from '@shoebox/pipeline';
import { PgBoss } from 'pg-boss';

let started: Promise<PgBoss> | undefined;

/** One sender per server process; no workers, crons or migrations here (the worker owns those). */
function boss(): Promise<PgBoss> {
  if (started === undefined) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) return Promise.reject(new Error('DATABASE_URL is not set'));
    const instance = new PgBoss({ connectionString, schema: 'pgboss', supervise: false, schedule: false, migrate: false });
    started = instance.start().then(() => instance);
    started.catch(() => { started = undefined; });
  }
  return started;
}

/** Queues `doc.extract` with the worker's idempotency key: a second call for the same document is a no-op. */
export async function enqueueDocExtract(orgId: string, documentId: string): Promise<void> {
  const payload = docExtractJob.payload.parse({ orgId, documentId });
  const key = jobKey(docExtractJob, payload);
  await (await boss()).send(docExtractJob.name, payload, { id: jobIdFromKey(key), singletonKey: key });
}
```

   If `PgBoss` option names do not typecheck, grep `node_modules/.pnpm/pg-boss@12.35.1/node_modules/pg-boss/dist/types.d.ts` for `supervise?:` and use the names found there. Commit `0046 step 5`.
6. Create `apps/web/src/documents/supabase-deps.ts` exporting `function supabaseUploadDeps(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>): UploadDeps`:
   - `putFile`: `supabase.storage.from('org-files').upload(path, bytes, { contentType, upsert: false })`; an error whose `statusCode` is `'409'` or message contains `exists` is fine, any other error throws `new Error('storage')`.
   - `insertSourceFile`: `insert({ org_id, sha256, storage_path, mime_type, byte_size, original_filename, filename_nfc, uploaded_by, channel: 'upload' }).select('id').single()`; on error code `23505` select the existing `id` by `org_id` + `sha256` and return `created: false`; other errors throw `new Error('source_files')`.
   - `findDocumentBySource`: `from('documents').select('id').eq('source_file_id', id).is('deleted_at', null).limit(1).maybeSingle()`.
   - `insertDocument`: `insert({ org_id, source_file_id, status: 'received', received_date }).select('id').single()`.
   - `enqueueRead`: `enqueueDocExtract`. `today`: `pragueToday(systemClock)` from `@shoebox/domain` (grep `packages/domain/src/dates/index.ts` and `packages/domain/src/clock` for the exact clock export; if none, use `new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague' }).format(new Date())`).
   Run `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`. Commit `0046 step 6`.
7. Create `apps/web/app/api/documents/route.ts`:

```ts
import { requireActiveRole } from '../../../src/auth/org-context';
import { supabaseUploadDeps } from '../../../src/documents/supabase-deps';
import { UPLOAD_MAX_FILES, type UploadFile, uploadDocuments } from '../../../src/documents/upload';
import { appOrigin, createSupabaseServerClient } from '../../../src/supabase/server';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  if (request.headers.get('origin') !== appOrigin()) return Response.json({ error: 'origin' }, { status: 403 });
  const auth = await requireActiveRole(['owner', 'member']);
  if (!auth.ok) return Response.json({ error: auth.code }, { status: auth.code === 'unauthenticated' ? 401 : 403 });
  const form = await request.formData();
  const entries = form.getAll('files').filter((value): value is File => value instanceof File);
  if (entries.length === 0 || entries.length > UPLOAD_MAX_FILES) return Response.json({ error: 'count' }, { status: 400 });
  const files: UploadFile[] = await Promise.all(
    entries.map(async (file) => ({ name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) })),
  );
  const supabase = await createSupabaseServerClient();
  const items = await uploadDocuments(supabaseUploadDeps(supabase), { orgId: auth.orgId, userId: auth.userId }, files);
  return Response.json({ items });
}
```

   Match the relative-import style other files in `apps/web/app/api/health/route.ts` use (if it uses a path alias like `@/src/...`, use that). Run `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` and `pnpm exec biome ci apps/web packages/pipeline apps/worker 2>&1 | tail -30`. Expected: clean. Commit `0046 step 7`.

## 5. Do not touch

`apps/web/src/auth/**`, `apps/web/e2e/**`, `supabase/config.toml`, `packages/db/**`, `packages/i18n/**`, `apps/web/app/(app)/**`. Hard rules 3 and 4.

## 6. Commands

- `pnpm --filter @shoebox/pipeline test -- jobs 2>&1 | tail -30`
- `pnpm --filter @shoebox/worker test -- registry.test 2>&1 | tail -30`
- `pnpm --filter @shoebox/web test -- upload 2>&1 | tail -30`
- `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`
- `pnpm exec biome ci apps/web packages/pipeline apps/worker 2>&1 | tail -30`

## 7. Acceptance

- [ ] The upload test file is unchanged and passes; pipeline and worker registry unit tests pass.
- [ ] `grep -rn 'console\.' apps/web/src/documents apps/web/app/api/documents` finds nothing.
- [ ] Typecheck and biome clean.

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found;
- a test fails twice, or a test the brief wrote seems wrong;
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a new dependency seems needed;
- a file outside §3 needs a change;
- §5 would be touched;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy (hand that to the owner with the exact command).

## 9. Report

Write `docs/tasks/0046-report.md` (600 tokens at most) and set `Status: review`. The report has the files changed, each command with the last 5 lines of output, §7 ticked, deviations, questions, owner steps left.

## Risk list (for the reviewer)

`apps/web/app/api/documents/route.ts` (auth, origin), `apps/web/src/documents/supabase-deps.ts` (RLS path), `apps/web/src/documents/enqueue.ts`.

## Owner steps

None now. When the web is deployed, it needs `DATABASE_URL` (already used by the health check).
