import { ledgerHashOf } from '@shoebox/db';
import type { MemberRole } from '@shoebox/domain';
import type { createSupabaseServerClient } from '../supabase/server';

type SupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface FilingView {
  readonly id: string;
  readonly type: string;
  readonly kind: string;
  readonly origin: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly state: string;
  readonly bundleId: string | null;
  readonly xsdValid: boolean | null;
  readonly totals: Record<string, unknown>;
  readonly simpleCheck: Record<string, unknown>;
  readonly xmlPath: string | null;
  readonly filedOn: string | null;
  readonly submissionRef: string | null;
  readonly generatedAt: string | null;
}

export type DownloadDecision =
  | {
      readonly ok: true;
      readonly paths: readonly { path: string; name: string }[];
      readonly markDownloaded: boolean;
    }
  | {
      readonly ok: false;
      readonly status: 404 | 409 | 403 | 400;
      readonly error:
        | 'not_found'
        | 'period_changed'
        | 'xsd_invalid'
        | 'not_generated'
        | 'bad_format';
    };

export type MarkFiledDecision =
  | {
      readonly ok: true;
      readonly filedOn: string;
      readonly submissionRef: string | null;
      readonly supersedeFilingId: string | null;
    }
  | {
      readonly ok: false;
      readonly status: 400 | 404 | 409;
      readonly error: 'bad_body' | 'not_found' | 'wrong_state';
    };

export const FILING_WRITE_ROLES: readonly MemberRole[] = ['owner', 'member'];
export const FILING_READ_ROLES: readonly MemberRole[] = ['owner', 'member', 'accountant', 'viewer'];
export const FILING_DOWNLOAD_ROLES: readonly MemberRole[] = ['owner', 'member', 'accountant'];

const DOWNLOADABLE_STATES: readonly string[] = ['generated', 'downloaded', 'marked_filed'];
const BUNDLE_ORDER: readonly string[] = ['DPHDP3', 'DPHKH1', 'DPHSHV'];
const OBLIGATION_KIND: Readonly<Record<string, string>> = {
  DPHDP3: 'vat_return',
  DPHKH1: 'kh',
  DPHSHV: 'sh',
};
const SUBMISSION_REF_MAX = 60;

export function xmlFileName(f: Pick<FilingView, 'type' | 'periodStart' | 'kind'>): string {
  return `${f.type}-${f.periodStart.slice(0, 7)}-${f.kind}.xml`;
}

type Refusal = {
  readonly ok: false;
  readonly status: 403 | 409;
  readonly error: 'period_changed' | 'xsd_invalid' | 'not_generated';
};

/** The checks every downloaded filing must pass: state, XSD validity, and the ledger hash (M05 §4.8, §4.11). */
function refusalFor(f: FilingView, currentLedgerHash: string): Refusal | null {
  if (!DOWNLOADABLE_STATES.includes(f.state))
    return { ok: false, status: 409, error: 'not_generated' };
  if (f.xsdValid !== true) return { ok: false, status: 403, error: 'xsd_invalid' };
  if (f.state !== 'marked_filed' && f.totals.ledgerHash !== currentLedgerHash)
    return { ok: false, status: 409, error: 'period_changed' };
  return null;
}

export function decideDownload(
  filing: FilingView | null,
  bundle: readonly FilingView[],
  currentLedgerHash: string,
  format: string | null,
): DownloadDecision {
  if (filing === null) return { ok: false, status: 404, error: 'not_found' };
  if (format !== 'xml' && format !== 'zip') return { ok: false, status: 400, error: 'bad_format' };
  const refusal = refusalFor(filing, currentLedgerHash);
  if (refusal !== null) return refusal;
  if (format === 'xml') {
    if (filing.xmlPath === null) return { ok: false, status: 409, error: 'not_generated' };
    return {
      ok: true,
      paths: [{ path: filing.xmlPath, name: xmlFileName(filing) }],
      markDownloaded: filing.state === 'generated',
    };
  }
  const members = bundle
    .filter((b) => DOWNLOADABLE_STATES.includes(b.state) && BUNDLE_ORDER.includes(b.type))
    .sort((a, b) => BUNDLE_ORDER.indexOf(a.type) - BUNDLE_ORDER.indexOf(b.type));
  const paths: { path: string; name: string }[] = [];
  for (const member of members) {
    const memberRefusal = refusalFor(member, currentLedgerHash);
    if (memberRefusal !== null) return memberRefusal;
    if (member.xmlPath === null) return { ok: false, status: 409, error: 'not_generated' };
    paths.push({ path: member.xmlPath, name: xmlFileName(member) });
  }
  return { ok: true, paths, markDownloaded: filing.state === 'generated' };
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function decideMarkFiled(
  filing: FilingView | null,
  body: unknown,
  today: string,
  amendsFilingId: string | null,
): MarkFiledDecision {
  if (filing === null) return { ok: false, status: 404, error: 'not_found' };
  const bad: MarkFiledDecision = { ok: false, status: 400, error: 'bad_body' };
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return bad;
  const { filedOn, submissionRef } = body as Record<string, unknown>;
  if (typeof filedOn !== 'string' || !isIsoDate(filedOn)) return bad;
  if (filedOn > today || filedOn < filing.periodEnd) return bad;
  let ref: string | null = null;
  if (submissionRef !== undefined && submissionRef !== null) {
    if (typeof submissionRef !== 'string') return bad;
    const trimmed = submissionRef.trim();
    if (trimmed.length > SUBMISSION_REF_MAX) return bad;
    ref = trimmed === '' ? null : trimmed;
  }
  if (filing.state !== 'generated' && filing.state !== 'downloaded')
    return { ok: false, status: 409, error: 'wrong_state' };
  return {
    ok: true,
    filedOn,
    submissionRef: ref,
    supersedeFilingId: filing.kind === 'opravne' ? amendsFilingId : null,
  };
}

const FILING_COLUMNS =
  'id,type,kind,origin,period_start,period_end,state,bundle_id,xsd_valid,totals,simple_check,xml_path,filed_on,submission_ref,generated_at';

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
  readonly xml_path: string | null;
  readonly filed_on: string | null;
  readonly submission_ref: string | null;
  readonly generated_at: string | null;
}

