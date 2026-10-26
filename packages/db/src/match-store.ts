import { sql } from 'drizzle-orm';
import type { TenantTx } from './tenant';

export interface MatchTxRow {
  readonly id: string;
  readonly money_account_id: string;
  readonly booked_on: string;
  readonly amount: string;
  readonly currency: string;
  readonly amount_original: string | null;
  readonly currency_original: string | null;
  readonly counterparty_name: string | null;
  readonly counterparty_account: string | null;
  readonly counterparty_bank_code: string | null;
  readonly counterparty_iban: string | null;
  readonly variable_symbol: string | null;
  readonly message: string | null;
  readonly card_merchant: string | null;
  readonly match_state: string;
  /** Σ amount_account_currency of links payment/refund/fee/platform_payout (I1), '0' when none. */
  readonly linked_account_amount: string;
}
export type MatchTxScope =
  | { ids: readonly string[] }
  | { statementImportId: string }
  | { lookbackDays: number; today: string };
/** match_state in (unmatched, partial), not pending, ordered by booked_on then id. */
export async function loadTransactionsForMatch(
  tx: TenantTx,
  orgId: string,
  scope: MatchTxScope,
): Promise<MatchTxRow[]> {
  const rows = await tx.execute<MatchTxRow & Record<string, unknown>>(
    sql`select t.id, t.money_account_id, t.booked_on::text as booked_on, t.amount::text as amount, t.currency, t.amount_original::text as amount_original, t.currency_original, t.counterparty_name, t.counterparty_account, t.counterparty_bank_code, t.counterparty_iban, t.variable_symbol, t.message, t.card_merchant, t.match_state, coalesce((select sum(l.amount_account_currency) from payment_links l where l.org_id = t.org_id and l.transaction_id = t.id and l.link_type in ('payment','refund','fee','platform_payout')), 0)::text as linked_account_amount from transactions t where t.org_id = ${orgId} and t.match_state in ('unmatched','partial') and t.is_pending = false and ${txScope(scope)} order by t.booked_on, t.id`,
  );
  return [...rows];
}

export interface MatchDocRow {
  readonly id: string;
  readonly class: string;
  readonly status: string;
  readonly direction: 'in' | 'out' | null;
  readonly currency: string;
  readonly amount_due: string;
  readonly open_amount: string;
  readonly document_number: string | null;
  readonly variable_symbol: string | null;
  readonly issue_date: string | null;
  readonly due_date: string | null;
  readonly service_period_to: string | null;
  readonly payment_method: string | null;
  readonly partner_id: string | null;
  readonly partner_name: string | null;
  readonly pay_to_account: unknown;
  readonly partner_accounts: string[];
  readonly created_at: string;
}
export type MatchDocScope = { ids: readonly string[] } | { all: true };
/** Eligible classes and statuses (M07 §4.6.2), not deleted, open_amount > 0; ordered by due_date nulls last, created_at, id. */
export async function loadOpenDocuments(
  tx: TenantTx,
  orgId: string,
  scope: MatchDocScope,
): Promise<MatchDocRow[]> {
  const where = 'ids' in scope ? sql`d.id = any(${sql.param([...scope.ids])}::uuid[])` : sql`true`;
  const rows = await tx.execute<MatchDocRow & Record<string, unknown>>(
    sql`with linked as (select document_id, sum(case when link_type = 'refund' then -amount when link_type in ('payment','offset','platform_payout','fx_difference') then amount else 0 end) as paid from payment_links where org_id = ${orgId} group by document_id) select d.id, d.class::text as class, d.status::text as status, d.direction::text as direction, d.currency, coalesce(d.amount_due, d.total_gross)::text as amount_due, (coalesce(d.amount_due, d.total_gross) - coalesce(linked.paid, 0))::text as open_amount, d.document_number, d.variable_symbol, d.issue_date::text as issue_date, d.due_date::text as due_date, d.service_period_to::text as service_period_to, d.payment_method, d.partner_id, p.name as partner_name, d.pay_to_account, (select coalesce(array_agg(s.x), '{}'::text[]) from (select account_number || '/' || bank_code as x from partner_bank_accounts where org_id = d.org_id and partner_id = d.partner_id and account_number is not null and bank_code is not null union select iban from partner_bank_accounts where org_id = d.org_id and partner_id = d.partner_id and iban is not null) s) as partner_accounts, d.created_at::text as created_at from documents d left join partners p on p.id = d.partner_id and p.org_id = d.org_id left join linked on linked.document_id = d.id where d.org_id = ${orgId} and d.deleted_at is null and d.status in ('ready','finalized','needs_review') and d.class in ('received_invoice','received_receipt','received_advance_tax_doc','received_proforma','issued_credit_note','government_filing','issued_invoice','platform_statement','settlement_statement','received_credit_note') and coalesce(d.amount_due, d.total_gross) is not null and coalesce(d.amount_due, d.total_gross) - coalesce(linked.paid, 0) > 0 and ${where} order by d.due_date nulls last, d.created_at, d.id`,
  );
  return [...rows];
}

