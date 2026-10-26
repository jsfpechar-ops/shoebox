# 0412: Empty the trash after 30 days (retention.trash_purge)

Status: todo
Ticket: lane D, K-D01, M12 §4.6 | Depends on: none | Branch: claude/project-thread-yn56ih | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

A nightly worker job removes documents that have been in the trash for more than 30 days, together with their files in Storage. It never removes a retained document (finalized, retention period not over). The trash note in the UI then says documents are removed after 30 days.

## 2. Context

- M12 §4.6: `retention.trash_purge` runs daily at 03:30 Europe/Prague, is idempotent and writes one `audit_log` summary row per org with counts only.
- The SQL is ready (tested by the orchestrator): `app.purge_trash(cutoff, today, limit)` returns rows `(org_id, kind, path)`. `kind` is `document` (path null), `raw` or `file` (a Storage path). Dependent rows go by FK cascade. A source file goes only when no other document or page uses it.
- The Storage delete runs inside the same service transaction: if it throws, the transaction rolls back and the next run retries. Missing objects are not an error (`BlobStore.delete`).
- `withServiceRole('retention', fn)` is in `@shoebox/db`. System jobs are defined like `opsHeartbeatJob` in `packages/pipeline/src/jobs.ts`.

## 3. Files

| Path | Action |
|---|---|
| `packages/db/migrations/0052_purge_trash.sql` | new (below) |
| `packages/db/migrations/meta/_journal.json` | edit: one entry |
| `packages/db/src/trash-purge.ts` | new (below) |
| `packages/db/src/index.ts` | edit: one export line |
| `packages/db/test/trash-purge.db.test.ts` | new (below) |
| `packages/pipeline/src/jobs.ts` | edit: add the job after `opsHeartbeatJob` |
| `apps/worker/src/retention/trash-purge.ts` | new (below) |
| `apps/worker/test/trash-purge.test.ts` | new (below) |
| `apps/worker/src/worker.ts` | edit: `register` also receives `db` |
| `apps/worker/src/main.ts` | edit: register the job |
| `packages/i18n/messages/en.json` | edit: `trash.note` value |
| `docs/context/known-issues.md` | edit: delete the K-D01 row |

## 4. Steps

1. New `packages/db/migrations/0052_purge_trash.sql`:
   ```sql
   -- 0052_purge_trash: hard-deletes trashed documents older than the cutoff (M12 §4.6 retention.trash_purge).
   -- Retained documents (finalized, retention_until not passed) are never deleted. A source file goes
   -- only when no other document or page uses it. Returns what the worker must remove from Storage.
   -- Service role only (the worker's retention job). Forward-only.
   create or replace function app.purge_trash(p_cutoff timestamptz, p_today date, p_limit int)
     returns table (org_id uuid, kind text, path text)
     language plpgsql volatile security invoker set search_path = public, pg_temp as $$
   declare
     v_docs uuid[];
     v_files uuid[];
   begin
     select coalesce(array_agg(t.id), '{}') into v_docs from (
       select d.id from documents d
       where d.deleted_at < p_cutoff
         and not (d.finalized_at is not null and (d.retention_until is null or d.retention_until >= p_today))
       order by d.deleted_at
       limit p_limit
       for update skip locked
     ) t;
     if cardinality(v_docs) = 0 then
       return;
     end if;

     return query select d.org_id, 'document'::text, null::text from documents d where d.id = any(v_docs);
     return query select r.org_id, 'raw'::text, r.raw_response_path from extraction_runs r
       where r.document_id = any(v_docs) and r.raw_response_path is not null;
     insert into audit_log (org_id, actor_kind, entity, action, diff)
       select d.org_id, 'system', 'documents', 'trash_purge', jsonb_build_object('documents', count(*))
       from documents d where d.id = any(v_docs) group by d.org_id;

     select coalesce(array_agg(distinct d.source_file_id), '{}') into v_files
       from documents d where d.id = any(v_docs) and d.source_file_id is not null;
     delete from documents d where d.id = any(v_docs);

     v_files := array(
       select f from unnest(v_files) f
       where not exists (select 1 from documents o where o.source_file_id = f)
         and not exists (select 1 from document_pages p where p.source_file_id = f)
     );
     update ingest_items i set source_file_id = null where i.source_file_id = any(v_files);
     return query
       with gone as (delete from source_files s where s.id = any(v_files) returning s.org_id, s.storage_path)
       select gone.org_id, 'file'::text, gone.storage_path from gone;
   end
   $$;
   revoke execute on function app.purge_trash(timestamptz, date, int) from public, anon, authenticated, app_worker;
   ```
   Journal: after the last entry (`0051_backups_bucket`) add `{ "idx": <last idx + 1>, "version": "7", "when": 1792977600000, "tag": "0052_purge_trash", "breakpoints": true }`, multi-line like the others. Run `pnpm --filter @shoebox/db exec drizzle-kit check 2>&1 | tail -3`.
