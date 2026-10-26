# 0117: Authority-account rule and the match store

Status: todo
Ticket: P2-MATCH-03 (`bank.authority_accounts`), P2-MATCH-04 (store) | Depends on: 0111 | Base commit: see branch | Branch: claude/project-thread-236iho | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens
<!-- Risk: HIGH (money, rules). No migration: the FKs of tax_ledger_entries (migration 0041, lane C) cannot be added from the 0020–0029 range because migrations run in journal order; lane C adds them in its own range. -->

## 1. Objective

Seed the `bank.authority_accounts` rule (which FÚ account prefix means which tax payment, M07 §4.7.4) and give the matcher worker its database helpers: load unmatched transactions and open documents with their open amounts, load the learning context, write links and suggestions, set match states and `paid_at`. Everything stays org-scoped and the user-visible behaviour (the Payments column) starts working in 0118.

## 2. Context

`packages/domain/src/rules/law.ts` already declares the key (module-owned, loose):
```ts
  // module-owned: M07 (authority account patterns per payee).
  'bank.authority_accounts': z.record(Identifier, ModuleOwnedRecord),
```
Each top-level key must be snake_case; each value an object. The value shape the bank package reads (`authorityRulesOf`, 0116): `{ fu: { bank_code, prefix_map: { [prefix]: category }, vat_refund_category }, cssz: { category, accounts: string[] }, insurers: { category, accounts }, municipalities: { category, accounts }, name_hints: { [folded pattern]: category } }`.

Facts (M07 §4.7.4, `research/czech-tax-filings.md`): VAT is paid to the FÚ account with prefix `705` and VS = DIČ; paušální daň goes to prefix `2866` [O]. The income-tax prefix (`721`), the ČSSZ/OSSZ and insurer account lists and municipal accounts are **[verify]** and stay unseeded (empty lists) until the owner fills them from the official pages; `name_hints` covers them as suggestions only.

`packages/domain/src/rules/cz/2026.ts`: `base(key, source, value)` helper (`valid_from` 2026-01-01, `valid_to` null, `verified_at` `VERIFIED_AT`); the array `RULES_CZ_2026` ends with the `cash.payment_limit` AMLR entry and `];`. `2025.ts` has the same `base` helper with `valid_to` 2025-12-31 and ends with the `deadlines.generators` entry and `];`. `packages/domain/test/rules-values.test.ts` holds `SEEDED_KEYS` (sorted) and the lines
```ts
    expect(RULES_CZ_2025).toHaveLength(18);
    expect(RULES_CZ_2026).toHaveLength(19);
```
```ts
    expect(RULES_CZ_2026.filter((entry) => entry.valid_from === '2026-01-01')).toHaveLength(18);
```
and a `PRIMARY_HOSTS` list that already allows `financnisprava.gov.cz`.

Tables (migration 0020 and 0004/0005; names per 05): `transactions(id, org_id, money_account_id, source, statement_import_id, booked_on, amount, currency, amount_original, currency_original, counterparty_name, counterparty_account, counterparty_bank_code, counterparty_iban, variable_symbol, message, card_merchant, category_code → categories(code), match_state in unmatched|partial|matched|ignored|no_document_needed, is_pending, paired_transaction_id, matched_at)`; `payment_links(id, org_id, transaction_id, document_id, link_type, amount, amount_account_currency, match_method, confidence, matcher_version, created_by 'system'|'user', confirmed_by, created_at)`; `match_suggestions(id, org_id, transaction_id, kind document|multi_document|transfer|category, document_ids uuid[], amounts numeric[], paired_transaction_id, category_code, score, features jsonb, state open|accepted|rejected|superseded, matcher_version)`; `counterparty_aliases(org_id, partner_id, kind, value_normalized, confirmations)`; `money_accounts(id, org_id, type, name, currency, account_number, bank_code, iban, is_business)`; `partner_bank_accounts(org_id, partner_id, account_number, bank_code, iban)`; `partners(id, org_id, name)`; `documents(id, org_id, status, class, direction, currency, total_gross, amount_due, document_number, variable_symbol, issue_date, due_date, service_period_to, payment_method, pay_to_account jsonb, is_paid_per_document, paid_at, partner_id, deleted_at, created_at)`; `categories(code, direction, tax_effect, label_cs, label_en, explanation_cs, sort)` is global and **not seeded yet** (P0-DB-11): category writes go through a subselect and become null for an unknown code (`TODO(P0-DB-11)`).

