// VAT periods API (0351): card builder and request parsers (pure), plus small org-scoped loaders.
// Money stays a string.

import { entryRowToDraft, legalDate, type PeriodEntryRow } from '@shoebox/db';
import {
  buildPeriodPreview,
  computeDphdp3,
  computeKh,
  computeShv,
  createCzRules,
  type KhDocumentLookup,
  type LegalDate,
  Money,
  monthAfter,
  type PeriodPreview,
  type PreviewDocumentMeta,
  type ShvComputation,
  type ShvRow,
  type VatLedgerEntryDraft,
} from '@shoebox/domain';
import type { createSupabaseServerClient } from '../supabase/server';

type SupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type CardKind =
  | 'ready'
  | 'not_ready'
  | 'needs_accountant'
  | 'draft_unvalidated'
  | 'filed'
  | 'amendment_needed'
  | 'imported_matches'
  | 'overdue_missing';

export interface PeriodCard {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly form: 'DPHDP3' | 'DPHKH1' | 'DPHSHV';
  readonly kind: CardKind;
  readonly filingId: string | null;
  readonly bundleId: string | null;
  readonly amountDue: string | null;
  readonly dueDate: string | null;
  readonly obligationState: string | null;
  readonly reasons: readonly string[];
  readonly filedOn: string | null;
  readonly proposal: { kind: string; dueDate: string } | null;
}

export interface CardInputs {
  readonly status: 'platce' | 'identifikovana_osoba';
  readonly today: string;
  readonly filings: ReadonlyArray<{
    id: string;
    type: string;
    kind: string;
    origin: string;
    periodStart: string;
    periodEnd: string;
    state: string;
    bundleId: string | null;
    xsdValid: boolean | null;
    totals: Record<string, unknown>;
    simpleCheck: Record<string, unknown>;
    filedOn: string | null;
    amendsFilingId: string | null;
    discoveredOn: string | null;
  }>;
  readonly obligations: ReadonlyArray<{
    kind: string;
    periodStart: string | null;
    periodEnd?: string | null;
    dueDate: string;
    state: string;
    amountEstimate: string | null;
  }>;
  readonly periodsWithEntries: readonly string[];
}

const FORMS = ['DPHDP3', 'DPHKH1', 'DPHSHV'] as const;
type Form = (typeof FORMS)[number];

const GENERATE_KINDS = ['radne', 'opravne', 'dodatecne', 'nasledne'] as const;
type GenerateKind = (typeof GENERATE_KINDS)[number];

const FORM_OF_KIND: ReadonlyMap<string, Form> = new Map<string, Form>([
  ['vat_return', 'DPHDP3'],
  ['kh', 'DPHKH1'],
  ['sh', 'DPHSHV'],
]);

const PERIOD_START_RE = /^\d{4}-(0[1-9]|1[0-2])-01$/;

function isForm(v: unknown): v is Form {
  return typeof v === 'string' && (FORMS as readonly string[]).includes(v);
}

function isGenerateKind(v: unknown): v is GenerateKind {
  return typeof v === 'string' && (GENERATE_KINDS as readonly string[]).includes(v);
}