2. New `packages/db/src/trash-purge.ts`:
   ```ts
   // One batch of retention.trash_purge (M12 §4.6) over app.purge_trash (migration 0052).
   import { sql } from 'drizzle-orm';
   import type { ServiceTx } from './tenant';

   export interface TrashPurge {
     /** Documents deleted in this batch. */
     readonly documents: number;
     /** Storage paths (source files, raw model answers) the caller removes from the bucket. */
     readonly paths: readonly string[];
   }

   /** Deletes up to `limit` documents trashed before `cutoff`. Run inside withServiceRole('retention'). */
   export async function purgeTrash(
     tx: ServiceTx,
     cutoff: Date,
     today: string,
     limit: number,
   ): Promise<TrashPurge> {
     const rows = await tx.execute<{ kind: string; path: string | null }>(
       sql`select kind, path from app.purge_trash(${cutoff.toISOString()}::timestamptz, ${today}::date, ${limit}::int)`,
     );
     let documents = 0;
     const paths: string[] = [];
     for (const row of rows) {
       if (row.kind === 'document') documents += 1;
       else if (row.path) paths.push(row.path);
     }
     return { documents, paths };
   }
   ```
   `packages/db/src/index.ts`: add `export { purgeTrash, type TrashPurge } from './trash-purge';` after the `rate-limit` export line.
   New `packages/db/test/trash-purge.db.test.ts` (do not edit):
   ```ts
   import { sql as q } from 'drizzle-orm';
   import postgres, { type Sql } from 'postgres';
   import { afterAll, beforeAll, describe, expect, it } from 'vitest';
   import { runMigrations } from '../src/migrate';
   import { closeDb, createTenantDb, type TenantDb } from '../src/tenant';
   import { purgeTrash } from '../src/trash-purge';

   const DATABASE_URL = process.env.DATABASE_URL;
   const ORG = 'eeeeeeee-0000-4000-8000-000000000412';
   const F1 = 'eeeeeeee-0000-4000-8000-0000000004f1';
   const F2 = 'eeeeeeee-0000-4000-8000-0000000004f2';
   const D = (n: number) => `eeeeeeee-0000-4000-8000-0000000004d${n}`;

   function workerUrlFrom(serviceUrl: string): string {
     const u = new URL(serviceUrl);
     u.username = 'app_worker';
     u.password = '';
     return u.toString();
   }

   describe.skipIf(DATABASE_URL === undefined)('purgeTrash', () => {
     const serviceUrl = DATABASE_URL ?? '';
     let sql: Sql;
     let db: TenantDb;

     beforeAll(async () => {
       sql = postgres(serviceUrl, { max: 1, onnotice: () => undefined });
       await runMigrations(serviceUrl);
       await sql`delete from organizations where id = ${ORG}`;
       await sql`insert into organizations (id, name, inbound_email_slug, inbound_email_secret)
         values (${ORG}, 'Org P', 'org-p-0412', 'PPPPPPPP')`;
       await sql`insert into source_files (id, org_id, sha256, storage_path, mime_type, byte_size, channel) values
         (${F1}, ${ORG}, ${'a'.repeat(64)}, ${`org/${ORG}/files/${'a'.repeat(64)}`}, 'application/pdf', 1, 'upload'),
         (${F2}, ${ORG}, ${'b'.repeat(64)}, ${`org/${ORG}/files/${'b'.repeat(64)}`}, 'application/pdf', 1, 'upload')`;
       await sql`insert into documents (id, org_id, source_file_id, status, deleted_at, finalized_at, retention_until) values
         (${D(1)}, ${ORG}, ${F1}, 'ready', now() - interval '40 days', null, null),
         (${D(2)}, ${ORG}, ${F2}, 'ready', now() - interval '40 days', null, null),
         (${D(3)}, ${ORG}, ${F2}, 'ready', null, null, null),
         (${D(4)}, ${ORG}, ${F2}, 'ready', now() - interval '40 days', now(), '2037-12-31'),
         (${D(5)}, ${ORG}, ${F2}, 'ready', now() - interval '5 days', null, null)`;
       await sql`insert into ingest_items (org_id, origin, channel, original_filename, filename_nfc, byte_size, sha256, state, source_file_id)
         values (${ORG}, 'upload', 'upload', 'a.pdf', 'a.pdf', 1, ${'a'.repeat(64)}, 'accepted', ${F1})`;
       db = createTenantDb(
         { workerUrl: process.env.WORKER_DATABASE_URL ?? workerUrlFrom(serviceUrl), serviceUrl },
         { max: 1 },
       );
     }, 30_000);

     afterAll(async () => {
       if (sql) await sql`delete from organizations where id = ${ORG}`;
       await sql?.end();
       await db?.close();
       await closeDb();
     });

     it('deletes old trash, keeps retained, live and recent documents, frees unused files', async () => {
       const cutoff = new Date(Date.now() - 30 * 86_400_000);
       const result = await db.withServiceRole('retention', (tx) => purgeTrash(tx, cutoff, '2026-10-26', 200));
       expect(result.documents).toBe(2);
       expect(result.paths).toEqual([`org/${ORG}/files/${'a'.repeat(64)}`]);
       const docs = await sql`select id from documents where org_id = ${ORG} order by id`;
       expect(docs.map((r) => r.id)).toEqual([D(3), D(4), D(5)]);
       const files = await sql`select id from source_files where org_id = ${ORG}`;
       expect(files.map((r) => r.id)).toEqual([F2]);
       const audit = await sql`select diff from audit_log where org_id = ${ORG} and action = 'trash_purge'`;
       expect(audit.map((r) => r.diff)).toEqual([{ documents: 2 }]);
     });

     it('is idempotent', async () => {
       const cutoff = new Date(Date.now() - 30 * 86_400_000);
       const again = await db.withServiceRole('retention', (tx) => purgeTrash(tx, cutoff, '2026-10-26', 200));
       expect(again).toEqual({ documents: 0, paths: [] });
     });

     it('the worker role cannot call it', async () => {
       await expect(
         db.withTenant(ORG, (tx) => tx.execute(q`select * from app.purge_trash(now(), current_date, 1)`)),
       ).rejects.toThrow();
     });
   });
   ```
   Run `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/db test -- trash-purge 2>&1 | tail -15`.
