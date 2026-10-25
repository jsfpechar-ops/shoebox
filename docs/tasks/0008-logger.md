# 0008: Structured logger with allowlist serializer

Status: done
Ticket: P0-PLAT-01 | Depends on: none (P0-REPO-01 merged) | Base commit: head of phase/0 | Branch: task/0008-logger | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Add a `pino` JSON logger to `@shoebox/platform` whose serializer keeps only an allowlist of keys, so partner names, document text, IBANs and amounts can never reach a log line. Every line carries the mandatory fields, and every later app and worker logs through it.

## 2. Context

Spec, M12 §4.7 Observability (Logs), pasted:

> **Logs:** `pino` JSON to stdout → Cloud Logging (`europe-west3` bucket, 30 days). Mandatory fields: `ts, level, msg, service, env, release, requestId, traceId, orgId?, userId?, jobName?, jobId?, documentId?, stage?, durationMs?, errorCode?`. **Never logged:** file names, document text, extracted values, partner names, e-mail subjects/addresses, IBANs, amounts, prompts or LLM outputs. A unit test feeds a log call with a fake document object and asserts the serializer drops non-allowlisted keys (logger uses an allowlist, not a denylist).

M12 §6 Interfaces: `export const logger: Logger; // pino with allowlist serializer` from `packages/platform`.
M12 §9 AC-9: logging an object with `partnerName`, `text`, `iban` emits none of them.

Hard rule 4: no document content in logs. Hard rule 7: `pino` is approved in `docs/context/decisions.md` ("pino for structured logs, no document content"); no other dependency may be added.

Design (already decided, the code below implements it):

- `ts, level, msg` come from pino options; `service, env, release` from `base`; `requestId, traceId` and the optional ids from `withContext(logger, ctx)` (a child logger; its type makes `requestId` and `traceId` required).
- `pickAllowed` keeps only the 13 allowlisted keys and only primitive values (string, finite number, boolean, null); it runs on every log object, on the base bindings and on every `child()` binding (pino itself only formats root bindings, so `child` is wrapped).
- The `logMethod` hook closes pino's side doors: an `Error` becomes `{ errorCode }` (its message and stack are dropped) and printf-style arguments are never interpolated (`info('saved %s', x)` logs `saved %s`).
- `pino@10.4.0` (published 2026-10-02, ≥14 days old), exact version.

Current `packages/platform/src/index.ts` (from P0-REPO-01; must be found verbatim):

```ts
export const packageName = '@shoebox/platform' as const;
```

Parallel brief 0009 (signed webhooks) also works in `packages/platform`; it owns `src/webhooks/**` and `test/webhooks*.test.ts`. Do not touch those paths. If `src/index.ts` already contains an extra `export * from './webhooks/index';` line when you start, keep it and only add the logger line (that is the one allowed deviation from the anchor).

Working rules: write each file with one Write call, exactly as given. Do not re-read a file you just wrote. Do not explore the repo. Commit after each step as `0008 step k`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/platform/package.json` | edit (by `pnpm add`) | add `"dependencies": { "pino": "10.4.0" }` |
| `pnpm-lock.yaml` | edit (by `pnpm add`) | pino and its dependencies |
| `packages/platform/src/logger/allowlist.ts` | new | `LOG_FIELD_ALLOWLIST`, `pickAllowed` |
| `packages/platform/src/logger/logger.ts` | new | `createLogger`, `withContext`, types |
| `packages/platform/src/logger/index.ts` | new | barrel + process-wide `logger` |
| `packages/platform/src/index.ts` | edit | add `export * from './logger/index';` |
| `packages/platform/test/logger.test.ts` | new | the spec (10 tests) |

No other file may change.

## 4. Steps

### Step 1: branch

```bash
git fetch origin phase/0 && git checkout -b task/0008-logger origin/phase/0
```

Command: `git status --short | wc -l 2>&1 | tail -30`. Expected: `0`.

### Step 2: add pino

```bash
pnpm --filter @shoebox/platform add pino@10.4.0 --save-exact 2>&1 | tail -30
```

Command: `node -e "console.log(require('./packages/platform/package.json').dependencies.pino)" 2>&1 | tail -30`. Expected: `10.4.0`. Then `git diff --stat | tail -30` shows only `packages/platform/package.json` and `pnpm-lock.yaml`. If pnpm refuses (for example a minimum-release-age setting), STOP (§8).

### Step 3: `packages/platform/src/logger/allowlist.ts` (new)

```ts
/**
 * M12 §4.7: the only keys a log line may carry besides ts, level and msg.
 * Allowlist, not denylist: any other key (partnerName, text, iban, amount, fileName, err, ...) is dropped.
 */
