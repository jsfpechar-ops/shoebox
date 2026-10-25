# 0026a: Job catalog in `packages/pipeline` (names, id-only payloads, idempotency keys)

Status: todo
Ticket: P0-PLAT-04 (part a of a/b/c) | Depends on: none (0008 logger, 0022a/b `withTenant` merged) | Base commit: head of phase/0 | Branch: task/0026-worker-pgboss | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

`packages/pipeline/src/jobs.ts` becomes the single catalog of job names (03 §3.1), the strict zod payloads that carry ids only, the idempotency key `{org_id}:{stage}:{entity_id}:{version}`, the default retry policy and the `ops.heartbeat` cron. The worker (0026b/c) and later every module enqueue only through these definitions, so no job can carry document content or an unknown name.

## 2. Context

Rules (AGENTS.md), pasted:

- Hard rule 4: no document content in logs or job payloads. 03 §3.1: "Payloads are zod-validated and carry ids only."
- Hard rule 5: names are canonical. Job names come only from 03 §3.1.
- Hard rule 7: no new dependency. `zod` is approved (decisions 2026-10-18 [deps], P0-OWN-01) and pinned `4.6.5` in `packages/domain` and `packages/testkit`; this brief adds the same pin to `packages/pipeline`.

Spec, pasted verbatim:

- 03 ADR-003: "pg-boss for pipeline jobs, scheduled jobs (rates, deadlines, bank polling) and retries with exponential backoff, plus dead-letter queues. Idempotency key on every job (`{org_id}:{stage}:{document_id}:{version}`)."
- 03 §3: "Each transition is a pg-boss job. Payloads are zod-validated. Each stage is **idempotent** and versioned (`stage_version`), so re-processing after a prompt or rule upgrade is safe."
- 03 §3.1: "pg-boss job names are `<domain>.<action>`; events (published as pg-boss topics) are `<entity>.<past_participle>`." Job rows: Pipeline `doc.split`, `doc.classify`, `doc.link_supporting`, `doc.extract`, `extract.llm`, `extract.llm_escalated`, `extract.learn_hints`, `doc.validate`, `validate.registry_retry`, `validate.scope`, `validate.catalog_upgrade`, `doc.categorize` · Ingestion `ingest.item.process`, `ingest.expand`, `ingest.bundle.assemble`, `ingest.rescan`, `ingest.cleanup`, `email.received`, `email.render_body`, `expected.sweep`, `import.spreadsheet.parse`, `import.spreadsheet.run` · Ledger `ledger.rebuild_document`, `ledger.rebuild_transaction`, `ledger.rebuild_org`, `ledger.verify` · Other `vat.period.evaluate`, `vat.filing.generate`, `vat.workbook.generate`, `vat.amendment.detect`, `podklady.generate`, `bank.*`, `obligations.generate`, `obligations.nightly`, `notifications.evaluate`, `notifications.digest`, `notifications.urgent`, `package.*`, `retention.*`, `privacy.*`, `ops.*`. "Idempotency key per ADR-003: `{org_id}:{stage}:{entity_id}:{version}`."
- M12 §4.2: worker `/healthz` reports "pg-boss started, last cron tick < 2 min".

Design choices (brief writer, verified on `origin/phase/0` with pg-boss 12.35.1 and Postgres 16):

- `JOB_NAMES` lists the 36 concrete names; the five `<family>.*` rows are accepted as `family.snake_name`. Events are not jobs.
- `stage` in the key is the job name (e.g. `doc.split`); `version` is the definition's `stage_version`.
- Default retry: `retryLimit` 4 (= 5 attempts), 30 s first delay, exponential backoff, max 1 h; then `<name>.dlq`. pg-boss itself retries 2 times by default, so the policy is explicit.
- `ops.heartbeat` (a member of the `ops.*` family, M12) is the cron behind "last cron tick": every minute, no retry. It is named here once; see the owner question in 0026c.
- This file is pure (no pg-boss, no I/O, no clock). The registry over pg-boss is 0026b.

Anchor, `packages/pipeline/src/index.ts` (step 3), the whole current file:

