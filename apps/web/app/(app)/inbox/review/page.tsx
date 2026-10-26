import { t } from '@shoebox/i18n';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireActiveRole } from '../../../../src/auth/org-context';
import { ReviewCard } from '../../../../src/documents/review-card';
import { loadCardDocument, loadDeck } from '../../../../src/documents/review-data';
import { cardAt } from '../../../../src/documents/review-deck';
import { createSupabaseServerClient } from '../../../../src/supabase/server';

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const skipParam = typeof raw.skip === 'string' ? Number.parseInt(raw.skip, 10) : 0;
  const skip = Number.isInteger(skipParam) && skipParam >= 0 ? skipParam : 0;
  const failed = raw.error === '1';

  const auth = await requireActiveRole(['owner', 'member']);
  if (!auth.ok) redirect('/inbox');

  const supabase = await createSupabaseServerClient();
  const deck = await loadDeck(supabase, auth.orgId);
  const card = cardAt(deck, skip);

  if (card === null) {
    return (
      <div className="flex flex-col gap-6">
        {failed && (
          <p role="alert" className="text-body">
            {t('review.error')}
          </p>
        )}
        <h1 className="text-title">{t('review.done.title')}</h1>
        <Link href="/inbox" className="text-body underline">
          {t('review.done.back')}
        </Link>
      </div>
    );
  }

  const doc =
    card.documentId === null ? null : await loadCardDocument(supabase, auth.orgId, card.documentId);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="sr-only">{t('review.title')}</h1>
      {failed && (
        <p role="alert" className="text-body">
          {t('review.error')}
        </p>
      )}
      <ReviewCard
        key={card.type === 'question' ? card.id : card.documentId}
        card={card}
        doc={doc}
        position={skip + 1}
        total={deck.length}
        skip={skip}
      />
    </div>
  );
}