function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function monthEnd(periodStart: string): string {
  const year = Number.parseInt(periodStart.slice(0, 4), 10);
  const month = Number.parseInt(periodStart.slice(5, 7), 10);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${periodStart.slice(0, 8)}${String(last).padStart(2, '0')}`;
}

function failingCodes(simpleCheck: Record<string, unknown>): string[] {
  const checks = simpleCheck.checks;
  if (!Array.isArray(checks)) return [];
  const out: string[] = [];
  for (const c of checks) {
    if (typeof c === 'object' && c !== null && 'code' in c && 'outcome' in c) {
      if (typeof c.code === 'string' && c.outcome !== 'pass') out.push(c.code);
    }
  }
  return out;
}

// Row64 is a whole-koruna integer in the totals; anything else is not shown as an amount.
function amountString(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isInteger(v)) return String(v);
  return null;
}

function proposalOf(v: unknown): { kind: string; dueDate: string } | null {
  if (typeof v !== 'object' || v === null || !('kind' in v) || !('dueDate' in v)) return null;
  if (typeof v.kind !== 'string' || typeof v.dueDate !== 'string') return null;
  return { kind: v.kind, dueDate: v.dueDate };
}

interface DueInfo {
  readonly dueDate: string;
  readonly state: string;
}

function filingCard(
  f: CardInputs['filings'][number],
  form: Form,
  due: ReadonlyMap<string, DueInfo>,
): PeriodCard | null {
  const d = due.get(`${form}|${f.periodStart}`);
  const verdict = f.simpleCheck.verdict;
  let kind: CardKind;
  let amountDue: string | null = null;
  let reasons: string[] = [];
  let proposal: { kind: string; dueDate: string } | null = null;

  if (f.state === 'marked_filed') {
    kind = f.origin === 'imported' && f.totals.matchesFiled === true ? 'imported_matches' : 'filed';
  } else if (f.state === 'draft' && f.amendsFilingId !== null) {
    kind = 'amendment_needed';
    proposal = proposalOf(f.totals.proposal);
  } else if (verdict === 'needs_accountant') {
    kind = 'needs_accountant';
  } else if (f.state === 'draft' && verdict === 'not_ready') {
    kind = 'not_ready';
    reasons = failingCodes(f.simpleCheck);
  } else if ((f.state === 'generated' || f.state === 'downloaded') && f.xsdValid === true) {
    kind = 'ready';
    amountDue = amountString(f.totals.row64);
  } else if (
    (f.state === 'generated' || f.state === 'downloaded' || f.state === 'draft') &&
    verdict === 'simple'
  ) {
    kind = 'draft_unvalidated';
  } else {
    return null;
  }

  return {
    periodStart: f.periodStart,
    periodEnd: f.periodEnd,
    form,
    kind,
    filingId: f.id,
    bundleId: f.bundleId,
    amountDue,
    dueDate: d?.dueDate ?? null,
    obligationState: d?.state ?? null,
    reasons,
    filedOn: f.filedOn,
    proposal,
  };
}

export function buildPeriodCards(input: CardInputs): PeriodCard[] {
  const due = new Map<string, DueInfo>();
  for (const o of input.obligations) {
    const form = FORM_OF_KIND.get(o.kind);
    if (form === undefined || o.periodStart === null) continue;
    due.set(`${form}|${o.periodStart}`, { dueDate: o.dueDate, state: o.state });
  }

  const active = input.filings.filter((f) => f.state !== 'superseded');
  const cards: PeriodCard[] = [];
  const haveFiling = new Set<string>();
  for (const f of active) {
    if (!isForm(f.type)) continue; // VAT_WORKBOOK rows produce no card
    haveFiling.add(`${f.type}|${f.periodStart}`);
    const card = filingCard(f, f.type, due);
    if (card !== null) cards.push(card);
  }

  const seen = new Set<string>();
  for (const o of input.obligations) {
    const form = FORM_OF_KIND.get(o.kind);
    if (form === undefined || o.periodStart === null) continue;
    if (o.state !== 'open' && o.state !== 'overdue') continue;
    if (!(o.dueDate < input.today)) continue;
    if (!input.periodsWithEntries.includes(o.periodStart)) continue;
    const key = `${form}|${o.periodStart}`;
    if (haveFiling.has(key) || seen.has(key)) continue;
    seen.add(key);
    cards.push({
      periodStart: o.periodStart,
      periodEnd: o.periodEnd ?? monthEnd(o.periodStart),
      form,
      kind: 'overdue_missing',
      filingId: null,
      bundleId: null,
      amountDue: null,
      dueDate: o.dueDate,
      obligationState: o.state,
      reasons: [],
      filedOn: null,
      proposal: null,
    });
  }

  const formIndex = (f: Form): number => FORMS.indexOf(f);
  cards.sort((a, b) => {
    if (a.periodStart !== b.periodStart) return a.periodStart < b.periodStart ? 1 : -1;
    return formIndex(a.form) - formIndex(b.form);
  });
  return cards;
}

export function parseYear(raw: string | null, today: string): number | null {
  const current = Number.parseInt(today.slice(0, 4), 10);
  if (raw === null) return current;
  if (!/^\d{4}$/.test(raw)) return null;
  const year = Number.parseInt(raw, 10);
  return year >= 2000 && year <= 2100 ? year : current;
}

export function parseGenerateBody(
  body: unknown,
): { kind: GenerateKind; discoveredOn?: string } | null {
  if (typeof body !== 'object' || body === null || !('kind' in body)) return null;
  const kind = body.kind;
  if (!isGenerateKind(kind)) return null;
  const discoveredOn = 'discoveredOn' in body ? body.discoveredOn : undefined;
  if (discoveredOn === undefined || discoveredOn === null) return { kind };
  if (!isIsoDate(discoveredOn)) return null;
  return { kind, discoveredOn };
}

export function parsePeriodStart(raw: string): string | null {
  return PERIOD_START_RE.test(raw) ? raw : null;
}

export function parseForm(raw: string | null): 'DPHDP3' | 'DPHKH1' | 'DPHSHV' | null {
  if (raw === null) return 'DPHDP3';
  return isForm(raw) ? raw : null;
}

// ---------------------------------------------------------------------------------------------
// Loaders (org-scoped Supabase reads under the user's RLS). Kept small; numerics are cast to text
// in the select so money never passes through a JSON number.
// ---------------------------------------------------------------------------------------------

const PAGE = 1000;
const ID_CHUNK = 200;

interface FilingDbRow {
  readonly id: string;
  readonly type: string;
  readonly kind: string;
  readonly origin: string;
  readonly period_start: string;
  readonly period_end: string;
  readonly state: string;
  readonly bundle_id: string | null;
  readonly xsd_valid: boolean | null;
  readonly totals: Record<string, unknown> | null;
  readonly simple_check: Record<string, unknown> | null;
  readonly filed_on: string | null;
  readonly amends_filing_id: string | null;
  readonly discovered_on: string | null;
}

interface ObligationDbRow {
  readonly kind: string;
  readonly period_start: string | null;
  readonly period_end: string | null;
  readonly due_date: string;
  readonly state: string;
  readonly amount_estimate: string | null;
}

interface ProfileDbRow {
  readonly vat_status: string;
  readonly vat_period: string | null;
}

const OBLIGATION_KINDS = ['vat_return', 'kh', 'sh', 'vat_payment', 'vat_amendment', 'kh_nasledne'];

export async function loadPeriodCardInputs(
  supabase: SupabaseClient,
  orgId: string,
  year: number,
  today: string,
): Promise<CardInputs | null> {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const profile = await supabase
    .from('taxpayer_profiles')
    .select('vat_status,vat_period')
    .eq('org_id', orgId)
    .lte('valid_from', to)
    .order('valid_from', { ascending: false })
    .limit(1)
    .maybeSingle<ProfileDbRow>();
  if (profile.error) throw new Error('profile_load_failed');
  const status = profile.data?.vat_status;
  if (status !== 'platce' && status !== 'identifikovana_osoba') return null;

  const filings = await supabase
    .from('filings')
    .select(
      'id,type,kind,origin,period_start,period_end,state,bundle_id,xsd_valid,totals,simple_check,filed_on,amends_filing_id,discovered_on',
    )
    .eq('org_id', orgId)
    .gte('period_start', from)
    .lte('period_start', to);
  if (filings.error) throw new Error('filing_load_failed');

  const obligations = await supabase
    .from('obligations')
    .select('kind,period_start,period_end,due_date,state,amount_estimate:amount_estimate::text')
    .eq('org_id', orgId)
    .in('kind', OBLIGATION_KINDS)
    .gte('period_start', from)
    .lte('period_start', to);
  if (obligations.error) throw new Error('obligation_load_failed');

  const periods = new Set<string>();
  for (let offset = 0; ; offset += PAGE) {
    const page = await supabase
      .from('vat_ledger_entries')
      .select('period_start')
      .eq('org_id', orgId)
      .gte('period_start', from)
      .lte('period_start', to)
      .order('id')
      .range(offset, offset + PAGE - 1);
    if (page.error) throw new Error('ledger_load_failed');
    const rows = (page.data ?? []) as { period_start: string }[];
    for (const r of rows) periods.add(r.period_start);
    if (rows.length < PAGE) break;
  }

  return {
    status,
    today,
    filings: ((filings.data ?? []) as FilingDbRow[]).map((r) => ({
      id: r.id,
      type: r.type,
      kind: r.kind,
      origin: r.origin,
      periodStart: r.period_start,
      periodEnd: r.period_end,
      state: r.state,
      bundleId: r.bundle_id,
      xsdValid: r.xsd_valid,
      totals: r.totals ?? {},
      simpleCheck: r.simple_check ?? {},
      filedOn: r.filed_on,
      amendsFilingId: r.amends_filing_id,
      discoveredOn: r.discovered_on,
    })),
    obligations: ((obligations.data ?? []) as ObligationDbRow[]).map((o) => ({
      kind: o.kind,
      periodStart: o.period_start,
      periodEnd: o.period_end,
      dueDate: o.due_date,
      state: o.state,
      amountEstimate: o.amount_estimate,
    })),
    periodsWithEntries: [...periods].sort(),
  };
}

interface EntryDbRow {
  readonly period_start: string;
  readonly period_end: string;
  readonly vat_point_date: string;
  readonly vat_point_rule: string;
  readonly document_id: string;
  readonly line_id: string | null;
  readonly vat_treatment: string;
  readonly vat_rate_type: string;
  readonly vat_rate_pct: string;
  readonly base_czk: string;
  readonly vat_czk: string;
  readonly deduction_pct: string;
  readonly currency: string;
  readonly base_foreign: string | null;
  readonly fx_rate: string | null;
  readonly fx_amount: number | null;
  readonly fx_rate_date: string | null;
  readonly dphdp3_rows: string[];
  readonly kh_section: string | null;
  readonly kh_document_total_czk: string | null;
  readonly shv_code: number | null;
  readonly counterparty_vat_id: string | null;
  readonly evidence_number: string | null;
}

const ENTRY_COLUMNS = [
  'period_start',
  'period_end',
  'vat_point_date',
  'vat_point_rule',
  'document_id',
  'line_id',
  'vat_treatment',
  'vat_rate_type',
  'vat_rate_pct:vat_rate_pct::text',
  'base_czk:base_czk::text',
  'vat_czk:vat_czk::text',
  'deduction_pct:deduction_pct::text',
  'currency',
  'base_foreign:base_foreign::text',
  'fx_rate:fx_rate::text',
  'fx_amount',
  'fx_rate_date',
  'dphdp3_rows',
  'kh_section',
  'kh_document_total_czk:kh_document_total_czk::text',
  'shv_code',
  'counterparty_vat_id',
  'evidence_number',
].join(',');

function entryOf(r: EntryDbRow): PeriodEntryRow {
  return {
    periodStart: r.period_start,
    periodEnd: r.period_end,
    vatPointDate: r.vat_point_date,
    vatPointRule: r.vat_point_rule,
    lineId: r.line_id,
    vatTreatment: r.vat_treatment,
    vatRateType: r.vat_rate_type,
    vatRatePct: r.vat_rate_pct,
    baseCzk: r.base_czk,
    vatCzk: r.vat_czk,
    deductionPct: r.deduction_pct,
    currency: r.currency,
    baseForeign: r.base_foreign,
    fxRate: r.fx_rate,
    fxAmount: r.fx_amount,
    fxRateDate: r.fx_rate_date,
    dphdp3Rows: r.dphdp3_rows,
    khSection: r.kh_section,
    khDocumentTotalCzk: r.kh_document_total_czk,
    shvCode: r.shv_code,
    counterpartyVatId: r.counterparty_vat_id,
    evidenceNumber: r.evidence_number,
    documentId: r.document_id,
    documentRevision: 0,
    buildVersion: '0',
  };
}

interface DocMetaDbRow {
  readonly id: string;
  readonly document_number: string | null;
  readonly duzp: string | null;
  readonly vat_point_date: string | null;
  readonly partner: { name: string | null; country: string | null } | null;
}

export interface PreviewInputs {
  readonly status: 'platce' | 'identifikovana_osoba';
  readonly periodStart: string;
  readonly entries: readonly PeriodEntryRow[];
  readonly docs: readonly DocMetaDbRow[];
}

/** The period's ledger entries with document and partner meta; null when the period has no entries or no VAT status. */
export async function loadPreviewInputs(
  supabase: SupabaseClient,
  orgId: string,
  periodStart: string,
): Promise<PreviewInputs | null> {
  const profile = await supabase
    .from('taxpayer_profiles')
    .select('vat_status,vat_period')
    .eq('org_id', orgId)
    .lte('valid_from', periodStart)
    .order('valid_from', { ascending: false })
    .limit(1)
    .maybeSingle<ProfileDbRow>();
  if (profile.error) throw new Error('profile_load_failed');
  const status = profile.data?.vat_status;
  if (status !== 'platce' && status !== 'identifikovana_osoba') return null;

  const entries: PeriodEntryRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await supabase
      .from('vat_ledger_entries')
      .select(ENTRY_COLUMNS)
      .eq('org_id', orgId)
      .eq('period_start', periodStart)
      .order('document_id')
      .order('id')
      .range(offset, offset + PAGE - 1);
    if (page.error) throw new Error('ledger_load_failed');
    const rows = (page.data ?? []) as unknown as EntryDbRow[];
    entries.push(...rows.map(entryOf));
    if (rows.length < PAGE) break;
  }
  if (entries.length === 0) return null;

  const ids = [...new Set(entries.map((e) => e.documentId))];
  const docs: DocMetaDbRow[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const res = await supabase
      .from('documents')
      .select('id,document_number,duzp,vat_point_date,partner:partners(name,country)')
      .eq('org_id', orgId)
      .in('id', ids.slice(i, i + ID_CHUNK));
    if (res.error) throw new Error('document_load_failed');
    docs.push(...((res.data ?? []) as unknown as DocMetaDbRow[]));
  }
  return { status, periodStart, entries, docs };
}

function monthsOf(entries: readonly VatLedgerEntryDraft[], start: LegalDate): LegalDate[] {
  const end = entries.reduce<string>((m, e) => (e.periodEnd > m ? e.periodEnd : m), start);
  const out: LegalDate[] = [];
  for (let m = start; m <= end; m = monthAfter(m)) out.push(m);
  return out;
}

function mergeShv(months: readonly ShvComputation[], start: LegalDate): ShvComputation | null {
  const first = months[0];
  if (first === undefined) return null;
  const rows: ShvRow[] = [];
  let total = Money.zero('CZK');
  for (const m of months) {
    rows.push(...m.rows);
    total = total.add(m.total);
  }
  return { monthStart: start, rows, total };
}

/** Pure: computes the preview of one form from loaded rows (the same pure domain code the worker runs). */
export function computePreview(
  form: 'DPHDP3' | 'DPHKH1' | 'DPHSHV',
  input: PreviewInputs,
): PeriodPreview {
  const rules = createCzRules();
  const start = legalDate(input.periodStart, 'period_start');
  const drafts = input.entries.map(entryRowToDraft);
  const dp3 = computeDphdp3(drafts, input.status, rules, start);
  const meta = new Map<string, PreviewDocumentMeta>(
    input.docs.map((d) => [
      d.id,
      { partnerName: d.partner?.name ?? null, documentNumber: d.document_number },
    ]),
  );
  const byId = new Map(input.docs.map((d) => [d.id, d] as const));
  const lookup: KhDocumentLookup = (documentId) => {
    const d = byId.get(documentId);
    if (d === undefined) return undefined;
    const date = d.duzp ?? d.vat_point_date;
    return {
      duzp: date === null ? null : legalDate(date, 'documents.duzp'),
      partnerCountry: d.partner?.country ?? null,
    };
  };
  const payer = input.status === 'platce';
  const kh = payer ? computeKh(drafts, dp3, lookup) : null;
  const shv = payer
    ? mergeShv(
        monthsOf(drafts, start)
          .map((m) => computeShv(drafts, rules, m))
          .filter((s) => s.rows.length > 0),
        start,
      )
    : null;
  return buildPeriodPreview(form, drafts, meta, dp3, kh, shv);
}