export interface MatchContextRows {
  readonly aliases: {
    kind: string;
    value_normalized: string;
    partner_id: string;
    confirmations: number;
  }[];
  /** partner_bank_accounts as `account_number/bank_code` and as iban. */
  readonly known_accounts: { value: string; partner_id: string }[];
  readonly rejected: { transaction_id: string; document_id: string }[];
  readonly partners_with_vs_history: string[];
}
export async function loadMatchContextRows(tx: TenantTx, orgId: string): Promise<MatchContextRows> {
  const aliases = await tx.execute<{
    kind: string;
    value_normalized: string;
    partner_id: string;
    confirmations: number;
  }>(
    sql`select kind, value_normalized, partner_id, confirmations from counterparty_aliases where org_id = ${orgId}`,
  );
  const known = await tx.execute<{ value: string; partner_id: string }>(
    sql`select account_number || '/' || bank_code as value, partner_id from partner_bank_accounts where org_id = ${orgId} and account_number is not null and bank_code is not null union select iban as value, partner_id from partner_bank_accounts where org_id = ${orgId} and iban is not null`,
  );
  const rejected = await tx.execute<{ transaction_id: string; document_id: string }>(
    sql`select transaction_id, document_ids[1] as document_id from match_suggestions where org_id = ${orgId} and state = 'rejected' and kind = 'document' and cardinality(document_ids) = 1`,
  );
  const vs = await tx.execute<{ partner_id: string }>(
    sql`select distinct d.partner_id from payment_links l join transactions t on t.id = l.transaction_id and t.org_id = l.org_id join documents d on d.id = l.document_id and d.org_id = l.org_id where l.org_id = ${orgId} and l.confirmed_by is not null and t.variable_symbol is not null and d.partner_id is not null`,
  );
  return {
    aliases: [...aliases],
    known_accounts: [...known],
    rejected: [...rejected],
    partners_with_vs_history: [...vs].map((r) => r.partner_id),
  };
}

export interface OwnAccountRow {
  readonly id: string;
  readonly type: string;
  readonly account_number: string | null;
  readonly bank_code: string | null;
  readonly iban: string | null;
  readonly is_business: boolean;
}
export async function loadOwnAccounts(tx: TenantTx, orgId: string): Promise<OwnAccountRow[]> {
  const rows = await tx.execute<OwnAccountRow & Record<string, unknown>>(
    sql`select id, type::text as type, account_number, bank_code, iban, is_business from money_accounts where org_id = ${orgId} order by name, id`,
  );
  return [...rows];
}

export interface PaymentLinkInsert {
  readonly transactionId: string;
  readonly documentId: string;
  readonly linkType: string;
  readonly amount: string;
  readonly amountAccountCurrency: string;
  readonly matchMethod: string;
  readonly confidence: string;
  readonly matcherVersion: number;
  /** Default 'system'. */
  readonly createdBy?: 'system' | 'user';
  /** Set with createdBy 'user': confirmed_by = this user, confirmed_at = now(). */
  readonly confirmedBy?: string;
}
/** created_by 'system' unless the row says 'user'; returns the new ids in input order. */
export async function insertPaymentLinks(
  tx: TenantTx,
  orgId: string,
  rows: readonly PaymentLinkInsert[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const r of rows) {
    const [inserted] = await tx.execute<{ id: string }>(
      sql`insert into payment_links (org_id, transaction_id, document_id, link_type, amount, amount_account_currency, match_method, confidence, matcher_version, created_by, confirmed_by, confirmed_at) values (${orgId}, ${r.transactionId}, ${r.documentId}, ${r.linkType}, ${r.amount}::numeric, ${r.amountAccountCurrency}::numeric, ${r.matchMethod}, ${r.confidence}::numeric, ${r.matcherVersion}, ${r.createdBy ?? 'system'}, ${r.confirmedBy ?? null}, ${r.confirmedBy !== undefined ? sql`now()` : sql`null`}) returning id`,
    );
    if (!inserted) throw new Error('payment_links insert returned no row');
    ids.push(inserted.id);
  }
  return ids;
}

