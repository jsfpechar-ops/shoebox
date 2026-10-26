import type { LegalDate } from '@shoebox/domain';
import type { createSupabaseServerClient } from '../supabase/server';
import { inboxRowOf } from './inbox-data';
import { buildDeck, parseQuestionPayload, type ReviewCard } from './review-deck';

type SupabaseLike = Awaited<ReturnType<typeof createSupabaseServerClient>>;

const CARD_DOCUMENT_COLUMNS =
  'id, status, class, currency, total_gross, issue_date, created_at, partner_snapshot, source_files(original_filename)';

/** The unanswered questions and the documents with open blocking checks, as one deck. Any error gives an empty deck. */
export async function loadDeck(supabase: SupabaseLike, orgId: string): Promise<ReviewCard[]> {
  try {
    const [questionRes, checkRes, documentRes] = await Promise.all([
      supabase
        .from('review_questions')
        .select('id, document_id, kind, payload, created_at')
        .eq('org_id', orgId)
        .is('answered_at', null)
        .order('created_at')
        .limit(200),
      supabase
        .from('validation_results')
        .select('document_id')
        .eq('org_id', orgId)
        .eq('state', 'open')
        .eq('severity', 'blocking')
        .limit(1000),
      supabase
        .from('documents')
        .select('id, created_at')
        .eq('org_id', orgId)
        .eq('status', 'needs_review')
        .is('deleted_at', null),
    ]);
    if (questionRes.error || checkRes.error || documentRes.error) return [];

    const questions: Extract<ReviewCard, { type: 'question' }>[] = [];
    for (const raw of Array.isArray(questionRes.data) ? questionRes.data : []) {
      const row = raw as Record<string, unknown>;
      const payload = parseQuestionPayload(row.payload);
      if (payload === null || typeof row.id !== 'string' || typeof row.created_at !== 'string')
        continue;
      questions.push({
        type: 'question',
        id: row.id,
        documentId: typeof row.document_id === 'string' ? row.document_id : null,
        kind: typeof row.kind === 'string' ? row.kind : '',
        payload,
        createdAt: row.created_at,
      });
    }

    const blockingByDocument = new Map<string, number>();
    for (const raw of Array.isArray(checkRes.data) ? checkRes.data : []) {
      const documentId = (raw as Record<string, unknown>).document_id;
      if (typeof documentId === 'string') {
        blockingByDocument.set(documentId, (blockingByDocument.get(documentId) ?? 0) + 1);
      }
    }

    const documents: Extract<ReviewCard, { type: 'document' }>[] = [];
    for (const raw of Array.isArray(documentRes.data) ? documentRes.data : []) {
      const row = raw as Record<string, unknown>;
      if (typeof row.id !== 'string' || typeof row.created_at !== 'string') continue;
      const blocking = blockingByDocument.get(row.id) ?? 0;
      if (blocking > 0) {
        documents.push({
          type: 'document',
          documentId: row.id,
          blocking,
          createdAt: row.created_at,
        });
      }
    }

    return buildDeck(questions, documents);
  } catch {
    return [];
  }
}

/** The title, total and issue date of one document for a review card; null when missing. */
export async function loadCardDocument(
  supabase: SupabaseLike,
  orgId: string,
  id: string,
): Promise<{
  title: string | null;
  total: { value: string; currency: string } | null;
  issueDate: LegalDate | null;
} | null> {
  try {
    const { data, error } = await supabase
      .from('documents')
      .select(CARD_DOCUMENT_COLUMNS)
      .eq('id', id)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .maybeSingle();
    if (error || !data) return null;
    const row = inboxRowOf(data);
    if (row === null) return null;
    return { title: row.title, total: row.total, issueDate: row.issueDate };
  } catch {
    return null;
  }
}
