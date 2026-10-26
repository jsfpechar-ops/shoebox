import { t } from '@shoebox/i18n';
import { Button, Card } from '@shoebox/ui';
import Link from 'next/link';
import { answerSameInvoiceAction, separatePagesAction } from './pages-actions';
import type { PagesView } from './pages-data';

/** Pages of a sorted document and the one fix the user may need; nothing when there is nothing to show. */
export function PagesCard({
  documentId,
  view,
  canFix,
}: {
  documentId: string;
  view: PagesView;
  canFix: boolean;
}) {
  const showPages = view.pages.length > 1;
  if (!showPages && view.question === null) return null;
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
    </>
  );
}