export const LOG_FIELD_ALLOWLIST = [
  'service',
  'env',
  'release',
  'requestId',
  'traceId',
  'orgId',
  'userId',
  'jobName',
  'jobId',
  'documentId',
  'stage',
  'durationMs',
  'errorCode',
] as const;

export type LogField = (typeof LOG_FIELD_ALLOWLIST)[number];

export type LogValue = string | number | boolean | null;

const ALLOWED: ReadonlySet<string> = new Set(LOG_FIELD_ALLOWLIST);

function isLogValue(value: unknown): value is LogValue {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  return typeof value === 'number' && Number.isFinite(value);
}

/** Keeps only allowlisted keys whose value is a primitive; nested objects are dropped. */
export function pickAllowed(input: Record<string, unknown>): Partial<Record<LogField, LogValue>> {
  const out: Partial<Record<LogField, LogValue>> = {};
  for (const [key, value] of Object.entries(input)) {
    if (ALLOWED.has(key) && isLogValue(value)) {
      out[key as LogField] = value;
    }
  }
  return out;
}
```

Command: `pnpm --filter @shoebox/platform typecheck 2>&1 | tail -30`. Expected: no errors.

### Step 4: `packages/platform/src/logger/logger.ts` (new)

```ts
import {
  type Bindings,
  type ChildLoggerOptions,
  type DestinationStream,
  type LevelWithSilent,
  type LogFn,
  type Logger,
  pino,
} from 'pino';
import { pickAllowed } from './allowlist';

export type { Logger } from 'pino';

export interface LoggerOptions {
  service: string;
  env: string;
  release: string;
  level?: LevelWithSilent;
  /** Tests pass a collecting stream; production writes JSON to stdout. */
  destination?: DestinationStream;
}

/** Per-request or per-job context. requestId and traceId are mandatory (M12 §4.7). */
export interface LogContext {
  requestId: string;
  traceId: string;
  orgId?: string;
  userId?: string;
  jobName?: string;
  jobId?: string;
  documentId?: string;
  stage?: string;
}

function errorCodeOf(err: Error): string {
  const code: unknown = (err as Error & { code?: unknown }).code;
  return typeof code === 'string' ? code : err.name;
}

/**
 * Normalizes every log call so content cannot leak through pino's side doors:
 * an Error becomes `{ errorCode }` (its message and stack are dropped), and
 * printf-style arguments are never interpolated into msg.
 */
function safeArgs(args: unknown[]): Parameters<LogFn> {
  const [first, second] = args;
  if (first instanceof Error) {
    const msg = typeof second === 'string' ? second : first.name;
    return [{ errorCode: errorCodeOf(first) }, msg];
  }
  if (typeof first === 'string') return [first];
  if (typeof first === 'object' && first !== null) {
    return typeof second === 'string' ? [first, second] : [first];
  }
  return [''];
}