```ts
export const packageName = '@shoebox/pipeline' as const;
```

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/pipeline/package.json` | edit | add `zod` 4.6.5 |
| `pnpm-lock.yaml` | generated | by `pnpm install`, never by hand |
| `packages/pipeline/src/jobs.ts` | create | job names, payloads, keys, definitions |
| `packages/pipeline/src/index.ts` | edit | `export * from './jobs';` |
| `packages/pipeline/test/jobs.test.ts` | create | 13 tests |

No other file may change.

## 4. Steps

Setup (once): `git fetch -q origin && git checkout -b task/0026-worker-pgboss origin/phase/0 && git log --oneline -1`.

Rules for every step: write each new file with **one Write call**, contents exactly as given. Do not re-read a file you just wrote. Do not explore other files. After the step's command shows the expected result, commit: `git add -A && git commit -qm "0026a step k" && git log --oneline -1`. All commands run from the repo root.

### Step 1: edit `packages/pipeline/package.json`, then install

Replace the whole file with:

```json
{
  "name": "@shoebox/pipeline",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "Stage orchestration, idempotency, job payload schemas.",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    }
  },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "catalog:",
    "vitest": "catalog:"
  },
  "dependencies": {
    "zod": "4.6.5"
  }
}
```

Command: `pnpm install 2>&1 | tail -3` → ends with `Done in …`; `git diff --stat pnpm-lock.yaml | tail -1` → `1 file changed, 4 insertions(+)`. Commit.

### Step 2: create `packages/pipeline/src/jobs.ts`

```ts
// Job catalog (03 ADR-003, 03 §3.1). Names are canonical: `<domain>.<action>`, only from 03 §3.1.
// Payloads are zod strict objects that carry ids only (never document content). Tenant jobs carry
// `orgId` and run inside withTenant in the worker. Pure: no pg-boss, no I/O, no wall clock.
import { z } from 'zod';

/** Every concrete job name of 03 §3.1 (events are not jobs and are not listed). */
export const JOB_NAMES = [
  // Pipeline stage jobs (M01, M02, M03, M04)
  'doc.split',
  'doc.classify',
  'doc.link_supporting',
  'doc.extract',
  'extract.llm',
  'extract.llm_escalated',
  'extract.learn_hints',
  'doc.validate',
  'validate.registry_retry',
  'validate.scope',
  'validate.catalog_upgrade',
  'doc.categorize',
  // Ingestion jobs (M01)
  'ingest.item.process',
  'ingest.expand',
  'ingest.bundle.assemble',
  'ingest.rescan',
  'ingest.cleanup',
  'email.received',
  'email.render_body',
  'expected.sweep',
  'import.spreadsheet.parse',
  'import.spreadsheet.run',
  // Ledger jobs (M04)
  'ledger.rebuild_document',
  'ledger.rebuild_transaction',
  'ledger.rebuild_org',
  'ledger.verify',
  // Other module jobs (M05, M06, M09)
  'vat.period.evaluate',
  'vat.filing.generate',
  'vat.workbook.generate',
  'vat.amendment.detect',
  'podklady.generate',
  'obligations.generate',
  'obligations.nightly',
  'notifications.evaluate',
  'notifications.digest',
  'notifications.urgent',
] as const;

/** Families that 03 §3.1 owns as `<family>.*` (M07, M10, M12); members are named by the module. */
export const JOB_FAMILIES = ['bank', 'package', 'retention', 'privacy', 'ops'] as const;

export type JobFamily = (typeof JOB_FAMILIES)[number];
export type JobName = (typeof JOB_NAMES)[number] | `${JobFamily}.${string}`;