export interface SuggestionInsert {
  readonly transactionId: string;
  readonly kind: 'document' | 'multi_document' | 'transfer' | 'category';
  readonly documentIds: readonly string[];
  readonly amounts: readonly string[];
  readonly pairedTransactionId: string | null;
  readonly categoryCode: string | null;
  readonly score: string;
  readonly features: unknown;
  readonly matcherVersion: number;
}
/** Idempotent (I4): open rows of the transaction with the same identity (kind, document_ids, paired, category) stay; others become 'superseded'; new identities are inserted. */
export async function syncOpenSuggestions(
  tx: TenantTx,
  orgId: string,
  transactionId: string,
  rows: readonly SuggestionInsert[],
): Promise<{ inserted: number; superseded: number }> {
  const open = await tx.execute<{
    id: string;
    kind: string;
    document_ids: string[];
    paired_transaction_id: string | null;
    category_code: string | null;
  }>(
    sql`select id, kind, document_ids::text[] as document_ids, paired_transaction_id, category_code from match_suggestions where org_id = ${orgId} and transaction_id = ${transactionId} and state = 'open'`,
  );
  const identity = (
    kind: string,
    documentIds: readonly string[],
    paired: string | null,
    category: string | null,
  ) => `${kind}|${documentIds.join(',')}|${paired ?? ''}|${category ?? ''}`;
  const wanted = new Set(
    rows.map((r) => identity(r.kind, r.documentIds, r.pairedTransactionId, r.categoryCode)),
  );
  const kept = new Set<string>();
  const stale: string[] = [];
  for (const o of open) {
    const key = identity(o.kind, o.document_ids, o.paired_transaction_id, o.category_code);
    if (wanted.has(key) && !kept.has(key)) kept.add(key);
    else stale.push(o.id);
  }
  if (stale.length > 0) {
    await tx.execute(
      sql`update match_suggestions set state = 'superseded' where org_id = ${orgId} and id = any(${sql.param(stale)}::uuid[])`,
    );
  }
  let inserted = 0;
  for (const r of rows) {
    const key = identity(r.kind, r.documentIds, r.pairedTransactionId, r.categoryCode);
    if (kept.has(key)) continue;
    kept.add(key);
    await tx.execute(
      sql`insert into match_suggestions (org_id, transaction_id, kind, document_ids, amounts, paired_transaction_id, category_code, score, features, state, matcher_version) values (${orgId}, ${transactionId}, ${r.kind}, ${sql.param([...r.documentIds])}::uuid[], ${sql.param([...r.amounts])}::numeric[], ${r.pairedTransactionId}, (select code from categories where code = ${r.categoryCode}), ${r.score}::numeric, ${JSON.stringify(r.features)}::jsonb, 'open', ${r.matcherVersion})`,
    );
    inserted += 1;
  }
  return { inserted, superseded: stale.length };
}

export interface TransactionMatchPatch {
  readonly matchState: 'unmatched' | 'partial' | 'matched' | 'no_document_needed';
  /** undefined = untouched; null = cleared; a code = set when it exists in categories, else null (TODO(P0-DB-11)). */
  readonly categoryCode?: string | null;
  readonly pairedTransactionId?: string | null;
}
export async function setTransactionMatch(
  tx: TenantTx,
  orgId: string,
  transactionId: string,
  patch: TransactionMatchPatch,
): Promise<void> {
  const sets = [
    sql`match_state = ${patch.matchState}`,
    sql`matched_at = case when ${patch.matchState} in ('matched', 'no_document_needed') then now() else null end`,
  ];
  if (patch.categoryCode !== undefined) {
    sets.push(
      sql`category_code = (select code from categories where code = ${patch.categoryCode})`,
    );
  }
  if (patch.pairedTransactionId !== undefined) {
    sets.push(sql`paired_transaction_id = ${patch.pairedTransactionId}`);
  }
  await tx.execute(
    sql`update transactions set ${sql.join(sets, sql`, `)} where org_id = ${orgId} and id = ${transactionId}`,
  );
}