Query style (`packages/db/src/inbound-email.ts`): `import { sql } from 'drizzle-orm';`, `import type { TenantTx } from './tenant';`, `const rows = await tx.execute<{ id: string }>(sql\`select id from ... where org_id = ${orgId} ...\`);`. Every query names `org_id`. Cast dates and numerics to text in SQL (`booked_on::text`, `amount::text`); arrays are passed as JS arrays with a cast (`= any(${ids}::uuid[])`). `packages/db/src/index.ts` has the line `export * from './statement-import';`. Test pattern: `packages/db/test/statement-import.db.test.ts` (service `postgres` for seeding, `createTenantDb(...).withTenant(ORG, tx => ...)` for the store).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/src/rules/cz/2026.ts` | edit | seed entry |
| `packages/domain/src/rules/cz/2025.ts` | edit | seed entry |
| `packages/domain/test/rules-values.test.ts` | edit | key list and counts |
| `packages/domain/test/rules-authority-accounts.test.ts` | new | verbatim below |
| `packages/db/src/match-store.ts` | new | store helpers |
| `packages/db/src/index.ts` | edit | `export * from './match-store';` |
| `packages/db/test/match-store.db.test.ts` | new | verbatim below |

No other file may change.

## 4. Steps

1. In `packages/domain/src/rules/cz/2026.ts`, directly above the final `];` of `RULES_CZ_2026`, add:
```ts
  // M07 §4.7.4 (brief 0117): which payee account means which tax or insurance payment. Only the
  // two prefixes with an [O] source are seeded. TODO(verify): income-tax prefix 721, the ČSSZ/OSSZ,
  // insurer and municipal account lists (fill `accounts` from the official pages, A12).
  base('bank.authority_accounts', FU_ACCOUNTS, {
    fu: {
      bank_code: '0710',
      prefix_map: { '705': 'tax_vat_payment', '2866': 'tax_pausal_advance' },
      vat_refund_category: 'income_vat_refund',
    },
    cssz: { category: 'ins_social_own', accounts: [] },
    insurers: { category: 'ins_health_own', accounts: [] },
    municipalities: { category: 'pt_tourist_fee', accounts: [] },
    name_hints: {
      'FINANCNI URAD': 'tax_other_fees',
      CSSZ: 'ins_social_own', OSSZ: 'ins_social_own', PSSZ: 'ins_social_own', MSSZ: 'ins_social_own',
      'SPRAVA SOCIALNIHO ZABEZPECENI': 'ins_social_own',
      'ZDRAVOTNI POJISTOVNA': 'ins_health_own', VZP: 'ins_health_own', VOZP: 'ins_health_own', CPZP: 'ins_health_own',
      OZP: 'ins_health_own', ZPMV: 'ins_health_own', RBP: 'ins_health_own', 'ZP SKODA': 'ins_health_own',
    },
  }),
```
and below the line `const CSSZ_2026 = ...;` add:
```ts
/** Finanční správa: bank accounts of the tax offices (prefix = tax kind, bank code 0710). TODO(verify): URL not re-read on 2026-10-26. */
const FU_ACCOUNTS = 'https://financnisprava.gov.cz/cs/dane/placeni-dani/bankovni-ucty-financnich-uradu';
```
In `2025.ts` add the same `FU_ACCOUNTS` constant below the `CSSZ_2025` constant and the same `base('bank.authority_accounts', FU_ACCOUNTS, {...})` entry (identical value) directly above the final `];`. Run `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -10`. Commit `0117 step 1`.

2. In `packages/domain/test/rules-values.test.ts`: insert `  'bank.authority_accounts',` directly below `  'asset.capitalization_threshold',`; change `toHaveLength(18);` of `RULES_CZ_2025` to `19`, `toHaveLength(19);` of `RULES_CZ_2026` to `20`, and the `valid_from === '2026-01-01'` count `18` to `19`. New `packages/domain/test/rules-authority-accounts.test.ts`, verbatim:
```ts
import { describe, expect, it } from 'vitest';
import { createCzRules } from '../src/rules/cz/index';

