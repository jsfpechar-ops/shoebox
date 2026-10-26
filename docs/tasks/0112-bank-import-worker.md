# 0112: Worker job that imports a bank statement

Status: todo
Ticket: P2-BANK-04 (worker half) | Depends on: 0111 | Base commit: see branch | Branch: claude/project-thread-236iho | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

When `bank.import.statement` runs, the worker opens the uploaded file, recognises its format, reads it, finds or creates the bank account, and saves the transactions once, so the user's bank payments appear without typing. Files it cannot read (PDF, unknown CSV, too large) are recorded with a clear state so the screen can tell the user what to do.

## 2. Context

From `@shoebox/bank` (0107–0111): `detectStatementFormat(bytes, filename?)` (throws `StatementTooLargeError` > 10 MB; returns `{ format, confidence, encoding }`, format `'gpc' | 'camt053' | 'mt940' | 'csv_generic' | 'unsupported_pdf' | ...`), `parseStatement(bytes, detection, { currency?, gpcProfile? })` (throws `StatementFormatNeededError` for formats without a parser), `dedupeSeqs(txs)`, `computeDedupeHash(accountId, tx, seq)`, types `ParsedStatement`, `CanonicalTx` (`amount: Money`, `amountOriginal?: Money`, `counterparty: { account?, bankCode?, iban?, name? }`, `vs?`, `ks?`, `ss?`, `message?`, `cardMerchant?`, `cardLast4?`, `isReversal?`, `externalId?`, `bookedOn`, `valueDate?`, `raw`).

From `@shoebox/db` (0111): `loadStatementSource(tx, sourceFileId)`, `findStatementImport(tx, orgId, sourceFileId)`, `findOrCreateMoneyAccount(tx, orgId, identity, importFormat)` → `{ id, bankCode, currency, created }`, `insertStatementImport(tx, row)` → id, `insertStatementTransactions(tx, orgId, accountId, importId, rows)` → `{ inserted, duplicates, orphanReversals }`, types `StatementImportInsert`, `StatementTxInsert`.

From `@shoebox/pipeline`: `bankImportStatementJob` (payload `{ orgId, sourceFileId }`).

M07 rules applied: a file over 10 MB → state `failed`, error `bank.import.too_large`. PDF → `failed`, error `bank.import.pdf`. CSV / unknown → `needs_mapping` (the CSV wizard comes later). No account in the file → `needs_account`. More than 5 % bad rows (warnings / (txs + warnings)) → `partially_parsed`, else `parsed`. GPC profile: `gpc_fio` when the money account's bank code is `2010`, else `gpc_generic` (parse once generic to learn the account, then again with `gpc_fio` if needed). Dedupe: a transaction with an `externalId` gets no dedupe hash; one without gets `computeDedupeHash(account.id, tx, seq)`. Money is written with `toFixed2()`, never as a JS number.

Pattern to copy: `apps/worker/src/email-received/register.ts` (reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, warns and returns false when missing, builds `createSupabaseBlobStore({ url, apiKey })`, calls `registry.registerTenant(job, handler)`). The handler type is `TenantHandler<P>` from `../registry`; `ctx.tx` is the tenant transaction. Test context used by `apps/worker/test/email-received.test.ts`:
```ts
const ctx = { tx: {} as TenantTx, jobId: 'j', attempt: 1, signal: new AbortController().signal };
```
`apps/worker/src/main.ts` excerpts:
```ts
import { registerEmailReceived } from './email-received/register';
```
```ts
    registerEmailReceived(registry, process.env, logger);
```
`apps/worker/package.json` `dependencies` starts with `"@shoebox/db": "workspace:*",` and has no `@shoebox/bank`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/worker/package.json` | edit | add `"@shoebox/bank": "workspace:*",` as the first dependency |
| `pnpm-lock.yaml` | edit | by `pnpm install` only |
| `apps/worker/src/bank-import/handler.ts` | new | the handler |
| `apps/worker/src/bank-import/register.ts` | new | registration |
| `apps/worker/src/main.ts` | edit | import + call |
| `apps/worker/test/bank-import.test.ts` | new | verbatim below |

No other file may change.

## 4. Steps

1. Add the dependency, run `pnpm install 2>&1 | tail -5`. Commit `0112 step 1`.

2. New `apps/worker/src/bank-import/handler.ts` with exactly these exports; implement until step 3's tests pass:
```ts
import type {
  findOrCreateMoneyAccount,
  findStatementImport,
  insertStatementImport,
  insertStatementTransactions,
  loadStatementSource,
} from '@shoebox/db';
import type { TenantHandler } from '../registry';