export function createLogger(options: LoggerOptions): Logger {
  const config = {
    level: options.level ?? 'info',
    base: pickAllowed({ service: options.service, env: options.env, release: options.release }),
    messageKey: 'msg',
    timestamp: () => `,"ts":"${new Date().toISOString()}"`,
    formatters: {
      level: (label: string) => ({ level: label }),
      bindings: (bindings: Record<string, unknown>) => pickAllowed(bindings),
      log: (object: Record<string, unknown>) => pickAllowed(object),
    },
    hooks: {
      logMethod(this: Logger, args: unknown[], method: LogFn) {
        method.apply(this, safeArgs(args));
      },
    },
  };
  const root = options.destination ? pino(config, options.destination) : pino(config);
  // pino applies formatters.bindings to the root only; children inherit this guarded child().
  const pinoChild = root.child;
  function guardedChild(this: unknown, bindings: Bindings, childOptions?: ChildLoggerOptions) {
    return Reflect.apply(pinoChild, this, [pickAllowed(bindings), childOptions]) as unknown;
  }
  root.child = guardedChild as Logger['child'];
  return root;
}

export function withContext(logger: Logger, context: LogContext): Logger {
  return logger.child(context);
}
```

Command: `pnpm --filter @shoebox/platform typecheck 2>&1 | tail -30`. Expected: no errors.

### Step 5: `packages/platform/src/logger/index.ts` (new)

```ts
import { createLogger } from './logger';

export { LOG_FIELD_ALLOWLIST, type LogField, type LogValue, pickAllowed } from './allowlist';
export {
  createLogger,
  type LogContext,
  type Logger,
  type LoggerOptions,
  withContext,
} from './logger';

/** Process-wide logger (M12 §6). Apps that know their request context use withContext(logger, ...). */
export const logger = createLogger({
  service: process.env.K_SERVICE ?? 'local',
  env: process.env.APP_ENV ?? 'local',
  release: process.env.RELEASE ?? 'dev',
});
```

`K_SERVICE` is set by Cloud Run; `APP_ENV` and `RELEASE` are wired by the deploy ticket (P0-CI). Do not add them to `.env.example` here.

Command: `pnpm --filter @shoebox/platform typecheck 2>&1 | tail -30`. Expected: no errors.

### Step 6: `packages/platform/src/index.ts` (edit)

Anchor (verbatim): `export const packageName = '@shoebox/platform' as const;`. Full new content:

```ts
export const packageName = '@shoebox/platform' as const;
export * from './logger/index';
```

(If a `export * from './webhooks/index';` line is already there from brief 0009, keep it as the last line.)

Command: `pnpm --filter @shoebox/platform test -- smoke 2>&1 | tail -30`. Expected: `1 passed`.

### Step 7: `packages/platform/test/logger.test.ts` (new)

This test file is the spec. Write it exactly; do not edit it. Steps 3–5 already make it pass; if it fails, fix only the `src/logger/` files (twice failing → STOP, §8).

```ts
import { describe, expect, it } from 'vitest';
import { createLogger, LOG_FIELD_ALLOWLIST, pickAllowed, withContext } from '../src/logger/index';

type Line = Record<string, unknown>;

function capture() {
  const raw: string[] = [];
  const destination = {
    write(chunk: string) {
      raw.push(chunk);
    },
  };
  const log = createLogger({ service: 'worker', env: 'test', release: 'abc123', destination });
  const lines = (): Line[] => raw.map((r) => JSON.parse(r) as Line);
  const text = (): string => raw.join('');
  return { log, lines, text };
}

const fakeDocument = {
  partnerName: 'Pekárna Novák s.r.o.',
  text: 'Faktura č. 2026001 za pečivo',
  iban: 'CZ6508000000192000145399',
  amount: '1210.00',
  fileName: 'faktura-novak.pdf',
  email: 'jan.novak@example.cz',
  documentId: 'doc-1',
  durationMs: 12,
};

describe('logger: mandatory fields', () => {
  it('every line has ts, level, msg, service, env, release', () => {
    const { log, lines } = capture();
    log.info('started');
    const line = lines()[0];
    expect(line).toBeDefined();
    expect(typeof line?.ts).toBe('string');
    expect(Number.isNaN(Date.parse(String(line?.ts)))).toBe(false);
    expect(line).toMatchObject({
      level: 'info',
      msg: 'started',
      service: 'worker',
      env: 'test',
      release: 'abc123',
    });
  });

  it('withContext adds requestId, traceId and the optional ids', () => {
    const { log, lines } = capture();
    withContext(log, {
      requestId: 'req-1',
      traceId: 'trace-1',
      orgId: 'org-1',
      stage: 'extract',
    }).info('stage done');
    expect(lines()[0]).toMatchObject({
      requestId: 'req-1',
      traceId: 'trace-1',
      orgId: 'org-1',
      stage: 'extract',
      service: 'worker',
    });
  });
});

