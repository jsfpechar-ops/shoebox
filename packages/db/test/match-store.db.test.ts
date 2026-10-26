import { sql as dsql } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  insertPaymentLinks,
  loadDocumentLinks,
  loadDocumentPaidView,
  loadMatchContextRows,
  loadOpenDocuments,
  loadOwnAccounts,
  loadTransactionsForMatch,
  type SuggestionInsert,
  setDocumentPaidAt,
  setTransactionMatch,
  syncOpenSuggestions,
} from '../src/match-store';
import { runMigrations } from '../src/migrate';
import { closeDb, createTenantDb, type TenantDb } from '../src/tenant';

const DATABASE_URL = process.env.DATABASE_URL;
const ORG = 'eeeeeeee-0000-4000-8000-000000000117';
const ACC = 'eeeeeeee-0000-4000-8000-00000000a117';
const ACC2 = 'eeeeeeee-0000-4000-8000-00000000a217';
const PARTNER = 'eeeeeeee-0000-4000-8000-00000000b117';
const IMPORT = 'eeeeeeee-0000-4000-8000-00000000e117';
const DOC1 = 'eeeeeeee-0000-4000-8000-00000000d117';
const DOC2 = 'eeeeeeee-0000-4000-8000-00000000d217';
const DOC3 = 'eeeeeeee-0000-4000-8000-00000000d317';
const TX1 = 'eeeeeeee-0000-4000-8000-00000000c117';
const TX2 = 'eeeeeeee-0000-4000-8000-00000000c217';
const TX3 = 'eeeeeeee-0000-4000-8000-00000000c317';

function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error('expected a value');
  return value;
}

function workerUrlFrom(serviceUrl: string): string {
  const u = new URL(serviceUrl);
  u.username = 'app_worker';
  u.password = '';
  return u.toString();
}

