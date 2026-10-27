# 0622: Backfill lines for documents read before 0620, and a catch-up job that categorizes what was missed

Status: todo
Ticket: P1-M04 trigger | Depends on: 0621 | Base commit: 6e7c134 | Branch: claude/project-thread-vvw1j4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Documents read before brief 0620 have a VAT recap but no lines, and none of them was ever categorized, so the ledgers are empty. A migration creates their lines from `document_vat_summary` (SQL, no worker), and a system job every 15 minutes enqueues `doc.categorize` for every document that is `ready` or `needs_review`, has lines, and was never categorized. The user does nothing; the job is also the safety net when an enqueue after a read or an import is lost.

## 2. Context

- Hard rule 5: job names are canonical in 03 §3.1; this brief adds `doc.categorize.catchup` there (owner default decision, logged by the orchestrator).
- `documents.stage_version` is jsonb; `saveCategorization` sets `stage_version.categorize`, so "never categorized" = `stage_version->'categorize' is null`.
- `planCategorization` throws for a null `direction` or `issue_date`; the catch-up lists only documents that have both.
- System jobs (packages/pipeline/src/jobs.ts): `defineSystemJob({ name, payload: z.strictObject({}), cron, retry })`; the registry schedules the cron itself. Excerpt:

```ts
/** Worker heartbeat: a cron every minute; /healthz reports its last tick (M12 §4.2). */
export const opsHeartbeatJob = defineSystemJob({
  name: 'ops.heartbeat',
  payload: z.strictObject({}),
  cron: '* * * * *',
  retry: { retryLimit: 0 },
});
```

- Excerpt, same file, `JOB_NAMES`:

```ts
  'validate.catalog_upgrade',
  'doc.categorize',
  // Ingestion jobs (M01)
```

- Excerpt, packages/pipeline/test/jobs.test.ts:

```ts
  it('lists the 40 concrete job names, unique and `<domain>.<action>`', () => {
    expect(JOB_NAMES).toHaveLength(40);
```

- Excerpt, docs/v3/03-architecture.md §3.1 table row (the end of the cell): `· \`doc.categorize\` (M04) |`
- The system-handler pattern with `listOrgIds` + `withTenant` is `createLedgerVerifyHandler` in apps/worker/src/ledger/handler.ts; its registration in apps/worker/src/ledger/register.ts:

```ts
      listOrgIds: () =>
        db.withServiceRole('export', async (tx) =>
          (await tx.select({ id: organizations.id }).from(organizations)).map((row) => row.id),
        ),
      withTenant: (orgId, fn) => db.withTenant(orgId, fn),
```

- `JobRegistry.enqueue(def, payload)` returns the job id or `null` when a job with the same key exists; `docCategorizeJob` payload: `{ orgId, documentId, revision, trigger: 'pipeline', nonce }`.
- Excerpt, apps/worker/src/main.ts:

```ts
    registerLedgerJobs(registry, db, logger);
```

- Excerpt, apps/worker/src/categorize/register.ts imports:

```ts
import { docCategorizeJob } from '@shoebox/pipeline';
```

- Migrations: hand-written SQL in `packages/db/migrations/NNNN_name.sql` plus a journal entry in `packages/db/migrations/meta/_journal.json` (`when` = `Date.now()` at the time you write it, `idx` = previous + 1). Forward-only, no `drop`. The last entry today:

```json
    {
      "idx": 22,
      "version": "7",
      "when": 1793056476900,
      "tag": "0064_analytics_views",
      "breakpoints": true
    }
```

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/migrations/0065_document_lines_backfill.sql` | new | lines from the recap for documents without lines |
| `packages/db/migrations/meta/_journal.json` | edit | journal entry idx 23 |
| `packages/pipeline/src/jobs.ts` | edit | `doc.categorize.catchup` name + `docCategorizeCatchupJob` |
| `packages/pipeline/test/jobs.test.ts` | edit | 40 → 41 |
| `docs/v3/03-architecture.md` | edit | the one job name in §3.1 |
| `packages/db/src/document-catchup.ts` | new | `listDocumentsToCategorize` |
| `packages/db/src/index.ts` | edit | export it |
| `apps/worker/src/categorize/catchup.ts` | new | handler + `registerCategorizeCatchup` |
| `apps/worker/test/categorize-catchup.test.ts` | new | unit test with fakes |
| `apps/worker/src/main.ts` | edit | register it |

No other file may change.

## 4. Steps

### Step 1: new file `packages/db/migrations/0065_document_lines_backfill.sql`

```sql
-- 0065_document_lines_backfill (M02 §6 step 5, brief 0622): documents read before brief 0620 have a
-- VAT recap in document_vat_summary but no document_lines, so they were never categorized and are
-- missing from the ledgers. One `item` line per recap row (gross = base + vat), a single line from
-- the totals where no recap was printed, and a `rounding` line where documents.rounding <> 0.
-- Only documents that have no lines at all are touched. Forward-only; re-runnable (second run is a no-op).

