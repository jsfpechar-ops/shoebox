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
export async function loadStatementSource(tx: TenantTx, sourceFileId: string): Promise<StatementSource | null> {
  const [row] = await tx.execute<{ id: string; storage_path: string; original_filename: string | null }>(
    sql`select id, storage_path, original_filename from source_files where id = ${sourceFileId}`,
  );
  if (!row) return null;
  return { id: row.id, storagePath: row.storage_path, originalFilename: row.original_filename };
}
/** Id of an earlier statement import of this file, or null. */
export async function findStatementImport(tx: TenantTx, orgId: string, sourceFileId: string): Promise<string | null> {
  const [row] = await tx.execute<{ id: string }>(
    sql`select id from statement_imports where org_id = ${orgId} and source_file_id = ${sourceFileId} limit 1`,
  );
  return row?.id ?? null;
}
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
): Promise<MoneyAccountRef> {
  const account = identity.account ?? null;
  const bankCode = identity.bankCode ?? null;
  const iban = identity.iban ?? null;
  const found =
    iban !== null
      ? await tx.execute<{ id: string; bank_code: string | null; currency: string }>(
          sql`select id, bank_code, currency from money_accounts
            where org_id = ${orgId} and iban = ${iban}
            order by created_at limit 1`,
        )
      : await tx.execute<{ id: string; bank_code: string | null; currency: string }>(
          sql`select id, bank_code, currency from money_accounts
            where org_id = ${orgId} and account_number = ${account}
              and (${bankCode}::text is null or bank_code is null or bank_code = ${bankCode}::text)
            order by created_at limit 1`,
        );
  const [match] = found;
  if (match) {
    await tx.execute(
      sql`update money_accounts set import_format = ${importFormat} where org_id = ${orgId} and id = ${match.id}`,
    );
    return { id: match.id, bankCode: match.bank_code, currency: match.currency, created: false };
  }
  const currency = identity.currency ?? 'CZK';
  const name = account !== null ? `${account}/${bankCode ?? ''}` : (iban ?? 'bank');
  const [created] = await tx.execute<{ id: string; bank_code: string | null; currency: string }>(
    sql`insert into money_accounts (org_id, type, name, currency, account_number, bank_code, iban, import_format)
      values (${orgId}, 'bank', ${name}, ${currency}, ${account}, ${bankCode}, ${iban}, ${importFormat})
      returning id, bank_code, currency`,
  );
  if (!created) throw new Error('money_accounts insert returned no row');
  return { id: created.id, bankCode: created.bank_code, currency: created.currency, created: true };
}
export async function insertStatementImport(tx: TenantTx, row: StatementImportInsert): Promise<string> {
  const [created] = await tx.execute<{ id: string }>(
    sql`insert into statement_imports (
        org_id, money_account_id, source_file_id, channel, format, parser_version, period_from, period_to,
        statement_number, opening_balance, closing_balance, balance_check, tx_total, state, errors
      ) values (
        ${row.orgId}, ${row.moneyAccountId}, ${row.sourceFileId}, 'statement_file', ${row.format}, ${row.parserVersion},
        ${row.periodFrom}, ${row.periodTo}, ${row.statementNumber}, ${row.openingBalance}, ${row.closingBalance},
        ${row.balanceCheck}, ${row.txTotal}, ${row.state}, ${JSON.stringify(row.errors)}::jsonb
      ) returning id`,
  );
  if (!created) throw new Error('statement_imports insert returned no row');
  return created.id;
}
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
): Promise<{ inserted: number; duplicates: number; orphanReversals: number }> {
  let inserted = 0;
  let duplicates = 0;
  let orphanReversals = 0;
  for (const row of rows) {
    const [newRow] = await tx.execute<{ id: string }>(
      sql`insert into transactions (
          org_id, money_account_id, source, statement_import_id, external_id, dedupe_hash, booked_on, value_date,
          amount, currency, amount_original, currency_original, counterparty_name, counterparty_account,
          counterparty_bank_code, counterparty_iban, variable_symbol, constant_symbol, specific_symbol, message,
          card_merchant, card_last4, raw
        ) values (
          ${orgId}, ${moneyAccountId}, 'statement_file', ${statementImportId}, ${row.externalId}, ${row.dedupeHash},
          ${row.bookedOn}, ${row.valueDate}, ${row.amount}, ${row.currency}, ${row.amountOriginal}, ${row.currencyOriginal},
          ${row.counterpartyName}, ${row.counterpartyAccount}, ${row.counterpartyBankCode}, ${row.counterpartyIban},
          ${row.vs}, ${row.ks}, ${row.ss}, ${row.message}, ${row.cardMerchant}, ${row.cardLast4},
          ${JSON.stringify(row.raw)}::jsonb
        ) on conflict do nothing returning id`,
    );
    if (!newRow) {
      duplicates++;
      continue;
    }
    inserted++;
    if (!row.isReversal) continue;
    const [original] = await tx.execute<{ id: string }>(
      sql`select id from transactions
        where org_id = ${orgId} and money_account_id = ${moneyAccountId}
          and amount = -(${row.amount}::numeric)
          and reversal_of_transaction_id is null
          and booked_on between (${row.bookedOn}::date - 31) and ${row.bookedOn}::date
          and id <> ${newRow.id}
          and (${row.vs}::text is null or variable_symbol = ${row.vs}::text)
        order by booked_on desc, id desc limit 1`,
    );
    if (!original) {
      orphanReversals++;
      continue;
    }
    await tx.execute(
      sql`update transactions set reversal_of_transaction_id = ${original.id}, match_state = 'ignored'
        where org_id = ${orgId} and id = ${newRow.id}`,
    );
    await tx.execute(
      sql`update transactions set match_state = 'ignored' where org_id = ${orgId} and id = ${original.id}`,
    );
  }
  await tx.execute(
    sql`update statement_imports set tx_new = ${inserted}, tx_duplicate = ${duplicates}
      where org_id = ${orgId} and id = ${statementImportId}`,
  );
  return { inserted, duplicates, orphanReversals };
}
