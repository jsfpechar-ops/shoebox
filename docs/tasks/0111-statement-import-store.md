# 0111: Statement import job definition, dedupe hash and database store

Status: done
Ticket: P2-BANK-04 (store half) | Depends on: 0109, 0110 | Base commit: see branch | Branch: claude/project-thread-236iho | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Give the worker everything it needs to save a parsed bank statement: the `bank.import.statement` job, a dedupe hash so importing an overlapping statement twice never doubles a payment, and database helpers that find or create the bank account, record the import and insert transactions once. The worker handler that ties them together is brief 0112.

## 2. Context

M07 §6.2: `'bank.import.statement': { orgId, sourceFileId }` (the optional fields come later). Idempotency per source file.

M07 §4.5 dedupe, in order: (1) `(org_id, money_account_id, external_id)` unique: a hit is skipped (`tx_duplicate++`); (2) `dedupe_hash = sha256(A.id | booked_on | amount | norm(counterparty_account) | vs | ks | ss | lower(ascii(message)).slice(0,40) | seq)` where `seq` is the 0-based occurrence index of the identical tuple within the same file and day (two identical coffees on one day both survive); a hit is skipped. Reversals: for `is_reversal`, find the original on the account with the opposite amount, `booked_on` within 31 days before, same VS when the reversal has one; found → set `reversal_of_transaction_id` and `match_state = 'ignored'` on both; not found → warning `bank.reversal_orphan`. (Cross-channel merge with e-mail notices comes with notices, later.)

M07 §4.1 (default decision for fewest buttons, logged by the orchestrator): an unknown account in a statement is created automatically (`type 'bank'`), not asked about.

Tables (migration 0020, 05 §6), columns used here:
- `money_accounts (id, org_id, type, name, currency, account_number, bank_code, iban, import_format, ...)`
- `statement_imports (id, org_id, money_account_id, source_file_id, channel, format, parser_version, period_from, period_to, statement_number, opening_balance, closing_balance, balance_check, tx_total, tx_new, tx_merged, tx_duplicate, tx_failed, state, errors, ...)`; `channel` = `'statement_file'`; `balance_check` in `ok|mismatch|not_available`; `state` in `parsed|partially_parsed|failed|duplicate_file|needs_mapping|needs_account`.
- `transactions (id, org_id, money_account_id, source, statement_import_id, external_id, dedupe_hash, booked_on, value_date, amount, currency, amount_original, currency_original, counterparty_name, counterparty_account, counterparty_bank_code, counterparty_iban, variable_symbol, constant_symbol, specific_symbol, message, card_merchant, card_last4, match_state, reversal_of_transaction_id, raw, ...)`, `unique (org_id, money_account_id, external_id)` and the partial unique index `transactions_dedupe_hash (org_id, money_account_id, dedupe_hash) where dedupe_hash is not null`.
- `source_files (id, org_id, storage_path, original_filename, ...)`.

Query style to copy (`packages/db/src/inbound-email.ts`): `import { sql } from 'drizzle-orm';`, `import type { TenantTx } from './tenant';`, and `const [row] = await tx.execute<{ id: string }>(sql\`... ${value} ...\`);`. Every query names `org_id` explicitly.

`packages/pipeline/src/jobs.ts` excerpts:
```ts
  'notifications.urgent',
] as const;
```
```ts
/** M01 §4.1.2: turn one stored inbound e-mail into documents. Enqueued by the inbound-email webhook. */
export const emailReceivedJob = defineTenantJob({
  name: 'email.received',
  payload: tenantPayload({ inboundEmailId: z.uuid() }),
  version: 1,
  entityId: (payload) => payload.inboundEmailId,
});
```
`packages/pipeline/test/jobs.test.ts` line: `    expect(JOB_NAMES).toHaveLength(36);`