export interface BankImportDeps {
  readonly blobs: { get(path: string): Promise<Uint8Array> };
  readonly store: {
    loadSource: typeof loadStatementSource;
    findImport: typeof findStatementImport;
    findOrCreateAccount: typeof findOrCreateMoneyAccount;
    insertImport: typeof insertStatementImport;
    insertTransactions: typeof insertStatementTransactions;
  };
}

/** bank.import.statement: one uploaded statement file → statement_imports row + transactions. */
export function createBankImportHandler(
  deps: BankImportDeps,
): TenantHandler<{ orgId: string; sourceFileId: string }>;
```
Flow: source null → return. `findImport` not null → return (already imported; a re-upload of the same bytes is the same source file). Read bytes. Detect (catch `StatementTooLargeError` → failed import). Non-parser formats → their state (format column = the detected format, `parserVersion` 0, `moneyAccountId` null, counts 0). Parse; no `account.account` and no `account.iban` → `needs_account` with the parsed format and version. Find or create the account (`identity` = parsed account incl. currency; `importFormat` = format). GPC + bank code `2010` → re-parse with `gpc_fio`. Insert the import (balances `toFixed2()` or null; `balanceCheck` = parsed value or `'not_available'`; `errors` = warnings mapped to `{ line, code }` only; `txTotal` = txs length), then the transactions (map every `CanonicalTx` field to `StatementTxInsert`, nulls for missing), raw = `tx.raw`. A `StatementFormatNeededError` thrown by `parseStatement` → `needs_mapping`. Any other error propagates (pg-boss retries). Commit `0112 step 2`.

3. New `apps/worker/test/bank-import.test.ts`, verbatim; run `pnpm --filter @shoebox/worker test -- bank-import 2>&1 | tail -30` → pass. Commit `0112 step 3`.
```ts
import type { StatementImportInsert, StatementTxInsert, TenantTx } from '@shoebox/db';
import { describe, expect, it } from 'vitest';
import { type BankImportDeps, createBankImportHandler } from '../src/bank-import/handler';

const ORG = 'eeeeeeee-0000-4000-8000-000000000112';
const FILE = 'eeeeeeee-0000-4000-8000-0000000f0112';
const ctx = { tx: {} as TenantTx, jobId: 'j', attempt: 1, signal: new AbortController().signal };
const bytes = (text: string) => new TextEncoder().encode(text);

const STA = [
  ':20:STMT7',
  ':25:2400123455/2010',
  ':28C:7',
  ':60F:C260914CZK10000,00',
  ':61:2609150915C12100,00NTRF//12345678',
  ':86:/VS/2026001',
  ':61:2609160916D89,00NMSC',
  ':86:KAVA',
  ':62F:C260930CZK22011,00',
].join('\n');

function fake(file: Uint8Array | null, opts: { imported?: boolean; name?: string } = {}) {
  const imports: StatementImportInsert[] = [];
  const txs: StatementTxInsert[][] = [];
  const accounts: unknown[] = [];
  const deps: BankImportDeps = {
    blobs: { get: async () => file ?? new Uint8Array() },
    store: {
      loadSource: async () =>
        file === null ? null : { id: FILE, storagePath: `${ORG}/files/x`, originalFilename: opts.name ?? 'vypis.sta' },
      findImport: async () => (opts.imported ? 'imp-old' : null),
      findOrCreateAccount: async (_tx, _org, identity, format) => {
        accounts.push({ identity, format });
        return { id: 'acc-1', bankCode: '2010', currency: 'CZK', created: true };
      },
      insertImport: async (_tx, row) => {
        imports.push(row);
        return 'imp-1';
      },
      insertTransactions: async (_tx, _org, _acc, _imp, rows) => {
        txs.push([...rows]);
        return { inserted: rows.length, duplicates: 0, orphanReversals: 0 };
      },
    },
  };
  return { deps, imports, txs, accounts };
}

const run = (deps: BankImportDeps) => createBankImportHandler(deps)({ orgId: ORG, sourceFileId: FILE }, ctx);