insert into document_lines (org_id, document_id, position, line_type, net, vat, gross, vat_rate_type, vat_rate_pct)
select s.org_id, s.document_id,
       row_number() over (partition by s.document_id order by s.vat_rate_pct desc, s.vat_rate_type),
       'item', s.base, s.vat, s.base + s.vat, s.vat_rate_type, s.vat_rate_pct
from document_vat_summary s
join documents d on d.id = s.document_id and d.org_id = s.org_id
where d.deleted_at is null
  and not exists (select 1 from document_lines l where l.document_id = s.document_id);

insert into document_lines (org_id, document_id, position, line_type, net, vat, gross, vat_rate_type)
select d.org_id, d.id, 1, 'item', d.total_net, d.total_vat, d.total_gross, 'none'
from documents d
where d.deleted_at is null
  and d.total_gross is not null
  and not exists (select 1 from document_vat_summary s where s.document_id = d.id)
  and not exists (select 1 from document_lines l where l.document_id = d.id);

insert into document_lines (org_id, document_id, position, line_type, net, vat, gross, vat_rate_type)
select d.org_id, d.id,
       (select max(l.position) from document_lines l where l.document_id = d.id) + 1,
       'rounding', d.rounding, 0, d.rounding, 'none'
from documents d
where d.deleted_at is null
  and d.rounding <> 0
  and exists (select 1 from document_lines l where l.document_id = d.id)
  and not exists (select 1 from document_lines l where l.document_id = d.id and l.line_type = 'rounding');
```

Then append to `packages/db/migrations/meta/_journal.json` after the `0064_analytics_views` entry (keep valid JSON: add a comma after its closing `}`):

```json
    {
      "idx": 23,
      "version": "7",
      "when": <Date.now() when you write it, an integer in milliseconds>,
      "tag": "0065_document_lines_backfill",
      "breakpoints": true
    }
```

Command: `node -e "JSON.parse(require('fs').readFileSync('packages/db/migrations/meta/_journal.json','utf8')); console.log('journal ok')" 2>&1 | tail -3` → `journal ok`; `node scripts/migration-lint.ts packages/db/migrations/0065_document_lines_backfill.sql 2>&1 | tail -10` → no violation (if the script is run differently in package.json, use that; if it cannot run, say so in the report).

### Step 2: `packages/pipeline/src/jobs.ts`

2a. In `JOB_NAMES`, replace

```ts
  'doc.categorize',
  // Ingestion jobs (M01)
```

with

```ts
  'doc.categorize',
  'doc.categorize.catchup',
  // Ingestion jobs (M01)
```

2b. Directly after the `docCategorizeJob` definition (its closing `});`) add:

```ts
/** Every 15 minutes: enqueue doc.categorize for ready/needs_review documents with lines that were never categorized (brief 0622). */
export const docCategorizeCatchupJob = defineSystemJob({
  name: 'doc.categorize.catchup',
  payload: z.strictObject({}),
  cron: '*/15 * * * *',
  retry: { retryLimit: 0 },
});
```

2c. In `packages/pipeline/test/jobs.test.ts` replace `lists the 40 concrete job names` with `lists the 41 concrete job names` and `toHaveLength(40)` with `toHaveLength(41)`.

2d. In `docs/v3/03-architecture.md` §3.1 table, replace the cell end `· \`doc.categorize\` (M04) |` with `· \`doc.categorize\`, \`doc.categorize.catchup\` (M04) |`. Touch nothing else in that file.

Command: `pnpm --filter @shoebox/pipeline exec vitest run test/jobs.test.ts 2>&1 | tail -30` → all passed.

### Step 3: new file `packages/db/src/document-catchup.ts`