`packages/bank` exports `CanonicalTx` (types.ts). `packages/db/src/index.ts` has the line `export * from './inbound-email';`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/pipeline/src/jobs.ts` | edit | job name + definition |
| `packages/pipeline/test/jobs.test.ts` | edit | 36 → 37 |
| `packages/bank/src/dedupe.ts` | new | `dedupeSeqs`, `computeDedupeHash` |
| `packages/bank/test/dedupe.test.ts` | new | verbatim below |
| `packages/bank/src/index.ts` | edit | `export * from './dedupe';` |
| `packages/db/src/statement-import.ts` | new | store helpers |
| `packages/db/src/index.ts` | edit | `export * from './statement-import';` |
| `packages/db/test/statement-import.db.test.ts` | new | verbatim below |

No other file may change.

## 4. Steps

1. `jobs.ts`: replace `  'notifications.urgent',\n] as const;` with
```ts
  'notifications.urgent',
  // Bank jobs (M07)
  'bank.import.statement',
] as const;
```
and below the `emailReceivedJob` definition add
```ts

/** M07 §6.2: import one uploaded bank statement file. Enqueued by the statement upload action. */
export const bankImportStatementJob = defineTenantJob({
  name: 'bank.import.statement',
  payload: tenantPayload({ sourceFileId: z.uuid() }),
  version: 1,
  entityId: (payload) => payload.sourceFileId,
});
```
In `jobs.test.ts` change `toHaveLength(36)` to `toHaveLength(37)`. Run `pnpm --filter @shoebox/pipeline test -- jobs 2>&1 | tail -10` → pass. Commit `0111 step 1`.

2. New `packages/bank/src/dedupe.ts`:
```ts
import { createHash } from 'node:crypto';
import type { CanonicalTx } from './types';

