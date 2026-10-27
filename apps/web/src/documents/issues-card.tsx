'use client';

import { t } from '@shoebox/i18n';
import { Button, Card } from '@shoebox/ui';
import { answerIssueAction, confirmDocumentAction } from './confirm-actions';
import { type IssueQuestion, OPEN_FIX_EVENT } from './issue-questions';
import { moveToTrashAction } from './trash-actions';

/** "Is this right?": each blocking issue as a question with one-tap answers, then one confirm button. */
export function IssuesCard({
  documentId,
  questions,
}: {
  documentId: string;
  questions: readonly IssueQuestion[];
}) {
  return (
    <Card className="flex flex-col gap-4 p-6">
      <h2 className="text-card-title">{t('doc.issue.title')}</h2>
      {questions.length > 0 ? (
        <ul className="flex flex-col gap-4">
          {questions.map((question) => (
            <li key={question.id ?? question.text} className="flex flex-col gap-2">
              <p className="text-body">{t(question.text, question.params)}</p>
              <div className="flex flex-wrap items-center gap-2">
                {question.answers.map((answer) =>
                  answer.action === 'fix' ? (
                    <Button
                      key={answer.label}
                      type="button"
                      variant="secondary"
                      onClick={() =>
                        window.dispatchEvent(
                          new CustomEvent(OPEN_FIX_EVENT, { detail: answer.editKey ?? null }),
                        )
                      }
                    >
                      {t(answer.label)}
                    </Button>
                  ) : answer.action === 'trash' ? (
                    <form key={answer.label} action={moveToTrashAction}>
                      <input type="hidden" name="id" value={documentId} />
                      <Button type="submit" variant="secondary">
                        {t(answer.label)}
                      </Button>
                    </form>
                  ) : (
                    <form key={answer.label} action={answerIssueAction}>
                      <input type="hidden" name="id" value={documentId} />
                      <input type="hidden" name="issueId" value={question.id ?? ''} />
                      <Button type="submit" variant="secondary" disabled={question.id === null}>
                        {t(answer.label)}
                      </Button>
                    </form>
                  ),
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <form action={confirmDocumentAction} className="flex flex-col gap-2">
        <input type="hidden" name="id" value={documentId} />
        <Button type="submit">{t('doc.issue.confirm')}</Button>
        <p className="text-meta text-muted-foreground">{t('doc.issue.confirm_help')}</p>
      </form>
    </Card>
  );
}