const FAMILY_MEMBER_RE =
  /^(bank|package|retention|privacy|ops)\.[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;

/** True for a concrete 03 §3.1 name or a well-formed member of a 03 §3.1 family. */
export function isJobName(name: string): name is JobName {
  return (JOB_NAMES as readonly string[]).includes(name) || FAMILY_MEMBER_RE.test(name);
}

/** Crons run in Czech local time (03 ADR-003: rates, deadlines, bank polling). */
export const CRON_TIME_ZONE = 'Europe/Prague';

/** Retries with exponential backoff, then the dead-letter queue (03 ADR-003). */
export interface RetryPolicy {
  /** Retries after the first attempt; 4 means 5 attempts in total. */
  readonly retryLimit: number;
  /** First delay; doubles per retry when `retryBackoff` is true. */
  readonly retryDelaySeconds: number;
  readonly retryBackoff: boolean;
  /** Upper bound of one delay. */
  readonly retryDelayMaxSeconds: number;
}

export const DEFAULT_RETRY: RetryPolicy = {
  retryLimit: 4,
  retryDelaySeconds: 30,
  retryBackoff: true,
  retryDelayMaxSeconds: 3600,
};

/** Name of the dead-letter queue of a job. */
export function deadLetterName(name: JobName): string {
  return `${name}.dlq`;
}

/** The payload of every per-document pipeline stage job: ids only. */
export const documentStagePayload = z.strictObject({
  orgId: z.uuid(),
  documentId: z.uuid(),
});
export type DocumentStagePayload = z.infer<typeof documentStagePayload>;

/** A strict tenant payload: `orgId` plus the given id fields. Unknown keys are rejected. */
export function tenantPayload<S extends Record<string, z.ZodType>>(shape: S) {
  return z.strictObject({ orgId: z.uuid(), ...shape });
}

export interface IdempotencyParts {
  readonly orgId: string;
  /** The job name, e.g. `doc.split`. */
  readonly stage: string;
  readonly entityId: string;
  /** `stage_version` (03 §3): bump it to re-process after a prompt or rule upgrade. */
  readonly version: number;
}

const KEY_PART_RE = /^[^:\s]+$/;

/** `{org_id}:{stage}:{entity_id}:{version}` (03 ADR-003, 03 §3.1). */
export function idempotencyKey(parts: IdempotencyParts): string {
  const { orgId, stage, entityId, version } = parts;
  if (!z.uuid().safeParse(orgId).success) {
    throw new TypeError('idempotencyKey: orgId must be a UUID');
  }
  if (!KEY_PART_RE.test(stage) || !KEY_PART_RE.test(entityId)) {
    throw new TypeError('idempotencyKey: stage and entityId must be non-empty, without ":"');
  }
  if (!Number.isInteger(version) || version < 1) {
    throw new TypeError('idempotencyKey: version must be an integer >= 1');
  }
  return `${orgId}:${stage}:${entityId}:${version}`;
}

/** A job that touches one org's data: runs inside withTenant(payload.orgId). */
export interface TenantJobDefinition<P extends { orgId: string }> {
  readonly scope: 'tenant';
  readonly name: JobName;
  readonly payload: z.ZodType<P>;
  /** `stage_version`, the `{version}` of the idempotency key. */
  readonly version: number;
  /** The `{entity_id}` of the idempotency key. */
  readonly entityId: (payload: P) => string;
  readonly retry: RetryPolicy;
}

/** A job without a tenant (crons, maintenance). It iterates orgs itself through withTenant. */
export interface SystemJobDefinition<P extends object> {
  readonly scope: 'system';
  readonly name: JobName;
  readonly payload: z.ZodType<P>;
  /** Cron expression evaluated in CRON_TIME_ZONE; absent for jobs that are only enqueued. */
  readonly cron: string | null;
  readonly retry: RetryPolicy;
}

export type JobDefinition =
  // biome-ignore lint/suspicious/noExplicitAny: a heterogeneous list of definitions
  TenantJobDefinition<any> | SystemJobDefinition<any>;

function checkName(name: string): asserts name is JobName {
  if (!isJobName(name)) {
    throw new TypeError(`defineJob: "${name}" is not a job name of 03 §3.1`);
  }
}

export function defineTenantJob<P extends { orgId: string }>(def: {
  name: JobName;
  payload: z.ZodType<P>;
  version: number;
  entityId: (payload: P) => string;
  retry?: Partial<RetryPolicy>;
}): TenantJobDefinition<P> {
  checkName(def.name);
  if (!Number.isInteger(def.version) || def.version < 1) {
    throw new TypeError('defineTenantJob: version must be an integer >= 1');
  }
  return {
    scope: 'tenant',
    name: def.name,
    payload: def.payload,
    version: def.version,
    entityId: def.entityId,
    retry: { ...DEFAULT_RETRY, ...def.retry },
  };
}

export function defineSystemJob<P extends object>(def: {
  name: JobName;
  payload: z.ZodType<P>;
  cron?: string;
  retry?: Partial<RetryPolicy>;
}): SystemJobDefinition<P> {
  checkName(def.name);
  return {
    scope: 'system',
    name: def.name,
    payload: def.payload,
    cron: def.cron ?? null,
    retry: { ...DEFAULT_RETRY, ...def.retry },
  };
}

/** The idempotency key of one enqueue of a tenant job. */
export function jobKey<P extends { orgId: string }>(
  def: TenantJobDefinition<P>,
  payload: P,
): string {
  return idempotencyKey({
    orgId: payload.orgId,
    stage: def.name,
    entityId: def.entityId(payload),
    version: def.version,
  });
}

/** Worker heartbeat: a cron every minute; /healthz reports its last tick (M12 §4.2). */
export const opsHeartbeatJob = defineSystemJob({
  name: 'ops.heartbeat',
  payload: z.strictObject({}),
  cron: '* * * * *',
  retry: { retryLimit: 0 },
});
```

Command: `pnpm --filter @shoebox/pipeline typecheck 2>&1 | tail -5` → no `error TS`. Commit.

### Step 3: edit `packages/pipeline/src/index.ts`

After the anchor line (§2) append one line:

```ts
export * from './jobs';
```

Command: `pnpm --filter @shoebox/pipeline typecheck 2>&1 | tail -5` → no errors. Commit.

### Step 4: create `packages/pipeline/test/jobs.test.ts`

Full file; do not edit it:

```ts
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  CRON_TIME_ZONE,
  DEFAULT_RETRY,
  deadLetterName,
  defineSystemJob,
  defineTenantJob,
  documentStagePayload,
  idempotencyKey,
  isJobName,
  JOB_NAMES,
  type JobName,
  jobKey,
  opsHeartbeatJob,
  tenantPayload,
} from '../src/jobs';