/** The M07 §4.5 tuple of a transaction without seq: booked_on|amount|account|vs|ks|ss|message40. */
export function dedupeTuple(t: CanonicalTx): string;
/** For each tx, how many earlier txs in the same file have the same tuple (0-based). */
export function dedupeSeqs(txs: readonly CanonicalTx[]): number[];
/** sha256 hex of `accountId|<tuple>|seq`. */
export function computeDedupeHash(accountId: string, t: CanonicalTx, seq: number): string;
```
Tuple parts joined by `|`: `bookedOn`; `amount.toFixed2()`; counterparty `account ?? iban ?? ''` + `/` + `bankCode ?? ''`; `vs ?? ''`; `ks ?? ''`; `ss ?? ''`; message folded = `(message ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().slice(0, 40)`. Then step 3's test; implement until it passes. Add `export * from './dedupe';` to `packages/bank/src/index.ts`. Commit `0111 step 2`.

3. New `packages/bank/test/dedupe.test.ts`, verbatim:
```ts
import { CZK, Money, parseLegalDate } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import { computeDedupeHash, dedupeSeqs, dedupeTuple } from '../src/dedupe';
import type { CanonicalTx } from '../src/types';

const tx = (over: Partial<CanonicalTx> = {}): CanonicalTx => ({
  bookedOn: parseLegalDate('2026-09-16'),
  amount: Money.parse('-89', CZK),
  counterparty: {},
  message: 'Káva Praha',
  raw: {},
  ...over,
});

describe('dedupe', () => {
  it('builds the tuple with folded message and fixed amount', () => {
    expect(dedupeTuple(tx({ vs: '12', counterparty: { account: '2400123455', bankCode: '2010' } }))).toBe(
      '2026-09-16|-89.00|2400123455/2010|12|||kava praha',
    );
  });

  it('counts identical transactions of the same day', () => {
    const other = tx({ bookedOn: parseLegalDate('2026-09-17') });
    expect(dedupeSeqs([tx(), tx(), other, tx()])).toEqual([0, 1, 0, 2]);
  });

  it('gives two identical coffees different hashes, and is stable', () => {
    const a = computeDedupeHash('acc-1', tx(), 0);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(computeDedupeHash('acc-1', tx(), 1)).not.toBe(a);
    expect(computeDedupeHash('acc-2', tx(), 0)).not.toBe(a);
    expect(computeDedupeHash('acc-1', tx(), 0)).toBe(a);
  });
});
```
Run `pnpm --filter @shoebox/bank test -- dedupe 2>&1 | tail -10` → pass.

4. New `packages/db/src/statement-import.ts` with exactly these exports:
```ts
import { sql } from 'drizzle-orm';
import type { TenantTx } from './tenant';

export interface StatementSource {
  readonly id: string;
  readonly storagePath: string;
  readonly originalFilename: string | null;
}
export interface AccountIdentity {
  readonly account?: string;
  readonly bankCode?: string;
  readonly iban?: string;
  readonly currency?: string;
}
export interface MoneyAccountRef {
  readonly id: string;
  readonly bankCode: string | null;
  readonly currency: string;
  readonly created: boolean;
}
export interface StatementImportInsert {
  readonly orgId: string;
  readonly moneyAccountId: string | null;
  readonly sourceFileId: string;
  readonly format: string;
  readonly parserVersion: number;
  readonly periodFrom: string | null;
  readonly periodTo: string | null;
  readonly statementNumber: string | null;
  readonly openingBalance: string | null;
  readonly closingBalance: string | null;
  readonly balanceCheck: 'ok' | 'mismatch' | 'not_available';
  readonly txTotal: number;
  readonly state: 'parsed' | 'partially_parsed' | 'failed' | 'needs_mapping' | 'needs_account';
  /** [{ line?, code }] only; never row text (privacy). */
  readonly errors: ReadonlyArray<{ line?: number; code: string }>;
}
export interface StatementTxInsert {
  readonly externalId: string | null;
  readonly dedupeHash: string | null;
  readonly bookedOn: string;
  readonly valueDate: string | null;
  readonly amount: string;
  readonly currency: string;
  readonly amountOriginal: string | null;
  readonly currencyOriginal: string | null;
  readonly counterpartyName: string | null;
  readonly counterpartyAccount: string | null;
  readonly counterpartyBankCode: string | null;
  readonly counterpartyIban: string | null;
  readonly vs: string | null;
  readonly ks: string | null;
  readonly ss: string | null;
  readonly message: string | null;
  readonly cardMerchant: string | null;
  readonly cardLast4: string | null;
  readonly isReversal: boolean;
  readonly raw: Record<string, unknown>;
}

/** The source file of an upload, or null. */
export async function loadStatementSource(tx: TenantTx, sourceFileId: string): Promise<StatementSource | null>;
/** Id of an earlier statement import of this file, or null. */
export async function findStatementImport(tx: TenantTx, orgId: string, sourceFileId: string): Promise<string | null>;
/**
 * The org's money account with this IBAN, else with this account number (bank codes equal, or
 * either one null); created (type 'bank', name '<account>/<bank>' or the IBAN) when none matches.
 * Sets import_format on it either way.
 */
export async function findOrCreateMoneyAccount(
  tx: TenantTx,
  orgId: string,
  identity: AccountIdentity,
  importFormat: string,
): Promise<MoneyAccountRef>;
export async function insertStatementImport(tx: TenantTx, row: StatementImportInsert): Promise<string>;
/**
 * Inserts each row with source 'statement_file' and `on conflict do nothing` (external id or
 * dedupe hash already there = duplicate), links reversals (M07 §4.5), then writes tx_new and
 * tx_duplicate on the import.
 */
export async function insertStatementTransactions(
  tx: TenantTx,
  orgId: string,
  moneyAccountId: string,
  statementImportId: string,
  rows: readonly StatementTxInsert[],
): Promise<{ inserted: number; duplicates: number; orphanReversals: number }>;
```
Rules: new account `currency` = `identity.currency ?? 'CZK'`; a match with an IBAN given compares `iban`; otherwise `account_number = identity.account` and `(bank_code = identity.bankCode or bank_code is null or identity.bankCode is null)`, oldest first. `insertStatementImport` uses `channel 'statement_file'` and `errors` as jsonb (`${JSON.stringify(row.errors)}::jsonb`). Reversal link for an inserted reversal row: the newest earlier row on the same account with `amount = -<amount>`, `reversal_of_transaction_id is null`, `booked_on between <booked_on> - 31 and <booked_on>`, `id <> <new id>`, and `variable_symbol = <vs>` when the reversal has a VS; set the reversal's `reversal_of_transaction_id` and `match_state = 'ignored'` on both. Commit `0111 step 4`.

5. Add `export * from './statement-import';` below `export * from './inbound-email';` in `packages/db/src/index.ts`. New `packages/db/test/statement-import.db.test.ts`, verbatim:
```ts
import { sql as dsql } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/migrate';
import {
  findOrCreateMoneyAccount,
  findStatementImport,
  insertStatementImport,
  insertStatementTransactions,
  loadStatementSource,
  type StatementTxInsert,
} from '../src/statement-import';
import { closeDb, createTenantDb, type TenantDb } from '../src/tenant';

const DATABASE_URL = process.env.DATABASE_URL;
const ORG = 'eeeeeeee-0000-4000-8000-000000000111';
const FILE = 'eeeeeeee-0000-4000-8000-0000000f0111';

function workerUrlFrom(serviceUrl: string): string {
  const u = new URL(serviceUrl);
  u.username = 'app_worker';
  u.password = '';
  return u.toString();
}

const row = (over: Partial<StatementTxInsert>): StatementTxInsert => ({
  externalId: null,
  dedupeHash: null,
  bookedOn: '2026-09-15',
  valueDate: null,
  amount: '-100.00',
  currency: 'CZK',
  amountOriginal: null,
  currencyOriginal: null,
  counterpartyName: null,
  counterpartyAccount: null,
  counterpartyBankCode: null,
  counterpartyIban: null,
  vs: null,
  ks: null,
  ss: null,
  message: null,
  cardMerchant: null,
  cardLast4: null,
  isReversal: false,
  raw: {},
  ...over,
});

describe.skipIf(DATABASE_URL === undefined)('statement import store', () => {
  const serviceUrl = DATABASE_URL ?? '';
  let sql: Sql;
  let db: TenantDb;

  beforeAll(async () => {
    sql = postgres(serviceUrl, { max: 1, onnotice: () => undefined });
    await runMigrations(serviceUrl);
    await sql`delete from organizations where id = ${ORG}`;
    await sql`insert into organizations (id, name) values (${ORG}, 'Bank Org')`;
    await sql`insert into source_files (id, org_id, sha256, storage_path, mime_type, byte_size, original_filename, channel)
      values (${FILE}, ${ORG}, ${'a'.repeat(64)}, ${`${ORG}/files/x.gpc`}, 'text/plain', 10, 'vypis.gpc', 'upload')`;
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

  it('imports once, dedupes, and links a reversal', async () => {
    const result = await db.withTenant(ORG, async (tx) => {
      expect(await loadStatementSource(tx, FILE)).toEqual({
        id: FILE,
        storagePath: `${ORG}/files/x.gpc`,
        originalFilename: 'vypis.gpc',
      });
      expect(await findStatementImport(tx, ORG, FILE)).toBeNull();

      const acc = await findOrCreateMoneyAccount(tx, ORG, { account: '2400123455' }, 'gpc');
      expect(acc.created).toBe(true);
      const again = await findOrCreateMoneyAccount(
        tx,
        ORG,
        { account: '2400123455', bankCode: '2010', iban: undefined },
        'gpc',
      );
      expect(again).toEqual({ ...acc, created: false });

      const importId = await insertStatementImport(tx, {
        orgId: ORG,
        moneyAccountId: acc.id,
        sourceFileId: FILE,
        format: 'gpc',
        parserVersion: 1,
        periodFrom: '2026-09-01',
        periodTo: '2026-09-30',
        statementNumber: '7',
        openingBalance: '0.00',
        closingBalance: '0.00',
        balanceCheck: 'ok',
        txTotal: 4,
        state: 'parsed',
        errors: [],
      });
      expect(await findStatementImport(tx, ORG, FILE)).toBe(importId);

      const counts = await insertStatementTransactions(tx, ORG, acc.id, importId, [
        row({ externalId: 'gpc:1', vs: '55' }),
        row({ externalId: 'gpc:1', vs: '55' }),
        row({ dedupeHash: 'b'.repeat(64), amount: '-89.00' }),
        row({ externalId: 'gpc:2', amount: '100.00', vs: '55', bookedOn: '2026-09-20', isReversal: true }),
      ]);
      const again2 = await insertStatementTransactions(tx, ORG, acc.id, importId, [
        row({ dedupeHash: 'b'.repeat(64), amount: '-89.00' }),
      ]);
      const txs = await tx.execute<{ external_id: string | null; match_state: string; rev: boolean }>(
        dsql`select external_id, match_state, reversal_of_transaction_id is not null as rev
          from transactions where org_id = ${ORG} order by booked_on, external_id nulls last`,
      );
      const [imp] = await tx.execute<{ tx_new: number; tx_duplicate: number }>(
        dsql`select tx_new, tx_duplicate from statement_imports where id = ${importId}`,
      );
      return { counts, again2, txs: [...txs], imp };
    });

    expect(result.counts).toEqual({ inserted: 3, duplicates: 1, orphanReversals: 0 });
    expect(result.again2).toEqual({ inserted: 0, duplicates: 1, orphanReversals: 0 });
    expect(result.txs).toEqual([
      { external_id: 'gpc:1', match_state: 'ignored', rev: false },
      { external_id: null, match_state: 'unmatched', rev: false },
      { external_id: 'gpc:2', match_state: 'ignored', rev: true },
    ]);
    expect(result.imp).toEqual({ tx_new: 0, tx_duplicate: 1 });
  });
});
```
Note the last expectation: the second `insertStatementTransactions` call overwrites the counts of the same import (`tx_new` = inserted, `tx_duplicate` = duplicates of the latest call). Run `pnpm --filter @shoebox/db exec vitest run test/statement-import.db.test.ts 2>&1 | tail -10` → skipped without DATABASE_URL (CI runs it). Commit `0111 step 5`.

## 5. Do not touch

Migrations, `rls-catalog.ts`, apps, every file not in §3. Hard rules: every query names `org_id`; money columns get decimal strings, never JS numbers; `errors` holds codes and line numbers only, never row text.

## 6. Commands

- `pnpm --filter @shoebox/pipeline test -- jobs 2>&1 | tail -30` → pass.
- `pnpm --filter @shoebox/bank test 2>&1 | tail -30` → pass.
- `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30` and `pnpm --filter @shoebox/bank typecheck 2>&1 | tail -30` and `pnpm --filter @shoebox/pipeline typecheck 2>&1 | tail -30` → no errors.
- `pnpm biome check packages/db packages/bank packages/pipeline 2>&1 | tail -30` → clean (`--write` once for formatting only).

## 7. Acceptance

- [ ] Test files match §4 (formatting aside); bank and pipeline tests pass; db test skipped locally, left to CI (say so).
- [ ] Typecheck and biome clean.

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found;
- a test fails twice, or a test the brief wrote seems wrong (say which assertion and why);
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a file outside §3 needs a change;
- a step is unclear.

## 9. Report

Write `docs/tasks/0111-report.md` (600 tokens at most) and set `Status: review`. The report has:

1. The files changed (`git diff --stat`).
2. Each command, with the last 5 lines of its output.
3. Anything you could not do, and why.