```ts
// Documents that still wait for categorization (brief 0622): ready or needs_review, not deleted,
// with lines, with the inputs planCategorization needs, and no stage_version.categorize yet.
import { and, asc, eq, exists, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { documentLines } from './schema/document-details';
import { documents } from './schema/documents';
import type { TenantTx } from './tenant';

export interface DocumentToCategorize {
  readonly id: string;
  readonly revision: number;
}

export async function listDocumentsToCategorize(
  tx: TenantTx,
  orgId: string,
  limit: number,
): Promise<DocumentToCategorize[]> {
  return tx
    .select({ id: documents.id, revision: documents.revision })
    .from(documents)
    .where(
      and(
        eq(documents.orgId, orgId),
        isNull(documents.deletedAt),
        inArray(documents.status, ['ready', 'needs_review']),
        isNotNull(documents.direction),
        isNotNull(documents.issueDate),
        sql`${documents.stageVersion} -> 'categorize' is null`,
        exists(
          tx
            .select({ one: sql`1` })
            .from(documentLines)
            .where(
              and(eq(documentLines.orgId, orgId), eq(documentLines.documentId, documents.id)),
            ),
        ),
      ),
    )
    .orderBy(asc(documents.createdAt))
    .limit(limit);
}
```

Then in `packages/db/src/index.ts` insert `export * from './document-catchup';` directly before `export * from './document-categorize';`.

Command: `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30` → no errors. If drizzle rejects `exists(...)` with a subquery built from `tx`, replace that clause with `` sql`exists (select 1 from document_lines l where l.org_id = ${documents.orgId} and l.document_id = ${documents.id})` `` and drop the unused imports.

### Step 4: new file `apps/worker/src/categorize/catchup.ts`

```ts
// doc.categorize.catchup (brief 0622): every 15 minutes, enqueue doc.categorize for documents that
// are ready or needs_review, have lines and were never categorized. The safety net behind the
// enqueue after a read (0621), manual entry and spreadsheet import. Ids only, never content.
import {
  type DocumentToCategorize,
  listDocumentsToCategorize,
  organizations,
  type TenantDb,
  type TenantTx,
} from '@shoebox/db';
import {
  docCategorizeCatchupJob,
  docCategorizeJob,
  type TenantJobDefinition,
} from '@shoebox/pipeline';
import type { Logger } from '@shoebox/platform';
import type { JobRegistry, SystemHandler } from '../registry';

export const CATCHUP_LIMIT = 500;

export interface CategorizeCatchupDeps {
  readonly listOrgIds: () => Promise<string[]>;
  readonly withTenant: <T>(orgId: string, fn: (tx: TenantTx) => Promise<T>) => Promise<T>;
  readonly enqueue: <P extends { orgId: string }>(
    def: TenantJobDefinition<P>,
    payload: P,
  ) => Promise<string | null>;
  readonly logger: Pick<Logger, 'info'>;
  readonly now?: () => number;
  readonly list?: (tx: TenantTx, orgId: string, limit: number) => Promise<DocumentToCategorize[]>;
}

export function createCategorizeCatchupHandler(
  deps: CategorizeCatchupDeps,
): SystemHandler<Record<string, never>> {
  const list = deps.list ?? listDocumentsToCategorize;
  return async () => {
    const nonce = (deps.now ?? Date.now)();
    const orgIds = await deps.listOrgIds();
    let enqueued = 0;
    for (const orgId of orgIds) {
      const docs = await deps.withTenant(orgId, (tx) => list(tx, orgId, CATCHUP_LIMIT));
      for (const doc of docs) {
        const id = await deps.enqueue(docCategorizeJob, {
          orgId,
          documentId: doc.id,
          revision: doc.revision,
          trigger: 'pipeline',
          nonce,
        });
        if (id !== null) enqueued += 1;
      }
    }
    deps.logger.info(
      { event: 'doc.categorize.catchup.done', orgs: orgIds.length, enqueued },
      'categorize catch-up finished',
    );
  };
}

export function registerCategorizeCatchup(
  registry: Pick<JobRegistry, 'registerSystem' | 'enqueue'>,
  db: Pick<TenantDb, 'withTenant' | 'withServiceRole'>,
  logger: Pick<Logger, 'info'>,
): void {
  registry.registerSystem(
    docCategorizeCatchupJob,
    createCategorizeCatchupHandler({
      listOrgIds: () =>
        db.withServiceRole('export', async (tx) =>
          (await tx.select({ id: organizations.id }).from(organizations)).map((row) => row.id),
        ),
      withTenant: (orgId, fn) => db.withTenant(orgId, fn),
      enqueue: (def, payload) => registry.enqueue(def, payload),
      logger,
    }),
  );
}
```

Command: `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30` → no errors. If `organizations` is not exported from `@shoebox/db`, import it the way apps/worker/src/ledger/register.ts does.

### Step 5: new file `apps/worker/test/categorize-catchup.test.ts`