describe('logger: allowlist serializer (M12 AC-9)', () => {
  it('drops partnerName, text, iban and amount, keeps allowlisted keys', () => {
    const { log, lines, text } = capture();
    log.info(fakeDocument, 'extracted');
    const line = lines()[0];
    for (const key of ['partnerName', 'text', 'iban', 'amount', 'fileName', 'email']) {
      expect(line).not.toHaveProperty(key);
    }
    expect(line).toMatchObject({ documentId: 'doc-1', durationMs: 12, msg: 'extracted' });
    for (const secret of ['Novák', 'Faktura', 'CZ65', '1210', 'faktura-novak', 'example.cz']) {
      expect(text()).not.toContain(secret);
    }
  });

  it('drops non-allowlisted keys in child bindings too', () => {
    const { log, lines, text } = capture();
    log.child({ partnerName: 'Pekárna Novák s.r.o.', jobId: 'job-7' }).info('child');
    log.child({ jobId: 'job-8' }).child({ text: 'Faktura č. 1', stage: 'ocr' }).info('grandchild');
    expect(lines()[1]).toMatchObject({ jobId: 'job-8', stage: 'ocr' });
    expect(text()).not.toContain('Faktura');
    expect(lines()[0]).toMatchObject({ jobId: 'job-7' });
    expect(text()).not.toContain('Novák');
  });

  it('drops nested objects even under an allowlisted key', () => {
    const { log, lines } = capture();
    log.info({ orgId: { name: 'Pekárna Novák s.r.o.' } }, 'nested');
    expect(lines()[0]).not.toHaveProperty('orgId');
  });

  it('ignores a msg key inside the object', () => {
    const { log, text } = capture();
    log.info({ msg: 'Pekárna Novák s.r.o.' });
    expect(text()).not.toContain('Novák');
  });

  it('never interpolates printf-style arguments', () => {
    const { log, lines, text } = capture();
    log.info('saved %s', 'Pekárna Novák s.r.o.');
    expect(lines()[0]?.msg).toBe('saved %s');
    expect(text()).not.toContain('Novák');
  });

  it('logs an Error as errorCode only, without message or stack', () => {
    const { log, lines, text } = capture();
    log.error(new Error('IBAN CZ6508000000192000145399 invalid'));
    log.error(
      Object.assign(new Error('Pekárna Novák s.r.o.'), { code: 'E_PARSE' }),
      'parse failed',
    );
    log.error({ err: new Error('Pekárna Novák s.r.o.'), jobId: 'job-7' }, 'job failed');
    const [plain, coded, nested] = lines();
    expect(plain).toMatchObject({ level: 'error', errorCode: 'Error', msg: 'Error' });
    expect(coded).toMatchObject({ errorCode: 'E_PARSE', msg: 'parse failed' });
    expect(nested).toMatchObject({ jobId: 'job-7', msg: 'job failed' });
    expect(nested).not.toHaveProperty('err');
    for (const secret of ['CZ65', 'Novák', 'stack']) {
      expect(text()).not.toContain(secret);
    }
  });
});

