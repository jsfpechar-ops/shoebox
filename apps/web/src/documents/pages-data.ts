import type { createSupabaseServerClient } from '../supabase/server';

type SupabaseLike = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface PageLine {
  readonly position: number;
  readonly fileName: string | null;
  readonly filePage: number;
  readonly region: string;
}

export interface PagesView {
  readonly pages: readonly PageLine[];
  /** An open same_invoice question on this document, or null. */
  readonly question: { readonly id: string; readonly otherDocumentId: string } | null;
}

interface PageRow {
  readonly position: number;
  readonly file_page: number;
  readonly region: string;
  readonly source_files: { readonly original_filename: string } | null;
}

interface QuestionRow {
  readonly id: string;
  readonly payload: { readonly other_document_id?: unknown } | null;
}

const EMPTY: PagesView = { pages: [], question: null };

/**
 * The document's pages (document_pages with source_files(original_filename), by position) and its
 * open same_invoice question (review_questions: document_id, kind 'same_invoice', answered_at null,
 * the oldest one; payload.other_document_id must be a string, else no question).
 * Any query error → { pages: [], question: null }.
 */
export async function loadPagesView(
  supabase: SupabaseLike,
  documentId: string,
): Promise<PagesView> {
  const pagesResult = await supabase
    .from('document_pages')
    .select('position, file_page, region, source_files(original_filename)')
    .eq('document_id', documentId)
    .order('position', { ascending: true });
  const questionResult = await supabase
    .from('review_questions')
    .select('id, payload')
    .eq('document_id', documentId)
    .eq('kind', 'same_invoice')
    .is('answered_at', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (pagesResult.error || questionResult.error) return EMPTY;

  const rows = (pagesResult.data ?? []) as unknown as PageRow[];
  const pages: PageLine[] = rows.map((row) => ({
    position: row.position,
    fileName: row.source_files?.original_filename ?? null,
    filePage: row.file_page,
    region: row.region,
  }));

  const question = (questionResult.data ?? null) as QuestionRow | null;
  const other = question?.payload?.other_document_id;
  const openQuestion =
    question !== null && typeof other === 'string'
      ? { id: question.id, otherDocumentId: other }
      : null;

  return { pages, question: openQuestion };
}

export interface JoinCandidate {
  readonly id: string;
  readonly label: string; // supplier name, else the file name, else the received date
}

interface CandidateRow {
  readonly id: string;
  readonly partner_snapshot: { readonly name?: unknown } | null;
  readonly received_date: string | null;
  readonly source_files: { readonly original_filename?: unknown } | null;
}

/**
 * Up to 20 other documents of the org to join into this one: not deleted, not finalized, not this
 * one, newest first (documents: id, partner_snapshot, received_date, created_at,
 * source_files(original_filename)). A query error → [].
 */
export async function loadJoinCandidates(
  supabase: SupabaseLike,
  orgId: string,
  documentId: string,
): Promise<JoinCandidate[]> {
  const result = await supabase
    .from('documents')
    .select('id, partner_snapshot, received_date, source_files(original_filename)')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .neq('status', 'finalized')
    .neq('id', documentId)
    .order('created_at', { ascending: false })
    .limit(20);
  if (result.error) return [];

  const rows = (result.data ?? []) as unknown as CandidateRow[];
  return rows.map((row) => {
    const name = row.partner_snapshot?.name;
    const file = row.source_files?.original_filename;
    let label = row.received_date ?? '';
    if (typeof file === 'string' && file !== '') label = file;
    if (typeof name === 'string' && name !== '') label = name;
    return { id: row.id, label };
  });
}