3. `packages/pipeline/src/jobs.ts`, after `opsHeartbeatJob`:
   ```ts
   /** M12 §4.6: hard-delete documents trashed more than 30 days ago (never retained ones). */
   export const retentionTrashPurgeJob = defineSystemJob({
     name: 'retention.trash_purge',
     payload: z.strictObject({}),
     cron: '30 3 * * *',
   });
   ```
4. New `apps/worker/src/retention/trash-purge.ts`:
   ```ts
   // retention.trash_purge (M12 §4.6): batches of app.purge_trash on the service connection; the
   // Storage delete runs inside the transaction, so a failed delete rolls the batch back for a retry.
   import { purgeTrash, type ServiceTx, type TenantDb, type TrashPurge } from '@shoebox/db';
   import { pragueToday } from '@shoebox/domain';
   import { retentionTrashPurgeJob } from '@shoebox/pipeline';
   import { type BlobStore, createSupabaseBlobStore, type Logger, orgIdOfPath } from '@shoebox/platform';
   import type { JobRegistry, SystemHandler } from '../registry';

   export const TRASH_DAYS = 30;
   const BATCH = 200;
   const MAX_BATCHES = 50;

   export interface TrashPurgeDeps {
     readonly db: Pick<TenantDb, 'withServiceRole'>;
     readonly blobs: Pick<BlobStore, 'delete'>;
     readonly logger: Pick<Logger, 'info'>;
     readonly now?: () => number;
     readonly purge?: (tx: ServiceTx, cutoff: Date, today: string, limit: number) => Promise<TrashPurge>;
   }

   export function createTrashPurgeHandler(deps: TrashPurgeDeps): SystemHandler<Record<string, never>> {
     const purge = deps.purge ?? purgeTrash;
     return async () => {
       const now = deps.now?.() ?? Date.now();
       const cutoff = new Date(now - TRASH_DAYS * 86_400_000);
       const today = pragueToday({ now: () => now });
       let documents = 0;
       let objects = 0;
       for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
         const result = await deps.db.withServiceRole('retention', async (tx) => {
           const r = await purge(tx, cutoff, today, BATCH);
           const paths = r.paths.filter((path) => orgIdOfPath(path) !== null);
           if (paths.length > 0) await deps.blobs.delete(paths);
           return { documents: r.documents, objects: paths.length };
         });
         documents += result.documents;
         objects += result.objects;
         if (result.documents < BATCH) break;
       }
       deps.logger.info({ documents, objects }, 'retention.trash_purge done');
     };
   }

   const REQUIRED = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;

   export function registerTrashPurge(
     registry: Pick<JobRegistry, 'registerSystem'>,
     db: Pick<TenantDb, 'withServiceRole'>,
     env: Readonly<Record<string, string | undefined>>,
     logger: Pick<Logger, 'info' | 'warn'>,
   ): boolean {
     const url = env.SUPABASE_URL;
     const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
     if (!url || !serviceKey) {
       logger.warn({ missing: REQUIRED.filter((name) => !env[name]) }, 'retention.trash_purge not registered');
       return false;
     }
     registry.registerSystem(
       retentionTrashPurgeJob,
       createTrashPurgeHandler({ db, blobs: createSupabaseBlobStore({ url, apiKey: serviceKey }), logger }),
     );
     return true;
   }
   ```
   If `ServiceTx` or `TrashPurge` is not exported from `@shoebox/db` (check `packages/db/src/index.ts`), add it to the export there.
   New `apps/worker/test/trash-purge.test.ts` (do not edit):
   ```ts
   import type { ServiceTx, TrashPurge } from '@shoebox/db';
   import { describe, expect, it, vi } from 'vitest';
   import { createTrashPurgeHandler, TRASH_DAYS } from '../src/retention/trash-purge';

   const ORG = 'aaaaaaaa-0000-4000-8000-000000000001';
   const PATH = `org/${ORG}/files/${'a'.repeat(64)}`;
   const ctx = { jobId: 'j', attempt: 1, signal: new AbortController().signal };
   const db = { withServiceRole: vi.fn(async (_r: string, fn: (tx: ServiceTx) => Promise<unknown>) => fn({} as ServiceTx)) };

   describe('retention.trash_purge handler', () => {
     it('uses a 30-day cutoff and deletes the returned Storage objects', async () => {
       const now = Date.parse('2026-10-26T02:30:00Z');
       const purge = vi.fn(async (): Promise<TrashPurge> => ({ documents: 1, paths: [PATH, 'not-a-path'] }));
       const blobs = { delete: vi.fn(async () => undefined) };
       const logger = { info: vi.fn() };
       await createTrashPurgeHandler({ db: db as never, blobs, logger, now: () => now, purge })({}, ctx);
       const [, cutoff, today, limit] = purge.mock.calls[0] as unknown as [unknown, Date, string, number];
       expect(cutoff.getTime()).toBe(now - TRASH_DAYS * 86_400_000);
       expect(today).toBe('2026-10-26');
       expect(limit).toBe(200);
       expect(blobs.delete).toHaveBeenCalledWith([PATH]);
       expect(logger.info).toHaveBeenCalledWith({ documents: 1, objects: 1 }, 'retention.trash_purge done');
     });

     it('runs another batch while a batch is full', async () => {
       const purge = vi
         .fn()
         .mockResolvedValueOnce({ documents: 200, paths: [] })
         .mockResolvedValueOnce({ documents: 3, paths: [] });
       const blobs = { delete: vi.fn(async () => undefined) };
       await createTrashPurgeHandler({ db: db as never, blobs, logger: { info: vi.fn() }, purge })({}, ctx);
       expect(purge).toHaveBeenCalledTimes(2);
       expect(blobs.delete).not.toHaveBeenCalled();
     });

     it('a failed Storage delete fails the job (the batch rolls back)', async () => {
       const purge = vi.fn(async (): Promise<TrashPurge> => ({ documents: 1, paths: [PATH] }));
       const blobs = { delete: vi.fn(async () => { throw new Error('storage down'); }) };
       await expect(
         createTrashPurgeHandler({ db: db as never, blobs, logger: { info: vi.fn() }, purge })({}, ctx),
       ).rejects.toThrow('storage down');
     });
   });
   ```