const rules = createCzRules();

describe('bank.authority_accounts (M07 §4.7.4, A12)', () => {
  it.each(['2025-06-01', '2026-06-01'])('resolves on %s with FÚ prefixes 705 and 2866', (date) => {
    const value = rules.at(date).get('bank.authority_accounts') as Record<string, Record<string, unknown>>;
    expect(value.fu).toMatchObject({ bank_code: '0710', vat_refund_category: 'income_vat_refund' });
    const prefixMap = value.fu!.prefix_map as Record<string, string>;
    expect(prefixMap['705']).toBe('tax_vat_payment');
    expect(prefixMap['2866']).toBe('tax_pausal_advance');
    expect(Object.keys(prefixMap).sort()).toEqual(['2866', '705']);
  });
  it('keeps unverified lists empty and names the categories', () => {
    const value = rules.at('2026-06-01').get('bank.authority_accounts') as Record<string, Record<string, unknown>>;
    for (const group of ['cssz', 'insurers', 'municipalities']) {
      expect(value[group]!.accounts).toEqual([]);
      expect(typeof value[group]!.category).toBe('string');
    }
    const hints = value.name_hints as Record<string, string>;
    expect(hints['FINANCNI URAD']).toBe('tax_other_fees');
    expect(hints.OSSZ).toBe('ins_social_own');
    expect(hints['ZDRAVOTNI POJISTOVNA']).toBe('ins_health_own');
    expect(Object.keys(hints).every((k) => k === k.toUpperCase() && !/[^A-Z ]/.test(k))).toBe(true);
  });
  it('is sourced and dated', () => {
    const entry = rules.at('2026-06-01').resolve('bank.authority_accounts');
    expect(entry.source.startsWith('https://financnisprava.gov.cz/')).toBe(true);
    expect(entry.verified_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
```
Run `pnpm --filter @shoebox/domain test -- rules 2>&1 | tail -30` → pass. Commit `0117 step 2`.

3. New `packages/db/src/match-store.ts` with exactly these exports:
```ts
import { sql } from 'drizzle-orm';
import type { TenantTx } from './tenant';

export interface MatchTxRow {
  readonly id: string; readonly money_account_id: string; readonly booked_on: string; readonly amount: string;
  readonly currency: string; readonly amount_original: string | null; readonly currency_original: string | null;
  readonly counterparty_name: string | null; readonly counterparty_account: string | null;
  readonly counterparty_bank_code: string | null; readonly counterparty_iban: string | null;
  readonly variable_symbol: string | null; readonly message: string | null; readonly card_merchant: string | null;
  readonly match_state: string;
  /** Σ amount_account_currency of links payment/refund/fee/platform_payout (I1), '0' when none. */
  readonly linked_account_amount: string;
}
export type MatchTxScope = { ids: readonly string[] } | { statementImportId: string } | { lookbackDays: number; today: string };
/** match_state in (unmatched, partial), not pending, ordered by booked_on then id. */
export async function loadTransactionsForMatch(tx: TenantTx, orgId: string, scope: MatchTxScope): Promise<MatchTxRow[]>;

export interface MatchDocRow {
  readonly id: string; readonly class: string; readonly status: string; readonly direction: 'in' | 'out' | null;
  readonly currency: string; readonly amount_due: string; readonly open_amount: string;
  readonly document_number: string | null; readonly variable_symbol: string | null;
  readonly issue_date: string | null; readonly due_date: string | null; readonly service_period_to: string | null;
  readonly payment_method: string | null; readonly partner_id: string | null; readonly partner_name: string | null;
  readonly pay_to_account: unknown; readonly partner_accounts: string[]; readonly created_at: string;
}
export type MatchDocScope = { ids: readonly string[] } | { all: true };
/** Eligible classes and statuses (M07 §4.6.2), not deleted, open_amount > 0; ordered by due_date nulls last, created_at, id. */
export async function loadOpenDocuments(tx: TenantTx, orgId: string, scope: MatchDocScope): Promise<MatchDocRow[]>;

export interface MatchContextRows {
  readonly aliases: { kind: string; value_normalized: string; partner_id: string; confirmations: number }[];
  /** partner_bank_accounts as `account_number/bank_code` and as iban. */
  readonly known_accounts: { value: string; partner_id: string }[];
  readonly rejected: { transaction_id: string; document_id: string }[];
  readonly partners_with_vs_history: string[];
}
export async function loadMatchContextRows(tx: TenantTx, orgId: string): Promise<MatchContextRows>;

export interface OwnAccountRow { readonly id: string; readonly type: string; readonly account_number: string | null; readonly bank_code: string | null; readonly iban: string | null; readonly is_business: boolean }
export async function loadOwnAccounts(tx: TenantTx, orgId: string): Promise<OwnAccountRow[]>;

export interface PaymentLinkInsert {
  readonly transactionId: string; readonly documentId: string; readonly linkType: string; readonly amount: string;
  readonly amountAccountCurrency: string; readonly matchMethod: string; readonly confidence: string; readonly matcherVersion: number;
}
/** created_by 'system'; returns the new ids in input order. */
export async function insertPaymentLinks(tx: TenantTx, orgId: string, rows: readonly PaymentLinkInsert[]): Promise<string[]>;

export interface SuggestionInsert {
  readonly transactionId: string; readonly kind: 'document' | 'multi_document' | 'transfer' | 'category';
  readonly documentIds: readonly string[]; readonly amounts: readonly string[];
  readonly pairedTransactionId: string | null; readonly categoryCode: string | null;
  readonly score: string; readonly features: unknown; readonly matcherVersion: number;
}
/** Idempotent (I4): open rows of the transaction with the same identity (kind, document_ids, paired, category) stay; others become 'superseded'; new identities are inserted. */
export async function syncOpenSuggestions(tx: TenantTx, orgId: string, transactionId: string, rows: readonly SuggestionInsert[]): Promise<{ inserted: number; superseded: number }>;

export interface TransactionMatchPatch {
  readonly matchState: 'unmatched' | 'partial' | 'matched' | 'no_document_needed';
  /** undefined = untouched; null = cleared; a code = set when it exists in categories, else null (TODO(P0-DB-11)). */
  readonly categoryCode?: string | null;
  readonly pairedTransactionId?: string | null;
}
export async function setTransactionMatch(tx: TenantTx, orgId: string, transactionId: string, patch: TransactionMatchPatch): Promise<void>;

export interface DocumentLinkRow { readonly link_type: string; readonly amount: string; readonly booked_on: string; readonly created_at: string }
/** Links of one document joined with the transaction's booked_on; ordered by booked_on, created_at. */
export async function loadDocumentLinks(tx: TenantTx, orgId: string, documentId: string): Promise<DocumentLinkRow[]>;

export interface DocumentPaidView { readonly amount_due: string | null; readonly currency: string; readonly issue_date: string | null; readonly is_paid_per_document: boolean | null; readonly paid_at: string | null }
export async function loadDocumentPaidView(tx: TenantTx, orgId: string, documentId: string): Promise<DocumentPaidView | null>;
/** Writes paid_at when it differs; true when a row changed. */
export async function setDocumentPaidAt(tx: TenantTx, orgId: string, documentId: string, paidAt: string | null): Promise<boolean>;
```
SQL rules:
- `loadTransactionsForMatch`: `select t.id, t.money_account_id, t.booked_on::text as booked_on, t.amount::text as amount, t.currency, t.amount_original::text as amount_original, t.currency_original, t.counterparty_name, t.counterparty_account, t.counterparty_bank_code, t.counterparty_iban, t.variable_symbol, t.message, t.card_merchant, t.match_state, coalesce((select sum(l.amount_account_currency) from payment_links l where l.org_id = t.org_id and l.transaction_id = t.id and l.link_type in ('payment','refund','fee','platform_payout')), 0)::text as linked_account_amount from transactions t where t.org_id = ${orgId} and t.match_state in ('unmatched','partial') and t.is_pending = false and <scope> order by t.booked_on, t.id`; scope: `t.id = any(${[...ids]}::uuid[])` | `t.statement_import_id = ${statementImportId}` | `t.booked_on >= (${today}::date - ${lookbackDays}::int)`.
- `loadOpenDocuments`: CTE `linked as (select document_id, sum(case when link_type = 'refund' then -amount when link_type in ('payment','offset','platform_payout','fx_difference') then amount else 0 end) as paid from payment_links where org_id = ${orgId} group by document_id)`; select `d.id, d.class::text as class, d.status::text as status, d.direction::text as direction, d.currency, coalesce(d.amount_due, d.total_gross)::text as amount_due, (coalesce(d.amount_due, d.total_gross) - coalesce(linked.paid, 0))::text as open_amount, d.document_number, d.variable_symbol, d.issue_date::text as issue_date, d.due_date::text as due_date, d.service_period_to::text as service_period_to, d.payment_method, d.partner_id, p.name as partner_name, d.pay_to_account, (select coalesce(array_agg(s.x), '{}'::text[]) from (select account_number || '/' || bank_code as x from partner_bank_accounts where org_id = d.org_id and partner_id = d.partner_id and account_number is not null and bank_code is not null union select iban from partner_bank_accounts where org_id = d.org_id and partner_id = d.partner_id and iban is not null) s) as partner_accounts, d.created_at::text as created_at from documents d left join partners p on p.id = d.partner_id and p.org_id = d.org_id left join linked on linked.document_id = d.id where d.org_id = ${orgId} and d.deleted_at is null and d.status in ('ready','finalized','needs_review') and d.class in ('received_invoice','received_receipt','received_advance_tax_doc','received_proforma','issued_credit_note','government_filing','issued_invoice','platform_statement','settlement_statement','received_credit_note') and coalesce(d.amount_due, d.total_gross) is not null and coalesce(d.amount_due, d.total_gross) - coalesce(linked.paid, 0) > 0 and <scope> order by d.due_date nulls last, d.created_at, d.id`; scope `d.id = any(${[...ids]}::uuid[])` | `true`.
- `loadMatchContextRows`: four selects: aliases from `counterparty_aliases`; known accounts = union of `account_number || '/' || bank_code` and `iban` from `partner_bank_accounts`; rejected = `transaction_id, document_ids[1] as document_id from match_suggestions where state = 'rejected' and kind = 'document' and cardinality(document_ids) = 1`; vs history = `select distinct d.partner_id from payment_links l join transactions t on t.id = l.transaction_id and t.org_id = l.org_id join documents d on d.id = l.document_id and d.org_id = l.org_id where l.org_id = ${orgId} and l.confirmed_by is not null and t.variable_symbol is not null and d.partner_id is not null`.
- `insertPaymentLinks`: one `insert ... returning id` per row (`confidence` as `${confidence}::numeric`).
- `syncOpenSuggestions`: read open rows (`id, kind, document_ids, paired_transaction_id, category_code`); identity `${kind}|${document_ids.join(',')}|${paired ?? ''}|${category ?? ''}`; `update match_suggestions set state = 'superseded' where org_id = ${orgId} and id = any(${ids}::uuid[])` for stale ids; insert the new identities with `document_ids = ${[...documentIds]}::uuid[]`, `amounts = ${[...amounts]}::numeric[]`, `features = ${JSON.stringify(features)}::jsonb`, `category_code = (select code from categories where code = ${categoryCode})`, `score = ${score}::numeric`.
- `setTransactionMatch`: `update transactions set match_state = ${matchState}, matched_at = case when ${matchState} in ('matched','no_document_needed') then now() else null end` plus, when `categoryCode !== undefined`, `, category_code = (select code from categories where code = ${categoryCode})` (null in → null out) and, when `pairedTransactionId !== undefined`, `, paired_transaction_id = ${pairedTransactionId}`; `where org_id = ${orgId} and id = ${transactionId}`. Build it from `sql` fragments (`sql.join` or appended fragments).
- `loadDocumentLinks`: `select l.link_type::text as link_type, l.amount::text as amount, t.booked_on::text as booked_on, l.created_at::text as created_at from payment_links l join transactions t on t.id = l.transaction_id and t.org_id = l.org_id where l.org_id = ${orgId} and l.document_id = ${documentId} order by t.booked_on, l.created_at`.
- `loadDocumentPaidView`: `coalesce(amount_due, total_gross)::text as amount_due, currency, issue_date::text, is_paid_per_document, paid_at::text`.
- `setDocumentPaidAt`: `update documents set paid_at = ${paidAt}::date where org_id = ${orgId} and id = ${documentId} and paid_at is distinct from ${paidAt}::date returning id`; true when a row came back.
Add `export * from './match-store';` to `packages/db/src/index.ts` directly below `export * from './inbound-email';`. Run `pnpm --filter @shoebox/db typecheck 2>&1 | tail -10`. Commit `0117 step 3`.

4. New `packages/db/test/match-store.db.test.ts`, verbatim:
```ts
import { sql as dsql } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  insertPaymentLinks, loadDocumentLinks, loadDocumentPaidView, loadMatchContextRows, loadOpenDocuments,
  loadOwnAccounts, loadTransactionsForMatch, setDocumentPaidAt, setTransactionMatch, type SuggestionInsert, syncOpenSuggestions,
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
    await sql`insert into organizations (id, name) values (${ORG}, 'Match Org')`;
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
    db = createTenantDb({ workerUrl: process.env.WORKER_DATABASE_URL ?? workerUrlFrom(serviceUrl), serviceUrl }, { max: 1 });
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
      expect(byIds[0]).toMatchObject({ amount: '-1210.00', currency: 'CZK', booked_on: '2026-03-10', variable_symbol: '2026001', linked_account_amount: '0', match_state: 'unmatched' });
      expect((await loadTransactionsForMatch(tx, ORG, { statementImportId: IMPORT })).map((r) => r.id)).toEqual([TX1]);
      expect((await loadTransactionsForMatch(tx, ORG, { lookbackDays: 30, today: '2026-03-20' })).map((r) => r.id)).toEqual([TX1, TX2]);
      expect(await loadTransactionsForMatch(tx, ORG, { lookbackDays: 3, today: '2026-03-20' })).toEqual([]);
    });
  });

  it('loads open documents with open amounts and partner accounts', async () => {
    await db.withTenant(ORG, async (tx) => {
      const all = await loadOpenDocuments(tx, ORG, { all: true });
      expect(all.map((d) => d.id)).toEqual([DOC1, DOC2]);
      const d1 = all[0]!;
      expect(d1).toMatchObject({ class: 'received_invoice', status: 'ready', direction: 'in', amount_due: '1210.00', open_amount: '1210.00', partner_id: PARTNER, partner_name: 'Alfa Servis s.r.o.', issue_date: '2026-03-01', due_date: '2026-03-15' });
      expect([...d1.partner_accounts].sort()).toEqual(['2400123455/2010', 'CZ8720100000002400123455']);
      const d2 = all[1]!;
      expect(d2.partner_accounts).toEqual([]);
      expect(d2.pay_to_account).toEqual({ account: '1003-1234567899', bank_code: '0800' });
      expect((await loadOpenDocuments(tx, ORG, { ids: [DOC2, DOC3] })).map((d) => d.id)).toEqual([DOC2]);
    });
  });

  it('loads the learning context and own accounts', async () => {
    await sql`insert into match_suggestions (org_id, transaction_id, kind, document_ids, amounts, score, features, state, matcher_version)
      values (${ORG}, ${TX2}, 'document', ${[DOC1]}::uuid[], ${['500.00']}::numeric[], 0.700, '[]'::jsonb, 'rejected', 1)`;
    await db.withTenant(ORG, async (tx) => {
      const c = await loadMatchContextRows(tx, ORG);
      expect(c.aliases).toEqual([]);
      expect(c.known_accounts.map((k) => k.value).sort()).toEqual(['2400123455/2010', 'CZ8720100000002400123455']);
      expect(c.known_accounts.every((k) => k.partner_id === PARTNER)).toBe(true);
      expect(c.rejected).toEqual([{ transaction_id: TX2, document_id: DOC1 }]);
      expect(c.partners_with_vs_history).toEqual([]);
      const own = await loadOwnAccounts(tx, ORG);
      expect(own.map((o) => o.account_number).sort()).toEqual(['1003-1234567899', '2400123455']);
      expect(own.find((o) => o.id === ACC)).toMatchObject({ type: 'bank', bank_code: '2010', iban: 'CZ8720100000002400123455', is_business: true });
    });
  });

  it('writes links, suggestions, states and paid_at', async () => {
    await db.withTenant(ORG, async (tx) => {
      const ids = await insertPaymentLinks(tx, ORG, [{ transactionId: TX1, documentId: DOC1, linkType: 'payment', amount: '1210.00', amountAccountCurrency: '1210.00', matchMethod: 'vs_amount', confidence: '0.989', matcherVersion: 1 }]);
      expect(ids).toHaveLength(1);
      expect((await loadOpenDocuments(tx, ORG, { all: true })).map((d) => d.id)).toEqual([DOC2]);
      expect((await loadTransactionsForMatch(tx, ORG, { ids: [TX1] }))[0]?.linked_account_amount).toBe('1210.00');
      const links = await loadDocumentLinks(tx, ORG, DOC1);
      expect(links).toHaveLength(1);
      expect(links[0]).toMatchObject({ link_type: 'payment', amount: '1210.00', booked_on: '2026-03-10' });

      await setTransactionMatch(tx, ORG, TX1, { matchState: 'matched' });
      expect(await loadTransactionsForMatch(tx, ORG, { ids: [TX1] })).toEqual([]);
      await setTransactionMatch(tx, ORG, TX2, { matchState: 'no_document_needed', categoryCode: 'exp_bank_fees' });
      const [t2] = await tx.execute<{ match_state: string; category_code: string | null; matched: boolean }>(
        dsql`select match_state, category_code, matched_at is not null as matched from transactions where org_id = ${ORG} and id = ${TX2}`,
      );
      expect(t2).toEqual({ match_state: 'no_document_needed', category_code: 'exp_bank_fees', matched: true });
      await setTransactionMatch(tx, ORG, TX2, { matchState: 'unmatched', categoryCode: 'not_seeded_code' });
      const [t2b] = await tx.execute<{ match_state: string; category_code: string | null }>(
        dsql`select match_state, category_code from transactions where org_id = ${ORG} and id = ${TX2}`,
      );
      expect(t2b).toEqual({ match_state: 'unmatched', category_code: null });

      const s = (over: Partial<SuggestionInsert>): SuggestionInsert => ({
        transactionId: TX2, kind: 'document' as const, documentIds: [DOC2], amounts: ['500.00'], pairedTransactionId: null,
        categoryCode: null, score: '0.700', features: [{ code: 'amount_exact', contribution: 3 }], matcherVersion: 1, ...over,
      });
      expect(await syncOpenSuggestions(tx, ORG, TX2, [s({})])).toEqual({ inserted: 1, superseded: 0 });
      expect(await syncOpenSuggestions(tx, ORG, TX2, [s({})])).toEqual({ inserted: 0, superseded: 0 });
      expect(await syncOpenSuggestions(tx, ORG, TX2, [s({ documentIds: [DOC1], amounts: ['1210.00'] })])).toEqual({ inserted: 1, superseded: 1 });
      const states = await tx.execute<{ state: string; n: number }>(
        dsql`select state, count(*)::int as n from match_suggestions where org_id = ${ORG} and transaction_id = ${TX2} group by state order by state`,
      );
      expect([...states]).toEqual([{ state: 'open', n: 1 }, { state: 'rejected', n: 1 }, { state: 'superseded', n: 1 }]);

      expect(await setDocumentPaidAt(tx, ORG, DOC1, '2026-03-10')).toBe(true);
      expect(await setDocumentPaidAt(tx, ORG, DOC1, '2026-03-10')).toBe(false);
      expect(await loadDocumentPaidView(tx, ORG, DOC1)).toEqual({ amount_due: '1210.00', currency: 'CZK', issue_date: '2026-03-01', is_paid_per_document: null, paid_at: '2026-03-10' });
      expect(await setDocumentPaidAt(tx, ORG, DOC1, null)).toBe(true);
      expect(await loadDocumentPaidView(tx, ORG, 'eeeeeeee-0000-4000-8000-000000000000')).toBeNull();
    });
  });
});
```
Run `pnpm --filter @shoebox/db test -- match-store 2>&1 | tail -30` (needs `pnpm db:start`; see the test-map row) → pass. If no database is available in the session, the test skips: say so in the report. Commit `0117 step 4`.

## 5. Do not touch

`packages/db/migrations/` (no migration in this brief), `packages/db/src/rls-catalog.ts`, `packages/bank/`, `apps/`, `packages/domain/src/rules/law.ts`. Hard rules 1 (amounts stay strings end to end; never `Number`), 3 (every query names `org_id`; run under `withTenant`), 5 (no schema change), 9 (`[verify]`: you have no network; write "not verified, owner to confirm the FÚ accounts page" in the report).

## 6. Commands

- `pnpm --filter @shoebox/domain test -- rules 2>&1 | tail -30` → pass (`rules-values`, `rules-law`, `rules-authority-accounts`).
- `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30` → no errors.
- `pnpm --filter @shoebox/db test -- match-store 2>&1 | tail -30` → pass (or skipped without `DATABASE_URL`, say so).
- `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30` → no errors.

## 7. Acceptance

- [ ] `rules-authority-accounts.test.ts` and the edited `rules-values.test.ts` pass.
- [ ] Only prefixes `705` and `2866` are seeded; every `accounts` list is empty; the entry has `source` and `verified_at`.
- [ ] `match-store.db.test.ts` passes against a local database (or is reported as skipped).
- [ ] `grep -c "org_id" packages/db/src/match-store.ts` ≥ 12 (every statement org-scoped).

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found;
- a test fails twice, or a test the brief wrote seems wrong;
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a new dependency seems needed;
- a file outside §3 needs a change (for example a migration);
- §5 would be touched;
- a step is unclear.

## 9. Report

Write `docs/tasks/0117-report.md` (600 tokens at most) and set `Status: review`. The report has:

1. The files changed (`git diff --stat`).
2. Each command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations, and the `[verify]` finding (FÚ accounts page not verified: no network).
5. Questions.
6. Owner steps left.

## Risk list (for the reviewer)

`2026.ts`/`2025.ts` (tax categories per prefix), `match-store.ts` (`open_amount` arithmetic in SQL, `linked_account_amount`, org scoping of every statement, the category subselect).

## Owner steps

1. Open https://financnisprava.gov.cz and find the page "Bankovní účty finančních úřadů". Confirm prefix 705 = DPH and 2866 = paušální daň; send the income-tax prefix and the page URL to the orchestrator (it becomes a one-line brief).
