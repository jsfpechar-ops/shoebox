'use client';

import type { LegalDate } from '@shoebox/domain';
import { t } from '@shoebox/i18n';
import { Button, LegalDateText, MoneyText } from '@shoebox/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { answerQuestionAction } from './review-actions';
import { keyAction, optionText, type ReviewCard as ReviewCardData } from './review-deck';

export interface ReviewCardDocument {
  title: string | null;
  total: { value: string; currency: string } | null;
  issueDate: LegalDate | null;
}

/** The request text of a `mailto:` URL (its decoded body), '' when it has none. */
function mailtoBody(mailto: string): string {
  const query = mailto.split('?')[1] ?? '';
  const raw = new URLSearchParams(query.replace(/\+/g, '%2B')).get('body');
  return raw ?? '';
}

interface ReviewCardProps {
  card: ReviewCardData;
  doc: ReviewCardDocument | null;
  position: number;
  total: number;
  skip: number;
}

/** One card of the review deck. Single-key shortcuts work only while the card has focus (WCAG 2.1.4). */
export function ReviewCard({ card, doc, position, total, skip }: ReviewCardProps) {
  const router = useRouter();
  const sectionRef = useRef<HTMLElement>(null);
  const formRefs = useRef<(HTMLFormElement | null)[]>([]);
  const headingId = useId();
  const [copied, setCopied] = useState(false);
  const suggestedOption =
    card.type === 'question'
      ? card.payload.options.find((option) => option.value === card.payload.suggested)
      : undefined;

  useEffect(() => {
    sectionRef.current?.focus();
  }, []);

  const mailto =
    card.type === 'question' && card.kind === 'missing_document'
      ? card.payload.params.mailto
      : undefined;
  const copyRequest = async () => {
    if (typeof mailto !== 'string') return;
    try {
      await navigator.clipboard.writeText(mailtoBody(mailto));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const action = keyAction(event.key);
    if (action === null) return;
    event.preventDefault();
    if (typeof action === 'object') {
      if (card.type !== 'question' || action.answer >= card.payload.options.length) return;
      formRefs.current[action.answer]?.requestSubmit();
      return;
    }
    if (action === 'skip') router.push(`/inbox/review?skip=${skip + 1}`);
    if (action === 'open' && card.documentId) router.push(`/inbox/${card.documentId}`);
    if (action === 'exit') router.push('/inbox');
  };

  const documentLine = doc !== null && (
    <p className="text-body">
      {doc.title ?? t('inbox.row.unknown_supplier')}
      {doc.total !== null && (
        <>
          {' · '}
          <MoneyText value={doc.total.value} currency={doc.total.currency} />
        </>
      )}
      {doc.issueDate !== null && (
        <>
          {' · '}
          <LegalDateText date={doc.issueDate} />
        </>
      )}
    </p>
  );

  return (
    <section
      ref={sectionRef}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the card takes focus so the single-key shortcuts work (WCAG 2.1.4)
      tabIndex={0}
      aria-labelledby={headingId}
      onKeyDown={onKeyDown}
      className="flex flex-col gap-6 outline-none"
    >
      <p aria-live="polite" className="text-body">
        {t('review.progress', { n: position, total })}
      </p>
      {documentLine}

      {card.type === 'question' ? (
        <>
          <h2 id={headingId} className="text-title">
            {t(
              card.payload.question,
              card.kind === 'missing_document' && card.payload.params.counterparty === ''
                ? {
                    ...card.payload.params,
                    counterparty: t('review.missing_document.unknown_counterparty'),
                  }
                : card.payload.params,
            )}
          </h2>
          <div className="flex flex-col gap-3">
            {card.payload.options.map((option, index) => {
              const suggested = option.value === card.payload.suggested;
              return (
                <form
                  key={option.value}
                  action={answerQuestionAction}
                  ref={(element) => {
                    formRefs.current[index] = element;
                  }}
                >
                  <input type="hidden" name="id" value={card.id} />
                  <input type="hidden" name="value" value={option.value} />
                  <Button
                    type="submit"
                    variant={suggested ? 'primary' : 'secondary'}
                    className="w-full"
                  >
                    {`[${index + 1}] ${optionText(option)}`}
                  </Button>
                </form>
              );
            })}
          </div>
          {typeof mailto === 'string' && (
            <div className="flex flex-wrap items-center gap-3">
              <a href={mailto} className="text-body underline">
                {t('review.missing_document.ask_supplier')}
              </a>
              <Button variant="secondary" onClick={() => void copyRequest()}>
                {copied ? t('review.missing_document.copied') : t('review.missing_document.copy')}
              </Button>
            </div>
          )}
          {suggestedOption !== undefined && (
            <p className="text-body">
              {t('review.suggested', { label: optionText(suggestedOption) })}
            </p>
          )}
        </>
      ) : (
        <h2 id={headingId} className="text-title">
          {t('review.doc_card')}
        </h2>
      )}

      <footer className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={() => router.push(`/inbox/review?skip=${skip + 1}`)}>
          {t('review.skip')}
        </Button>
        {card.documentId !== null && (
          <Link href={`/inbox/${card.documentId}`} className="text-body underline">
            {t('review.open')}
          </Link>
        )}
        <Link href="/inbox" className="text-body underline">
          {t('review.exit')}
        </Link>
      </footer>
      <p className="text-body">{t('review.keys')}</p>
    </section>
  );
}
