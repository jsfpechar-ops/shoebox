import { t } from '@shoebox/i18n';
import { focusRing } from '@shoebox/ui';
import Link from 'next/link';
import { MarkFiledForm } from '../vat/vat-actions';
import type { PodkladyCardModel } from './card-view';
import { PrepareSummaryButton } from './podklady-actions';

const card = 'grid gap-4 rounded-card border border-border bg-card p-6 text-foreground';
const primaryLink = `${focusRing} inline-flex min-h-11 items-center rounded-control bg-primary px-4 text-body font-semibold text-primary-foreground`;
const textLink = `${focusRing} inline-flex min-h-11 items-center rounded-control px-1 text-body text-foreground underline`;

export function PodkladyCard({
  model,
  canWrite,
  today,
}: {
  model: PodkladyCardModel;
  canWrite: boolean;
  today: string;
}) {
  return (
    <section aria-labelledby="podklady-title" className={card}>
      <h2 id="podklady-title" className="text-body font-semibold">
        {model.title}
      </h2>
      {model.watermark !== null ? <p className="text-body">{model.watermark}</p> : null}
      {model.warnings.length > 0 ? (
        <ul className="grid gap-1 text-body">
          {model.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
      {model.changed !== null ? <p className="text-body">{model.changed}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Link href={model.viewHref} className={primaryLink}>
          {t('podklady.card.view')}
        </Link>
        {model.pdfHref !== null ? (
          <a href={model.pdfHref} download className={textLink}>
            {t('podklady.card.pdf')}
          </a>
        ) : null}
        {model.xlsxHref !== null ? (
          <a href={model.xlsxHref} download className={textLink}>
            {t('podklady.card.xlsx')}
          </a>
        ) : null}
        {canWrite && model.canPrepare ? <PrepareSummaryButton year={model.year} /> : null}
      </div>
      {canWrite && model.markFiledId !== null ? (
        <details>
          <summary className={textLink}>{t('podklady.card.mark_filed')}</summary>
          <MarkFiledForm filingId={model.markFiledId} today={today} />
        </details>
      ) : null}
      <p className="text-body">{t('podklady.disclaimer')}</p>
    </section>
  );
}