5. `apps/worker/src/worker.ts`: change `readonly register?: (registry: JobRegistry) => void;` to `readonly register?: (registry: JobRegistry, db: TenantDb) => void;`, add `type TenantDb` to the `@shoebox/db` import, and change `options.register?.(registry);` to `options.register?.(registry, db);`. `apps/worker/src/main.ts`: `register: (registry, db) => {` and add `registerTrashPurge(registry, db, process.env, logger);` after `registerDocSplit(...)`, with its import `import { registerTrashPurge } from './retention/trash-purge';` (sorted after the doc-split import).
6. `en.json`: set `"trash.note"` to `"Documents you moved here are removed for good after 30 days. Until then they do not count in your totals and you can bring them back."`. `docs/context/known-issues.md`: delete the `K-D01` row.
7. Checks: `pnpm --filter @shoebox/worker test 2>&1 | tail -8`, `pnpm --filter @shoebox/pipeline test 2>&1 | tail -5`, `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -10`, `pnpm --filter @shoebox/db typecheck 2>&1 | tail -10`, `pnpm --filter @shoebox/web typecheck 2>&1 | tail -5`, `pnpm --filter @shoebox/i18n test 2>&1 | tail -5`, `pnpm exec biome check apps/worker packages/db packages/pipeline 2>&1 | tail -10` (fix your files with `--write`), `python3 scripts/context_lint.py 2>&1 | tail -3`.

## 5. Do not touch

Other migrations, `registry.ts`, doc-extract and doc-split code, web pages. Hard rules 3, 4 (log counts only, never paths or names).

## 6. Commands

As in the steps.

## 7. Acceptance

- [ ] trash-purge db test and worker test pass; worker, db, pipeline and web typecheck 0; biome clean; drizzle-kit check passes; context lint OK.

## 8. Stop and ask

As TEMPLATE §8.

## 9. Report

`docs/tasks/0412-report.md`, 150 tokens at most. Set `Status: review`.
