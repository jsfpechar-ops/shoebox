import { sql } from 'drizzle-orm';
import type { TenantTx } from './tenant';

// M07 §4.8 missing-documents radar. Every query is org-scoped (hard rule 3).

export interface RadarTxRow {
  readonly id: string;
  readonly amount: string;
  readonly currency: string;
  readonly booked_on: string;
  readonly match_state: string;
  readonly category_code: string | null;
  readonly is_pending: boolean;
  readonly is_business: boolean;
  /** Σ payment_links.amount_account_currency, '0' when none. */
  readonly linked_amount: string;
  readonly counterparty: string | null;
  readonly variable_symbol: string | null;
}

/** Outgoing, unmatched or partial, booked, uncategorised transactions; the pure radar rules then decide. */
export async function loadRadarTransactions(tx: TenantTx, orgId: string): Promise<RadarTxRow[]> {
  const rows = await tx.execute<RadarTxRow & Record<string, unknown>>(
    sql`select t.id, t.amount::text as amount, t.currency, t.booked_on::text as booked_on, t.match_state, t.category_code, t.is_pending, a.is_business, coalesce((select sum(l.amount_account_currency) from payment_links l where l.org_id = t.org_id and l.transaction_id = t.id), 0)::text as linked_amount, coalesce(t.counterparty_name, t.card_merchant) as counterparty, t.variable_symbol from transactions t join money_accounts a on a.id = t.money_account_id and a.org_id = t.org_id where t.org_id = ${orgId} and t.amount < 0 and t.match_state in ('unmatched','partial') and t.is_pending = false and t.category_code is null order by t.booked_on, t.id`,
  );
  return [...rows];
}

export interface RadarQuestionRow {
  readonly id: string;
  readonly transaction_id: string;
  readonly answered_at: string | null;
  readonly answer: unknown;
}

export async function loadRadarQuestions(tx: TenantTx, orgId: string): Promise<RadarQuestionRow[]> {
  const rows = await tx.execute<RadarQuestionRow & Record<string, unknown>>(
    sql`select id, transaction_id, answered_at::text as answered_at, answer from review_questions where org_id = ${orgId} and kind = 'missing_document' and transaction_id is not null order by created_at, id`,
  );
  return [...rows];
}

export async function insertRadarQuestion(
  tx: TenantTx,
  orgId: string,
  transactionId: string,
  payload: unknown,
): Promise<void> {
  await tx.execute(
    sql`insert into review_questions (org_id, transaction_id, kind, payload) values (${orgId}, ${transactionId}, 'missing_document', ${JSON.stringify(payload)}::jsonb)`,
  );
}

/** Closes an open radar question without a user answer (the transaction no longer needs a document). */
export async function resolveRadarQuestion(
  tx: TenantTx,
  orgId: string,
  questionId: string,
): Promise<void> {
  await tx.execute(
    sql`update review_questions set answer = '{"resolved":"auto"}'::jsonb, answered_at = now() where org_id = ${orgId} and id = ${questionId} and answered_at is null`,
  );
}

/** Marks an answered radar question as applied to its transaction. */
export async function markRadarAnswerApplied(
  tx: TenantTx,
  orgId: string,
  questionId: string,
): Promise<void> {
  await tx.execute(
    sql`update review_questions set answer = coalesce(answer, '{}'::jsonb) || '{"applied":true}'::jsonb where org_id = ${orgId} and id = ${questionId}`,
  );
}

/** Sets 'no_document_needed' (and an optional category when it exists) on a still unmatched/partial transaction. Returns whether a row changed. */
export async function applyRadarAnswerToTransaction(
  tx: TenantTx,
  orgId: string,
  transactionId: string,
  categoryCode: string | null,
): Promise<boolean> {
  const rows = await tx.execute(
    sql`update transactions set match_state = 'no_document_needed', matched_at = now(), category_code = case when ${categoryCode}::text is null then category_code else (select code from categories where code = ${categoryCode}) end where org_id = ${orgId} and id = ${transactionId} and match_state in ('unmatched','partial') returning id`,
  );
  return [...rows].length > 0;
}

export interface OrgInvoicingDetails {
  readonly name: string;
  readonly ico: string | null;
  readonly dic: string | null;
  readonly address: string | null;
}

function addressLine(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const a = raw as Record<string, unknown>;
  const text = (k: string): string => (typeof a[k] === 'string' ? (a[k] as string).trim() : '');
  const house = [text('house_number'), text('orientation_number')]
    .filter((s) => s !== '')
    .join('/');
  const street = [text('street'), house].filter((s) => s !== '').join(' ');
  const city = [text('zip'), text('city')].filter((s) => s !== '').join(' ');
  const line = [street, city, text('country')].filter((s) => s !== '').join(', ');
  return line === '' ? null : line;
}

/** Name, IČO, DIČ and address of the newest taxpayer profile; the organization row when there is none. */
export async function loadOrgInvoicingDetails(
  tx: TenantTx,
  orgId: string,
): Promise<OrgInvoicingDetails | null> {
  const profile = await tx.execute<{
    name: string;
    ico: string | null;
    dic: string | null;
    address: unknown;
  }>(
    sql`select legal_name as name, ico, dic, address from taxpayer_profiles where org_id = ${orgId} order by valid_from desc limit 1`,
  );
  const p = [...profile][0];
  if (p !== undefined) {
    return { name: p.name, ico: p.ico, dic: p.dic, address: addressLine(p.address) };
  }
  const org = await tx.execute<{ name: string; ico: string | null; dic: string | null }>(
    sql`select name, ico, dic from organizations where id = ${orgId}`,
  );
  const o = [...org][0];
  return o === undefined ? null : { name: o.name, ico: o.ico, dic: o.dic, address: null };
}

/** `from_address` of the newest e-mail that delivered a document of a supplier with this name; null when unknown. */
export async function loadLastSupplierSender(
  tx: TenantTx,
  orgId: string,
  supplierName: string,
): Promise<string | null> {
  const rows = await tx.execute<{ from_address: string | null }>(
    sql`select e.from_address from documents d join partners p on p.id = d.partner_id and p.org_id = d.org_id join inbound_emails e on e.id = d.inbound_email_id and e.org_id = d.org_id where d.org_id = ${orgId} and lower(p.name) = lower(${supplierName}) and e.from_address is not null order by e.received_at desc limit 1`,
  );
  return [...rows][0]?.from_address ?? null;
}