```ts
import type { TenantTx } from '@shoebox/db';
import { describe, expect, it } from 'vitest';
import { createCategorizeCatchupHandler } from '../src/categorize/catchup';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '11111111-1111-4111-8111-111111111112';
const D1 = '22222222-2222-4222-8222-222222222221';
const D2 = '22222222-2222-4222-8222-222222222222';
const tx = {} as TenantTx;

describe('doc.categorize.catchup', () => {
  it('enqueues doc.categorize once per waiting document of every org, with one nonce per run', async () => {
    const enqueued: unknown[] = [];
    const logs: unknown[] = [];
    const handler = createCategorizeCatchupHandler({
      listOrgIds: async () => [ORG_A, ORG_B],
      withTenant: async (_org, fn) => fn(tx),
      enqueue: async (def, payload) => {
        enqueued.push({ name: def.name, payload });
        return enqueued.length === 2 ? null : `job-${enqueued.length}`;
      },
      logger: { info: (obj) => logs.push(obj) },
      now: () => 1_700_000_000_000,
      list: async (_tx, orgId) =>
        orgId === ORG_A
          ? [
              { id: D1, revision: 1 },
              { id: D2, revision: 2 },
            ]
          : [],
    });
    await handler({}, { attempt: 1 } as never);
    expect(enqueued).toEqual([
      {
        name: 'doc.categorize',
        payload: { orgId: ORG_A, documentId: D1, revision: 1, trigger: 'pipeline', nonce: 1_700_000_000_000 },
      },
      {
        name: 'doc.categorize',
        payload: { orgId: ORG_A, documentId: D2, revision: 2, trigger: 'pipeline', nonce: 1_700_000_000_000 },
      },
    ]);
    expect(logs).toEqual([{ event: 'doc.categorize.catchup.done', orgs: 2, enqueued: 1 }]);
  });
});
```

If the `logger.info` signature needs a second string argument in the fake, use `info: (obj: unknown) => { logs.push(obj); }`. If `handler({}, ...)` needs a fuller `JobContext`, look at how `apps/worker/test/ledger-rebuild.test.ts` builds one for `createLedgerVerifyHandler` and copy that.

Command: `pnpm --filter @shoebox/worker exec vitest run test/categorize-catchup.test.ts 2>&1 | tail -30` → 1 passed.

### Step 6: `apps/worker/src/main.ts`

6a. After the line `import { registerDocCategorize } from './categorize/register';` add `import { registerCategorizeCatchup } from './categorize/catchup';` (biome may want it sorted before `./categorize/register`; put it where `pnpm exec biome ci apps/worker/src/main.ts` is happy).

6b. After `    registerLedgerJobs(registry, db, logger);` add `    registerCategorizeCatchup(registry, db, logger);`.

Command: `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30` → no errors; `pnpm exec biome ci apps/worker packages/db packages/pipeline 2>&1 | tail -30` → no errors.

## 5. Do not touch

`apps/web/`, `packages/db/src/schema/`, `apps/worker/src/categorize/handler.ts`, `apps/worker/src/categorize/plan.ts`, `apps/worker/src/registry.ts`, any other migration. Hard rules 1, 3 (the list query is org-scoped and runs inside `withTenant`), 5, 8.

## 6. Commands

- `pnpm --filter @shoebox/pipeline exec vitest run test/jobs.test.ts 2>&1 | tail -30`
- `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30`
- `pnpm --filter @shoebox/worker exec vitest run test/categorize-catchup.test.ts 2>&1 | tail -30`
- `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30`
- `pnpm exec biome ci apps/worker packages/db packages/pipeline 2>&1 | tail -30`

## 7. Acceptance

- [ ] Migration 0065 is in the journal and inserts only for documents that have no lines.
- [ ] `doc.categorize.catchup` is in `JOB_NAMES`, 03 §3.1 and the jobs test (41 names).
- [ ] The catch-up handler enqueues one `doc.categorize` per waiting document per org, trigger `pipeline`, one nonce per run, and logs counts only.
- [ ] It is registered in `main.ts`. All §6 commands pass.

## 8. Stop and ask

Stop, and write the report, if: an excerpt is not found; a test fails twice, or a test the brief wrote seems wrong; you reach 25 tool calls or about 50k tokens (report as `blocked`); a new dependency seems needed; a file outside §3 needs a change; §5 would be touched; a step is unclear.

## 9. Report

Write `docs/tasks/0622-report.md` (600 tokens at most) and set `Status: review`: files changed (`git diff --stat`), each command with its last 5 lines, §7 ticked, Deviations, Questions. Commit after every step as `0622 step k`. Do not open a PR.