describe.skipIf(DATABASE_URL === undefined)('match store', () => {
  const serviceUrl = DATABASE_URL ?? '';
  let sql: Sql;
  let db: TenantDb;

  beforeAll(async () => {
    sql = postgres(serviceUrl, { max: 1, onnotice: () => undefined });
    await runMigrations(serviceUrl);
    await sql`delete from organizations where id = ${ORG}`;
    await sql`insert into organizations (id, name, inbound_email_slug, inbound_email_secret)
      values (${ORG}, 'Match Org', 'match-org-0117', 'EF56GH78')`;
    await sql`insert into categories (code, direction, tax_effect, label_cs, label_en, explanation_cs, sort)
      values ('exp_bank_fees', 'in', 'deductible_expense', 'Bank fees', 'Bank fees', 'Bank fees.', 900)
      on conflict (code) do nothing`;
    await sql`insert into money_accounts (id, org_id, type, name, currency, account_number, bank_code, iban)
      values (${ACC}, ${ORG}, 'bank', 'Fio', 'CZK', '2400123455', '2010', 'CZ8720100000002400123455'),
             (${ACC2}, ${ORG}, 'bank', 'CS', 'CZK', '1003-1234567899', '0800', null)`;
    await sql`insert into partners (id, org_id, name) values (${PARTNER}, ${ORG}, 'Alfa Servis s.r.o.')`;
    await sql`insert into partner_bank_accounts (org_id, partner_id, account_number, bank_code, iban)
      values (${ORG}, ${PARTNER}, '2400123455', '2010', 'CZ8720100000002400123455')`;
    await sql`insert into statement_imports (id, org_id, money_account_id, channel, format, parser_version, state)
      values (${IMPORT}, ${ORG}, ${ACC}, 'statement_file', 'gpc', 1, 'parsed')`;
    await sql`insert into documents (id, org_id, status, class, direction, currency, total_gross, document_number, variable_symbol, issue_date, due_date, partner_id, pay_to_account, deleted_at)
      values (${DOC1}, ${ORG}, 'ready', 'received_invoice', 'in', 'CZK', 1210.00, 'FV2026001', '2026001', '2026-03-01', '2026-03-15', ${PARTNER}, null, null),
             (${DOC2}, ${ORG}, 'ready', 'issued_invoice', 'out', 'CZK', 500.00, '2026-7', '7', '2026-03-05', '2026-03-19', null, '{"account":"1003-1234567899","bank_code":"0800"}'::jsonb, null),
             (${DOC3}, ${ORG}, 'ready', 'received_invoice', 'in', 'CZK', 99.00, 'X', null, '2026-03-01', null, null, null, now())`;
    await sql`insert into transactions (id, org_id, money_account_id, source, statement_import_id, booked_on, amount, currency, counterparty_account, counterparty_bank_code, variable_symbol, message, match_state)
      values (${TX1}, ${ORG}, ${ACC}, 'statement_file', ${IMPORT}, '2026-03-10', -1210.00, 'CZK', '2400123455', '2010', '2026001', null, 'unmatched'),
             (${TX2}, ${ORG}, ${ACC}, 'statement_file', null, '2026-03-12', 500.00, 'CZK', null, null, '7', 'Faktura 2026-7', 'unmatched'),
             (${TX3}, ${ORG}, ${ACC}, 'statement_file', null, '2026-03-12', -59.00, 'CZK', null, null, null, 'Poplatek', 'ignored')`;
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

  it('loads unmatched transactions by ids, import and lookback', async () => {
    await db.withTenant(ORG, async (tx) => {
      const byIds = await loadTransactionsForMatch(tx, ORG, { ids: [TX1, TX2, TX3] });
      expect(byIds.map((r) => r.id)).toEqual([TX1, TX2]);
      expect(byIds[0]).toMatchObject({
        amount: '-1210.00',
        currency: 'CZK',
        booked_on: '2026-03-10',
        variable_symbol: '2026001',
        linked_account_amount: '0',
        match_state: 'unmatched',
      });
      expect(
        (await loadTransactionsForMatch(tx, ORG, { statementImportId: IMPORT })).map((r) => r.id),
      ).toEqual([TX1]);
      expect(
        (await loadTransactionsForMatch(tx, ORG, { lookbackDays: 30, today: '2026-03-20' })).map(
          (r) => r.id,
        ),
      ).toEqual([TX1, TX2]);
      expect(
        await loadTransactionsForMatch(tx, ORG, { lookbackDays: 3, today: '2026-03-20' }),
      ).toEqual([]);
    });
  });

  it('loads open documents with open amounts and partner accounts', async () => {
    await db.withTenant(ORG, async (tx) => {
      const all = await loadOpenDocuments(tx, ORG, { all: true });
      expect(all.map((d) => d.id)).toEqual([DOC1, DOC2]);
      const d1 = must(all[0]);
      expect(d1).toMatchObject({
        class: 'received_invoice',
        status: 'ready',
        direction: 'in',
        amount_due: '1210.00',
        open_amount: '1210.00',
        partner_id: PARTNER,
        partner_name: 'Alfa Servis s.r.o.',
        issue_date: '2026-03-01',
        due_date: '2026-03-15',
      });
      expect([...d1.partner_accounts].sort()).toEqual([
        '2400123455/2010',
        'CZ8720100000002400123455',
      ]);
      const d2 = must(all[1]);
      expect(d2.partner_accounts).toEqual([]);
      expect(d2.pay_to_account).toEqual({ account: '1003-1234567899', bank_code: '0800' });
      expect((await loadOpenDocuments(tx, ORG, { ids: [DOC2, DOC3] })).map((d) => d.id)).toEqual([
        DOC2,
      ]);
    });
  });

  it('loads the learning context and own accounts', async () => {
    await sql`insert into match_suggestions (org_id, transaction_id, kind, document_ids, amounts, score, features, state, matcher_version)
      values (${ORG}, ${TX2}, 'document', ${[DOC1]}::uuid[], ${['500.00']}::numeric[], 0.700, '[]'::jsonb, 'rejected', 1)`;
    await db.withTenant(ORG, async (tx) => {
      const c = await loadMatchContextRows(tx, ORG);
      expect(c.aliases).toEqual([]);
      expect(c.known_accounts.map((k) => k.value).sort()).toEqual([
        '2400123455/2010',
        'CZ8720100000002400123455',
      ]);
      expect(c.known_accounts.every((k) => k.partner_id === PARTNER)).toBe(true);
      expect(c.rejected).toEqual([{ transaction_id: TX2, document_id: DOC1 }]);
      expect(c.partners_with_vs_history).toEqual([]);
      const own = await loadOwnAccounts(tx, ORG);
      expect(own.map((o) => o.account_number).sort()).toEqual(['1003-1234567899', '2400123455']);
      expect(own.find((o) => o.id === ACC)).toMatchObject({
        type: 'bank',
        bank_code: '2010',
        iban: 'CZ8720100000002400123455',
        is_business: true,
      });
    });
  });

  it('writes links, suggestions, states and paid_at', async () => {
    await db.withTenant(ORG, async (tx) => {
      const ids = await insertPaymentLinks(tx, ORG, [
        {
          transactionId: TX1,
          documentId: DOC1,
          linkType: 'payment',
          amount: '1210.00',
          amountAccountCurrency: '1210.00',
          matchMethod: 'vs_amount',
          confidence: '0.989',
          matcherVersion: 1,
        },
      ]);
      expect(ids).toHaveLength(1);
      expect((await loadOpenDocuments(tx, ORG, { all: true })).map((d) => d.id)).toEqual([DOC2]);
      expect(
        (await loadTransactionsForMatch(tx, ORG, { ids: [TX1] }))[0]?.linked_account_amount,
      ).toBe('1210.00');
      const links = await loadDocumentLinks(tx, ORG, DOC1);
      expect(links).toHaveLength(1);
      expect(links[0]).toMatchObject({
        link_type: 'payment',
        amount: '1210.00',
        booked_on: '2026-03-10',
      });

      await setTransactionMatch(tx, ORG, TX1, { matchState: 'matched' });
      expect(await loadTransactionsForMatch(tx, ORG, { ids: [TX1] })).toEqual([]);
      await setTransactionMatch(tx, ORG, TX2, {
        matchState: 'no_document_needed',
        categoryCode: 'exp_bank_fees',
      });
      const [t2] = await tx.execute<{
        match_state: string;
        category_code: string | null;
        matched: boolean;
      }>(
        dsql`select match_state, category_code, matched_at is not null as matched from transactions where org_id = ${ORG} and id = ${TX2}`,
      );
      expect(t2).toEqual({
        match_state: 'no_document_needed',
        category_code: 'exp_bank_fees',
        matched: true,
      });
      await setTransactionMatch(tx, ORG, TX2, {
        matchState: 'unmatched',
        categoryCode: 'not_seeded_code',
      });
      const [t2b] = await tx.execute<{ match_state: string; category_code: string | null }>(
        dsql`select match_state, category_code from transactions where org_id = ${ORG} and id = ${TX2}`,
      );
      expect(t2b).toEqual({ match_state: 'unmatched', category_code: null });

      const s = (over: Partial<SuggestionInsert>): SuggestionInsert => ({
        transactionId: TX2,
        kind: 'document' as const,
        documentIds: [DOC2],
        amounts: ['500.00'],
        pairedTransactionId: null,
        categoryCode: null,
        score: '0.700',
        features: [{ code: 'amount_exact', contribution: 3 }],
        matcherVersion: 1,
        ...over,
      });
      expect(await syncOpenSuggestions(tx, ORG, TX2, [s({})])).toEqual({
        inserted: 1,
        superseded: 0,
      });
      expect(await syncOpenSuggestions(tx, ORG, TX2, [s({})])).toEqual({
        inserted: 0,
        superseded: 0,
      });
      expect(
        await syncOpenSuggestions(tx, ORG, TX2, [s({ documentIds: [DOC1], amounts: ['1210.00'] })]),
      ).toEqual({ inserted: 1, superseded: 1 });
      const states = await tx.execute<{ state: string; n: number }>(
        dsql`select state, count(*)::int as n from match_suggestions where org_id = ${ORG} and transaction_id = ${TX2} group by state order by state`,
      );
      expect([...states]).toEqual([
        { state: 'open', n: 1 },
        { state: 'rejected', n: 1 },
        { state: 'superseded', n: 1 },
      ]);

      expect(await setDocumentPaidAt(tx, ORG, DOC1, '2026-03-10')).toBe(true);
      expect(await setDocumentPaidAt(tx, ORG, DOC1, '2026-03-10')).toBe(false);
      expect(await loadDocumentPaidView(tx, ORG, DOC1)).toEqual({
        amount_due: '1210.00',
        currency: 'CZK',
        issue_date: '2026-03-01',
        is_paid_per_document: null,
        paid_at: '2026-03-10',
      });
      expect(await setDocumentPaidAt(tx, ORG, DOC1, null)).toBe(true);
      expect(
        await loadDocumentPaidView(tx, ORG, 'eeeeeeee-0000-4000-8000-000000000000'),
      ).toBeNull();
    });
  });
});