function viewOf(r: FilingDbRow): FilingView {
  return {
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
    xmlPath: r.xml_path,
    filedOn: r.filed_on,
    submissionRef: r.submission_ref,
    generatedAt: r.generated_at,
  };
}

export async function loadFiling(
  supabase: SupabaseClient,
  orgId: string,
  id: string,
): Promise<FilingView | null> {
  const { data, error } = await supabase
    .from('filings')
    .select(FILING_COLUMNS)
    .eq('org_id', orgId)
    .eq('id', id)
    .maybeSingle<FilingDbRow>();
  if (error) throw new Error('filing_load_failed');
  return data === null ? null : viewOf(data);
}

/** The filing this opravne filing amends (amends_filing_id); null for every other kind. */
export async function loadAmendsFilingId(
  supabase: SupabaseClient,
  orgId: string,
  id: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('filings')
    .select('amends_filing_id')
    .eq('org_id', orgId)
    .eq('id', id)
    .maybeSingle<{ amends_filing_id: string | null }>();
  if (error) throw new Error('filing_load_failed');
  return data?.amends_filing_id ?? null;
}

export async function loadBundle(
  supabase: SupabaseClient,
  orgId: string,
  bundleId: string,
): Promise<FilingView[]> {
  const { data, error } = await supabase
    .from('filings')
    .select(FILING_COLUMNS)
    .eq('org_id', orgId)
    .eq('bundle_id', bundleId);
  if (error) throw new Error('filing_load_failed');
  return ((data ?? []) as FilingDbRow[]).map(viewOf);
}

const LEDGER_PAGE = 1000;

/** Hash of the period's VAT ledger rows; a changed hash means the ledger was rebuilt since the filing was generated. */
export async function currentLedgerHash(
  supabase: SupabaseClient,
  orgId: string,
  periodStart: string,
): Promise<string> {
  const rows: { id: string; document_id: string; build_version: string | number }[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('vat_ledger_entries')
      .select('id,document_id,build_version')
      .eq('org_id', orgId)
      .eq('period_start', periodStart)
      .order('id')
      .range(from, from + LEDGER_PAGE - 1);
    if (error) throw new Error('ledger_load_failed');
    const page = (data ?? []) as typeof rows;
    rows.push(...page);
    if (page.length < LEDGER_PAGE) break;
    from += LEDGER_PAGE;
  }
  return ledgerHashOf(
    rows.map((r) => ({ documentId: r.document_id, buildVersion: String(r.build_version) })),
  );
}

export async function applyMarkFiled(
  supabase: SupabaseClient,
  orgId: string,
  filing: FilingView,
  d: Extract<MarkFiledDecision, { ok: true }>,
  now: Date,
): Promise<void> {
  const at = now.toISOString();
  const marked = await supabase
    .from('filings')
    .update({
      state: 'marked_filed',
      marked_filed_at: at,
      filed_on: d.filedOn,
      submission_ref: d.submissionRef,
    })
    .eq('org_id', orgId)
    .eq('id', filing.id)
    .in('state', ['generated', 'downloaded'])
    .select('id');
  if (marked.error) throw new Error('filing_update_failed');
  if (!marked.data || marked.data.length === 0) throw new Error('filing_state_changed');

  if (d.supersedeFilingId !== null) {
    const superseded = await supabase
      .from('filings')
      .update({ state: 'superseded' })
      .eq('org_id', orgId)
      .eq('id', d.supersedeFilingId);
    if (superseded.error) throw new Error('filing_update_failed');
  }

  const obligationKind = OBLIGATION_KIND[filing.type];
  if (obligationKind !== undefined) {
    const done = await supabase
      .from('obligations')
      .update({ state: 'done', done_at: at, done_source: 'filing' })
      .eq('org_id', orgId)
      .eq('kind', obligationKind)
      .eq('period_start', filing.periodStart);
    if (done.error) throw new Error('obligation_update_failed');
  }
}