export interface SuggestionForDecision {
  readonly id: string;
  readonly transaction_id: string;
  readonly kind: string;
  readonly document_ids: string[];
  readonly amounts: string[];
  readonly state: string;
  readonly score: string;
}
export async function loadSuggestionForDecision(
  tx: TenantTx,
  orgId: string,
  id: string,
): Promise<SuggestionForDecision | null> {
  const [row] = await tx.execute<SuggestionForDecision & Record<string, unknown>>(
    sql`select id, transaction_id, kind::text as kind, document_ids::text[] as document_ids, amounts::text[] as amounts, state::text as state, score::text as score from match_suggestions where org_id = ${orgId} and id = ${id}`,
  );
  return row ?? null;
}
/** Only an open suggestion can be decided; true when a row changed. */
export async function decideSuggestion(
  tx: TenantTx,
  orgId: string,
  id: string,
  state: 'accepted' | 'rejected',
  userId: string,
): Promise<boolean> {
  const rows = await tx.execute<{ id: string }>(
    sql`update match_suggestions set state = ${state}, decided_by = ${userId}, decided_at = now() where org_id = ${orgId} and id = ${id} and state = 'open' returning id`,
  );
  return [...rows].length > 0;
}
/** 'matched' when the links cover abs(amount), 'partial' when some do, else untouched. */
export async function refreshTransactionMatchState(
  tx: TenantTx,
  orgId: string,
  transactionId: string,
): Promise<void> {
  await tx.execute(
    sql`with s as (select t.id, coalesce((select sum(l.amount_account_currency) from payment_links l where l.org_id = t.org_id and l.transaction_id = t.id), 0) as linked, abs(t.amount) as total from transactions t where t.org_id = ${orgId} and t.id = ${transactionId}) update transactions t set match_state = case when s.linked >= s.total then 'matched' else 'partial' end, matched_at = case when s.linked >= s.total then now() else null end from s where t.org_id = ${orgId} and t.id = s.id and s.linked > 0`,
  );
}

export interface DocumentLinkRow {
  readonly link_type: string;
  readonly amount: string;
  readonly booked_on: string;
  readonly created_at: string;
}
/** Links of one document joined with the transaction's booked_on; ordered by booked_on, created_at. */
export async function loadDocumentLinks(
  tx: TenantTx,
  orgId: string,
  documentId: string,
): Promise<DocumentLinkRow[]> {
  const rows = await tx.execute<DocumentLinkRow & Record<string, unknown>>(
    sql`select l.link_type::text as link_type, l.amount::text as amount, t.booked_on::text as booked_on, l.created_at::text as created_at from payment_links l join transactions t on t.id = l.transaction_id and t.org_id = l.org_id where l.org_id = ${orgId} and l.document_id = ${documentId} order by t.booked_on, l.created_at`,
  );
  return [...rows];
}

export interface DocumentPaidView {
  readonly amount_due: string | null;
  readonly currency: string;
  readonly issue_date: string | null;
  readonly is_paid_per_document: boolean | null;
  readonly paid_at: string | null;
}
export async function loadDocumentPaidView(
  tx: TenantTx,
  orgId: string,
  documentId: string,
): Promise<DocumentPaidView | null> {
  const [row] = await tx.execute<DocumentPaidView & Record<string, unknown>>(
    sql`select coalesce(amount_due, total_gross)::text as amount_due, currency, issue_date::text as issue_date, is_paid_per_document, paid_at::text as paid_at from documents where org_id = ${orgId} and id = ${documentId}`,
  );
  return row ?? null;
}
/** Writes paid_at when it differs; true when a row changed. */
export async function setDocumentPaidAt(
  tx: TenantTx,
  orgId: string,
  documentId: string,
  paidAt: string | null,
): Promise<boolean> {
  const rows = await tx.execute<{ id: string }>(
    sql`update documents set paid_at = ${paidAt}::date where org_id = ${orgId} and id = ${documentId} and paid_at is distinct from ${paidAt}::date returning id`,
  );
  return [...rows].length > 0;
}

function txScope(scope: MatchTxScope) {
  if ('ids' in scope) return sql`t.id = any(${sql.param([...scope.ids])}::uuid[])`;
  if ('statementImportId' in scope) return sql`t.statement_import_id = ${scope.statementImportId}`;
  return sql`t.booked_on >= (${scope.today}::date - ${scope.lookbackDays}::int)`;
}
