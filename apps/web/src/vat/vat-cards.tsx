import { pragueToday } from '@shoebox/domain';
import { t } from '@shoebox/i18n';
import { focusRing } from '@shoebox/ui';
import Link from 'next/link';
import { DownloadButton } from '../files/download-button';
import { HelpTip } from '../overview/help-tip';
import type { VatAction, VatCardView } from './card-view';
import { MarkFiledForm, PrepareButton, WorkbookButton } from './vat-actions';

const textLink = `${focusRing} inline-flex min-h-11 items-center rounded-control px-1 text-body text-foreground underline`;

const TONE_CLASS: Record<VatCardView['tone'], string> = {
  done: 'border-border bg-muted',
  ready: 'border-border bg-card',
  todo: 'border-border bg-card',
  warn: 'border-warning bg-card',
};

export function VatActionView({
  action,
  canWrite,
  today,
}: {
  action: VatAction;
  canWrite: boolean;
  today: string;
}) {
  switch (action.kind) {
    case 'open':
      return (
        <Link href={action.href} className={textLink}>
          {t('vat.action.open')}
        </Link>
      );
    case 'download':
      return (
        <DownloadButton
          href={action.href}
          label={t(
            action.label === 'zip'
              ? 'vat.action.download_zip'
              : action.label === 'xlsx'
                ? 'vat.action.download_xlsx'
                : 'vat.action.download_xml',
          )}
        />
      );
    case 'prepare':
      return canWrite ? (
        <PrepareButton periodStart={action.periodStart} filingKind={action.filingKind} />
      ) : null;
    case 'workbook':
      return canWrite ? <WorkbookButton periodStart={action.periodStart} /> : null;
    case 'mark_filed':
      return canWrite ? (
        <details>
          <summary className={textLink}>{t('vat.mark_filed.open')}</summary>
          <div className="pt-3">
            <MarkFiledForm filingId={action.filingId} today={today} />
          </div>
        </details>
      ) : null;
  }
}

/** The VAT cards on Přehled: one per period, in plain words. */
export function VatCards({
  views,
  canWrite,
}: {
  views: readonly VatCardView[];
  canWrite: boolean;
}) {
  if (views.length === 0) return null;
  const today = pragueToday({ now: () => Date.now() });
  return (
    <section aria-labelledby="vat-title" className="grid gap-4">
      <h2 id="vat-title" className="flex items-center gap-2 text-card-title">
        {t('vat.section.title')}
        <HelpTip term={t('vat.help.term')} text={t('vat.help.text')} />
      </h2>
      {views.map((view) => (
        <article
          key={view.periodStart}
          className={`grid gap-3 rounded-card border p-6 text-foreground ${TONE_CLASS[view.tone]}`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-card-title">{view.title}</h3>
            <span className="rounded-control border border-border px-2 text-body">
              {t(`vat.tone.${view.tone}`)}
            </span>
          </div>
          {view.due === null ? null : <p className="text-body">{view.due}</p>}
          <p className="text-body">{view.body}</p>
          {view.reasons.length > 0 ? (
            <ul className="list-disc pl-6 text-body">
              {view.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap items-start gap-3">
            {view.actions.map((action) => (
              <VatActionView
                key={`${action.kind}-${action.kind === 'mark_filed' ? action.filingId : ''}`}
                action={action}
                canWrite={canWrite}
                today={today}
              />
            ))}
          </div>
        </article>
      ))}
      <p className="text-body text-muted-foreground">{t('vat.disclaimer')}</p>
    </section>
  );
}