describe('bank.import.statement', () => {
  it('imports an MT940 file: account, import row, transactions', async () => {
    const f = fake(bytes(STA));
    await run(f.deps);
    expect(f.accounts).toEqual([
      {
        identity: { account: '2400123455', bankCode: '2010', iban: 'CZ8720100000002400123455', currency: 'CZK' },
        format: 'mt940',
      },
    ]);
    expect(f.imports).toHaveLength(1);
    expect(f.imports[0]).toMatchObject({
      orgId: ORG,
      moneyAccountId: 'acc-1',
      sourceFileId: FILE,
      format: 'mt940',
      parserVersion: 1,
      periodFrom: '2026-09-14',
      periodTo: '2026-09-30',
      statementNumber: '7',
      openingBalance: '10000.00',
      closingBalance: '22011.00',
      balanceCheck: 'ok',
      txTotal: 2,
      state: 'parsed',
      errors: [],
    });
    const [inc, coffee] = f.txs[0] ?? [];
    expect(inc).toMatchObject({
      externalId: 'mt940:12345678',
      dedupeHash: null,
      amount: '12100.00',
      currency: 'CZK',
      vs: '2026001',
      bookedOn: '2026-09-15',
      isReversal: false,
    });
    expect(coffee?.externalId).toBeNull();
    expect(coffee?.dedupeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(coffee?.amount).toBe('-89.00');
    expect(coffee?.message).toBe('KAVA');
  });

  it('does nothing for a missing file or a file imported before', async () => {
    const gone = fake(null);
    await run(gone.deps);
    expect(gone.imports).toEqual([]);
    const again = fake(bytes(STA), { imported: true });
    await run(again.deps);
    expect(again.imports).toEqual([]);
  });

  it('records a PDF as failed and a CSV as needing a mapping', async () => {
    const pdf = fake(bytes('%PDF-1.7 ...'), { name: 'vypis.pdf' });
    await run(pdf.deps);
    expect(pdf.imports[0]).toMatchObject({
      format: 'unsupported_pdf',
      parserVersion: 0,
      moneyAccountId: null,
      state: 'failed',
      errors: [{ code: 'bank.import.pdf' }],
    });
    const csv = fake(bytes('date;amount\n2026-09-15;100\n'), { name: 'vypis.csv' });
    await run(csv.deps);
    expect(csv.imports[0]).toMatchObject({ format: 'csv_generic', state: 'needs_mapping', txTotal: 0 });
    expect(csv.txs).toEqual([]);
  });

  it('asks for the account when the file names none', async () => {
    const f = fake(bytes(':20:S\n:60F:C260914CZK0,00\n:61:260915C5,00NTRF//R1\n:62F:C260915CZK5,00\n'));
    await run(f.deps);
    expect(f.imports[0]).toMatchObject({ format: 'mt940', state: 'needs_account', moneyAccountId: null });
    expect(f.accounts).toEqual([]);
  });

  it('records a file over 10 MB as failed', async () => {
    const f = fake(new Uint8Array(10 * 1024 * 1024 + 1));
    await run(f.deps);
    expect(f.imports[0]).toMatchObject({ state: 'failed', errors: [{ code: 'bank.import.too_large' }] });
  });
});
```
For the failed / needs_mapping / needs_account rows use: `periodFrom`, `periodTo`, `statementNumber`, `openingBalance`, `closingBalance` null, `balanceCheck 'not_available'`, `txTotal 0`, and format `'unknown'` for the too-large case.

4. New `apps/worker/src/bank-import/register.ts`, `registerBankImport(registry, env, logger): boolean`, a copy of the e-mail one's shape: same env check (log message `'bank.import.statement not registered'` / `'bank.import.statement registered'`), `registry.registerTenant(bankImportStatementJob, createBankImportHandler({ blobs: createSupabaseBlobStore({ url, apiKey: serviceKey }), store: { loadSource: loadStatementSource, findImport: findStatementImport, findOrCreateAccount: findOrCreateMoneyAccount, insertImport: insertStatementImport, insertTransactions: insertStatementTransactions } }))`. Its `registry` parameter type is `Pick<JobRegistry, 'registerTenant'>`. In `main.ts` add the import below `import { registerEmailReceived } ...` and the call `    registerBankImport(registry, process.env, logger);` below `    registerEmailReceived(registry, process.env, logger);`. Run `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -10`. Commit `0112 step 4`.

## 5. Do not touch

`packages/` (all of it), other worker jobs, `apps/web`. Hard rules: money via `toFixed2()` strings only; no row text in `errors` or logs; no new external dependency.

## 6. Commands

- `pnpm --filter @shoebox/worker test -- bank-import 2>&1 | tail -30` → pass.
- `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30` → no errors.
- `pnpm biome check apps/worker 2>&1 | tail -30` → clean (`--write` once for formatting only).

## 7. Acceptance

- [ ] The test file matches §4 (formatting aside) and passes.
- [ ] `main.ts` registers the job; typecheck and biome clean.

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found;
- a test fails twice, or a test the brief wrote seems wrong (say which assertion and why);
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a file outside §3 needs a change;
- a step is unclear.

## 9. Report

Write `docs/tasks/0112-report.md` (600 tokens at most) and set `Status: review`. The report has:

1. The files changed (`git diff --stat`).
2. Each command, with the last 5 lines of its output.
3. Anything you could not do, and why.