const ORG = 'aaaaaaaa-0000-4000-8000-000000000001';
const DOC = 'bbbbbbbb-0000-4000-8000-000000000002';

describe('job names (03 §3.1)', () => {
  it('lists the 36 concrete job names, unique and `<domain>.<action>`', () => {
    expect(JOB_NAMES).toHaveLength(36);
    expect(new Set(JOB_NAMES).size).toBe(JOB_NAMES.length);
    for (const name of JOB_NAMES) {
      expect(name).toMatch(/^[a-z]+(\.[a-z_]+)+$/);
    }
    expect(JOB_NAMES).toContain('doc.split');
    expect(JOB_NAMES).toContain('ingest.item.process');
    expect(JOB_NAMES).toContain('notifications.urgent');
  });

  it('accepts concrete names and members of the bank/package/retention/privacy/ops families', () => {
    expect(isJobName('doc.categorize')).toBe(true);
    expect(isJobName('retention.eml_purge')).toBe(true);
    expect(isJobName('privacy.export_org')).toBe(true);
    expect(isJobName('ops.heartbeat')).toBe(true);
  });

  it('rejects events, unknown domains and malformed names', () => {
    expect(isJobName('document.received')).toBe(false);
    expect(isJobName('doc.unknown')).toBe(false);
    expect(isJobName('ops')).toBe(false);
    expect(isJobName('ops.')).toBe(false);
    expect(isJobName('ops.Heartbeat')).toBe(false);
    expect(isJobName('foo.bar')).toBe(false);
  });
});

describe('payloads carry ids only', () => {
  it('documentStagePayload accepts { orgId, documentId }', () => {
    expect(documentStagePayload.parse({ orgId: ORG, documentId: DOC })).toEqual({
      orgId: ORG,
      documentId: DOC,
    });
  });

  it('rejects a non-id field, a non-UUID id and a missing orgId', () => {
    expect(
      documentStagePayload.safeParse({ orgId: ORG, documentId: DOC, ocrText: 'Faktura' }).success,
    ).toBe(false);
    expect(documentStagePayload.safeParse({ orgId: ORG, documentId: 'doc-1' }).success).toBe(false);
    expect(documentStagePayload.safeParse({ documentId: DOC }).success).toBe(false);
  });

  it('tenantPayload adds orgId and stays strict', () => {
    const schema = tenantPayload({ transactionId: z.uuid() });
    expect(schema.safeParse({ orgId: ORG, transactionId: DOC }).success).toBe(true);
    expect(schema.safeParse({ orgId: ORG, transactionId: DOC, amount: '1.00' }).success).toBe(
      false,
    );
  });
});

describe('idempotency key {org_id}:{stage}:{entity_id}:{version}', () => {
  it('formats the four parts', () => {
    expect(idempotencyKey({ orgId: ORG, stage: 'doc.split', entityId: DOC, version: 2 })).toBe(
      `${ORG}:doc.split:${DOC}:2`,
    );
  });

  it('rejects a non-UUID org, a ":" in a part and a version below 1', () => {
    expect(() =>
      idempotencyKey({ orgId: 'org', stage: 'doc.split', entityId: DOC, version: 1 }),
    ).toThrow(TypeError);
    expect(() =>
      idempotencyKey({ orgId: ORG, stage: 'doc:split', entityId: DOC, version: 1 }),
    ).toThrow(TypeError);
    expect(() =>
      idempotencyKey({ orgId: ORG, stage: 'doc.split', entityId: '', version: 1 }),
    ).toThrow(TypeError);
    expect(() =>
      idempotencyKey({ orgId: ORG, stage: 'doc.split', entityId: DOC, version: 0 }),
    ).toThrow(TypeError);
    expect(() =>
      idempotencyKey({ orgId: ORG, stage: 'doc.split', entityId: DOC, version: 1.5 }),
    ).toThrow(TypeError);
  });

  it('jobKey uses the definition name, entityId and version', () => {
    const split = defineTenantJob({
      name: 'doc.split',
      payload: documentStagePayload,
      version: 3,
      entityId: (p) => p.documentId,
    });
    expect(jobKey(split, { orgId: ORG, documentId: DOC })).toBe(`${ORG}:doc.split:${DOC}:3`);
  });
});