describe('pickAllowed', () => {
  it('keeps exactly the M12 §4.7 field list', () => {
    expect([...LOG_FIELD_ALLOWLIST]).toEqual([
      'service',
      'env',
      'release',
      'requestId',
      'traceId',
      'orgId',
      'userId',
      'jobName',
      'jobId',
      'documentId',
      'stage',
      'durationMs',
      'errorCode',
    ]);
  });

  it('keeps primitives under allowlisted keys and drops everything else', () => {
    expect(
      pickAllowed({
        jobId: 'j',
        durationMs: 5,
        stage: null,
        amount: 1,
        orgId: ['x'],
        userId: Number.NaN,
      }),
    ).toEqual({ jobId: 'j', durationMs: 5, stage: null });
  });
});
```

Command: `pnpm --filter @shoebox/platform test -- logger 2>&1 | tail -30`. Expected: `Tests  10 passed (10)`.

### Step 8: lint and typecheck

Command: `pnpm --filter @shoebox/platform typecheck 2>&1 | tail -30` then `pnpm lint 2>&1 | tail -30`. Expected: no errors. If Biome reports only formatting in your files, run `pnpm exec biome check --write packages/platform/src/logger packages/platform/test/logger.test.ts 2>&1 | tail -30` once and rerun; anything else → STOP.

### Step 9: report and push

Write `docs/tasks/0008-report.md` (§9), set `Status: review` in this brief, commit `0008 step 9`, then `git push -u origin task/0008-logger 2>&1 | tail -30`.

## 5. Do not touch

- `packages/platform/src/webhooks/**`, `packages/platform/test/webhooks*.test.ts` (brief 0009), every other package and app, every root file except `pnpm-lock.yaml`.
- Hard rule 4: no real names, IBANs or document content in tests beyond the fake values given. Hard rule 7: no dependency other than `pino@10.4.0`. Hard rule 8: never push to `main`.

## 6. Commands

```bash
pnpm --filter @shoebox/platform test -- logger 2>&1 | tail -30      # Tests  10 passed (10)
pnpm --filter @shoebox/platform test -- smoke 2>&1 | tail -30       # 1 passed
pnpm --filter @shoebox/platform typecheck 2>&1 | tail -30           # no errors
pnpm lint 2>&1 | tail -30                                           # no errors
```

## 7. Acceptance

- [ ] `packages/platform/test/logger.test.ts`: logging an object with `partnerName`, `text`, `iban`, `amount` emits none of them; mandatory fields present (`ts, level, msg, service, env, release`; `requestId, traceId` via `withContext`). Command: `pnpm --filter @shoebox/platform test -- logger 2>&1 | tail -30` → 10 passed.
- [ ] `@shoebox/platform` exports `logger`, `createLogger`, `withContext`, `pickAllowed`, `LOG_FIELD_ALLOWLIST` (visible fact: `src/index.ts`).
- [ ] Deviation from the ticket's file list, by design: the code lives in `src/logger/` (folder) instead of `src/logger.ts`, so 0009 and later PLAT tickets can share `src/index.ts`.
- [ ] Not in this ticket: Sentry `beforeSend` half of M12 AC-9 (P0-PLAT-02); setting `APP_ENV`/`RELEASE` in Cloud Run (CI/deploy ticket).

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found;
- a test fails twice, or a test the brief wrote seems wrong;
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a new dependency seems needed, or `pnpm add pino@10.4.0` is refused;
- a file outside §3 needs a change;
- §5 would be touched;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy (hand that to the owner with the exact command).

## 9. Report

Write `docs/tasks/0008-report.md` (600 tokens at most) and set `Status: review`. The report has:

1. The files changed (`git diff --stat origin/phase/0 | tail -30`).
2. Each command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations, and `[verify]` findings with their source.
5. Questions.
6. Owner steps left.

## Risk list (for the reviewer)

- `packages/platform/src/logger/logger.ts`: the `logMethod` hook and the wrapped `child()` are the only things between document content and Cloud Logging; check that no pino path (error objects, `msg` inside the object, format args, child bindings) bypasses `pickAllowed`.
- `packages/platform/src/logger/allowlist.ts`: the list must equal M12 §4.7 exactly; adding a key is a spec change.
- `pnpm-lock.yaml`: only pino 10.4.0 and its transitive dependencies are new.

## Owner steps

None for this brief. (Later, the deploy ticket sets `APP_ENV` and `RELEASE` on the Cloud Run services.)
