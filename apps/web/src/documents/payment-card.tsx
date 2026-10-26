'use client';

import type { LegalDate } from '@shoebox/domain';
import { t } from '@shoebox/i18n';
import { Button, Card, LegalDateText, MoneyText } from '@shoebox/ui';
import { useActionState } from 'react';
import { AutoRefresh } from './auto-refresh';
import type { PaymentView } from './payment';
import { decidePaymentAction, type PaymentDecisionState } from './payment-actions';

const idle: PaymentDecisionState = { error: null, done: false };

/** Is the invoice paid? When the matcher found a likely payment it was not sure of, one question and two buttons. */
export function PaymentCard({
  documentId,
  view,
  canAct,
}: {
  documentId: string;
  view: PaymentView;
  canAct: boolean;
}) {
  const [state, action, pending] = useActionState(decidePaymentAction, idle);
  return (
    <Card className="flex flex-col gap-3 p-6">
      <h2 className="text-card-title">{t('doc.payment.title')}</h2>
      {view.paidAt !== null ? (
        <p className="text-body">
          {t('doc.payment.paid')} <LegalDateText date={view.paidAt as LegalDate} />
        </p>
      ) : state.done ? (
        <>
          <p className="text-body">{t('doc.payment.saved')}</p>
          <AutoRefresh active />
        </>
      ) : (
        view.found.map((f) => (
          <div key={f.suggestionId} className="flex flex-col gap-3">
            <p className="text-body">{t('doc.payment.found')}</p>
            <p className="text-body">
              <MoneyText value={f.amount} currency={f.currency} />{' '}
              <LegalDateText date={f.bookedOn as LegalDate} />{' '}
              {f.counterparty ?? t('doc.payment.unknown_counterparty')}
            </p>
            {canAct ? (
              <form action={action} className="flex flex-wrap gap-2">
                <input type="hidden" name="id" value={f.suggestionId} />
                <input type="hidden" name="document" value={documentId} />
                <Button type="submit" name="decision" value="accept" disabled={pending}>
                  {t('doc.payment.yes')}
                </Button>
                <Button
                  type="submit"
                  name="decision"
                  value="reject"
                  variant="secondary"
                  disabled={pending}
                >
                  {t('doc.payment.no')}
                </Button>
              </form>
            ) : null}
          </div>
        ))
      )}
      {state.error ? (
        <p role="alert" className="text-body text-destructive">
          {t(state.error)}
        </p>
      ) : null}
    </Card>
  );
}
