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
        row({
          externalId: 'gpc:2',
          amount: '100.00',
          vs: '55',
          bookedOn: '2026-09-20',
          isReversal: true,
        }),
      ]);
      const again2 = await insertStatementTransactions(tx, ORG, acc.id, importId, [
        row({ dedupeHash: 'b'.repeat(64), amount: '-89.00' }),
      ]);
      const txs = await tx.execute<{
        external_id: string | null;
        match_state: string;
        rev: boolean;
      }>(
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
