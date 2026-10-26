import { describe, expect, it } from 'vitest';
import { loadPagesView } from '../src/documents/pages-data';

type Result = { data: unknown; error: unknown };

/** A minimal stand-in for the Supabase query builder: every chain resolves to the table's result. */
function fakeSupabase(results: Record<string, Result>) {
  return {
    from(table: string) {
      const result = results[table] ?? { data: null, error: { message: 'no table' } };
      const chain: Record<string, unknown> = {};
      for (const name of ['select', 'eq', 'is', 'order', 'limit']) chain[name] = () => chain;
      chain.maybeSingle = async () => result;
      chain.then = (resolve: (r: Result) => unknown) => Promise.resolve(result).then(resolve);
      return chain;
    },
  } as never;
}

describe('loadPagesView', () => {
  it('lists the pages in order with their file names', async () => {
    const view = await loadPagesView(
      fakeSupabase({
        document_pages: {
          data: [
            { position: 1, file_page: 1, region: '', source_files: { original_filename: 'a.jpg' } },
            {
              position: 2,
              file_page: 3,
              region: 'top',
              source_files: { original_filename: 'scan.pdf' },
            },
          ],
          error: null,
        },
        review_questions: { data: null, error: null },
      }),
      'doc-1',
    );
    expect(view).toEqual({
      pages: [
        { position: 1, fileName: 'a.jpg', filePage: 1, region: '' },
        { position: 2, fileName: 'scan.pdf', filePage: 3, region: 'top' },
      ],
      question: null,
    });
  });

  it('returns the open same-invoice question', async () => {
    const view = await loadPagesView(
      fakeSupabase({
        document_pages: { data: [], error: null },
        review_questions: {
          data: { id: 'q-1', payload: { other_document_id: 'doc-0' } },
          error: null,
        },
      }),
      'doc-1',
    );
    expect(view.question).toEqual({ id: 'q-1', otherDocumentId: 'doc-0' });
  });

  it('shows nothing when a query fails', async () => {
    const view = await loadPagesView(fakeSupabase({}), 'doc-1');
    expect(view).toEqual({ pages: [], question: null });
  });
});
