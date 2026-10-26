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
