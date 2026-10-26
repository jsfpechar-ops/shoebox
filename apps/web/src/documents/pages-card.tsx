import { t } from '@shoebox/i18n';
import { Button, Card } from '@shoebox/ui';
import Link from 'next/link';
import { addPageAction, answerSameInvoiceAction, separatePagesAction } from './pages-actions';
import type { JoinCandidate, PagesView } from './pages-data';

/** Pages of a sorted document and the one fix the user may need; nothing when there is nothing to show. */
export function PagesCard({
  documentId,
  view,
  canFix,
  candidates,
}: {
  documentId: string;
  view: PagesView;
  canFix: boolean;
  candidates: readonly JoinCandidate[];
}) {
  const showPages = view.pages.length > 1;
  if (!showPages && view.question === null && !(canFix && candidates.length > 0)) return null;
  return (
    <>
      {view.question !== null ? (
        <Card className="flex flex-col gap-4 p-6">
          <p className="text-body">{t('doc.pages.same_question')}</p>
          <Link href={`/inbox/${view.question.otherDocumentId}`} className="text-body underline">
            {t('doc.pages.open_other')}
          </Link>
          {canFix ? (
            <div className="flex flex-wrap gap-2">
              {(['yes', 'no'] as const).map((answer) => (
                <form key={answer} action={answerSameInvoiceAction}>
                  <input type="hidden" name="id" value={documentId} />
                  <input type="hidden" name="other" value={view.question?.otherDocumentId} />
                  <input type="hidden" name="question" value={view.question?.id} />
                  <input type="hidden" name="answer" value={answer} />
                  <Button type="submit" variant={answer === 'yes' ? 'primary' : 'secondary'}>
                    {t(answer === 'yes' ? 'doc.pages.same_yes' : 'doc.pages.same_no')}
                  </Button>
                </form>
              ))}
            </div>
          ) : null}
        </Card>
      ) : null}
      {showPages ? (
        <Card className="flex flex-col gap-3 p-6">
          <h2 className="text-card-title">{t('doc.pages.title', { count: view.pages.length })}</h2>
          <ol className="flex flex-col gap-1">
            {view.pages.map((page) => (
              <li key={page.position} className="text-body">
                {t('doc.pages.line', {
                  file: page.fileName ?? '',
                  page: page.filePage,
                })}
              </li>
            ))}
          </ol>
          {canFix ? (
            <form action={separatePagesAction}>
              <input type="hidden" name="id" value={documentId} />
              <Button type="submit" variant="link">
                {t('doc.pages.separate')}
              </Button>
            </form>
          ) : null}
        </Card>
      ) : null}
      {canFix && candidates.length > 0 ? (
        <details className="text-body">
          <summary className="cursor-pointer underline">{t('doc.pages.add')}</summary>
          <form action={addPageAction} className="mt-3 flex flex-col gap-2">
            <input type="hidden" name="id" value={documentId} />
            <label htmlFor="add-page-other" className="text-body">
              {t('doc.pages.add_label')}
            </label>
            <select
              id="add-page-other"
              name="other"
              required
              className="rounded-control border border-input bg-card p-2 text-body"
            >
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label === '' ? t('doc.pages.add_unnamed') : c.label}
                </option>
              ))}
            </select>
            <div>
              <Button type="submit" variant="secondary">
                {t('doc.pages.add_button')}
              </Button>
            </div>
          </form>
        </details>
      ) : null}
    </>
  );
}