describe('job definitions', () => {
  it('a tenant job gets the default retry policy: 5 attempts with exponential backoff', () => {
    const split = defineTenantJob({
      name: 'doc.split',
      payload: documentStagePayload,
      version: 1,
      entityId: (p) => p.documentId,
    });
    expect(split.scope).toBe('tenant');
    expect(split.retry).toEqual(DEFAULT_RETRY);
    expect(DEFAULT_RETRY.retryLimit).toBe(4);
    expect(DEFAULT_RETRY.retryBackoff).toBe(true);
    expect(deadLetterName(split.name)).toBe('doc.split.dlq');
  });

  it('retry overrides merge over the default', () => {
    const job = defineSystemJob({
      name: 'ops.rate_limit_gc',
      payload: z.strictObject({}),
      cron: '0 3 * * *',
      retry: { retryLimit: 1 },
    });
    expect(job.retry).toEqual({ ...DEFAULT_RETRY, retryLimit: 1 });
    expect(job.cron).toBe('0 3 * * *');
  });

  it('rejects a name outside 03 §3.1 and a version below 1', () => {
    expect(() =>
      defineTenantJob({
        name: 'doc.ocr' as JobName,
        payload: documentStagePayload,
        version: 1,
        entityId: (p) => p.documentId,
      }),
    ).toThrow(/03 §3.1/);
    expect(() =>
      defineTenantJob({
        name: 'doc.split',
        payload: documentStagePayload,
        version: 0,
        entityId: (p) => p.documentId,
      }),
    ).toThrow(TypeError);
  });

  it('ops.heartbeat is a system cron every minute, crons run in Europe/Prague', () => {
    expect(opsHeartbeatJob.scope).toBe('system');
    expect(opsHeartbeatJob.name).toBe('ops.heartbeat');
    expect(opsHeartbeatJob.cron).toBe('* * * * *');
    expect(opsHeartbeatJob.retry.retryLimit).toBe(0);
    expect(CRON_TIME_ZONE).toBe('Europe/Prague');
  });
});
```

Command: `pnpm --filter @shoebox/pipeline test 2>&1 | tail -6` → `Test Files  2 passed (2)` and `Tests  14 passed (14)`. Commit. Then write the report (§9); the PR is opened after 0026c.

## 5. Do not touch

`apps/**`, `packages/db/**`, `packages/domain/**`, `packages/platform/**`, `vitest.workspace.ts`, `docs/v3/**`. Hard rules: 4 (ids only in payloads), 5 (no job name outside 03 §3.1), 7 (no dependency except `zod` 4.6.5), 8 (never push to `main`). Do not hand-edit `pnpm-lock.yaml`.

## 6. Commands

```
pnpm --filter @shoebox/pipeline test 2>&1 | tail -30        # Test Files 2 passed, Tests 14 passed
pnpm --filter @shoebox/pipeline typecheck 2>&1 | tail -30   # exit 0
pnpm exec biome ci packages/pipeline 2>&1 | tail -30        # No fixes applied, no errors
pnpm depcruise 2>&1 | tail -30                              # no dependency violations found
```

Test-map row `packages/pipeline`: `pnpm --filter @shoebox/pipeline test -- <file>`.

## 7. Acceptance

- [ ] `jobs.test.ts`: 13 passed (plus the smoke test).
- [ ] The test "lists the 36 concrete job names" passes; `grep -c "process.env\|Date.now\|from 'pg-boss'" packages/pipeline/src/jobs.ts` → `0`.
- [ ] `grep -n '"zod": "4.6.5"' packages/pipeline/package.json` → 1 line.
- [ ] typecheck exit 0; `biome ci packages/pipeline` clean; depcruise clean.

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

Write `docs/tasks/0026a-report.md` (600 tokens at most) and set `Status: review`. The report has:

1. The files changed (`git diff --stat origin/phase/0`).
2. Each command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations, and `[verify]` findings with their source.
5. Questions.
6. Owner steps left.

## Risk list (for the reviewer)

`packages/pipeline/src/jobs.ts`: `JOB_NAMES` against 03 §3.1 (36 names, no events), `FAMILY_MEMBER_RE` (only the five families), `idempotencyKey` (UUID org, no `:` in parts, integer version ≥ 1), `documentStagePayload` is `strictObject`.

## Owner steps

None for 0026a.
