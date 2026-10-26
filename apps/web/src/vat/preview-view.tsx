import {
  Money,
  type Money as MoneyType,
  type PeriodPreview,
  type PreviewEntry,
} from '@shoebox/domain';
import { catalogs, type MessageKey, t } from '@shoebox/i18n';
import { focusRing } from '@shoebox/ui';
import Link from 'next/link';
import { formatCzkWhole } from '../overview/format';
import type { VatCardView } from './card-view';
import { MarkFiledForm } from './vat-actions';
import { VatActionView } from './vat-cards';

type Form = 'DPHDP3' | 'DPHKH1' | 'DPHSHV';

const CZK2 = new Intl.NumberFormat('cs-CZ', {
  style: 'currency',
  currency: 'CZK',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const textLink = `${focusRing} inline-flex min-h-11 items-center rounded-control px-1 text-body text-foreground underline`;
const cell = 'px-2 py-2 text-body align-top';
const num = `${cell} text-right`;

function whole(amount: string): string {
  return formatCzkWhole(Money.parse(amount, 'CZK') as MoneyType);
}

function two(amount: string): string {
  return CZK2.format(amount as unknown as number);
}

function fullDate(date: string): string {
  const [y = '', m = '', d = ''] = date.split('-');
  return `${Number(d)}. ${Number(m)}. ${y}`;
}

function label(key: string, fallbackRow: string): string {
  return key in catalogs.en ? t(key as MessageKey) : t('vat.row.unknown', { row: fallbackRow });
}

function Entries({ entries }: { entries: readonly PreviewEntry[] }) {
  return (
    <ul className="grid gap-1 pl-2 text-body">
      {entries.map((e, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: entries have no stable id of their own
        <li key={`${e.documentId}-${i}`}>
          {[
            e.partnerName,
            e.documentNumber,
            fullDate(e.vatPointDate),
            two(e.baseCzk),
            two(e.vatCzk),
          ]
            .filter((x) => x !== null && x !== '')
            .join(' · ')}
          {e.fxRate !== null && e.amountForeign !== null && e.fxRateDate !== null ? (
            <span className="block">
              {t('vat.preview.fx', {
                amount: e.amountForeign,
                currency: e.currency,
                rate: e.fxRate,
                rateDate: fullDate(e.fxRateDate),
              })}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function Dp3({ preview }: { preview: PeriodPreview }) {
  const result = preview.result;
  return (
    <div className="grid gap-4">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr>
              <th scope="col" className={cell} />
              <th scope="col" className={num}>
                {t('vat.preview.base')}
              </th>
              <th scope="col" className={num}>
                {t('vat.preview.tax')}
              </th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row) => (
              <tr key={row.row} className="border-t border-border">
                <th scope="row" className={`${cell} font-normal`}>
                  {label(row.labelKey, row.row)}
                  {row.entries.length > 0 ? (
                    <details>
                      <summary className={textLink}>{t('vat.preview.documents')}</summary>
                      <Entries entries={row.entries} />
                    </details>
                  ) : null}
                </th>
                <td className={num}>{whole(row.rounded.base)}</td>
                <td className={num}>{whole(row.rounded.tax)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result !== null && result.row64 !== '0' ? (
        <p className="text-card-title">
          {t('vat.preview.to_pay', { amount: whole(result.row64) })}
        </p>
      ) : null}
      {result !== null && result.row65 !== '0' ? (
        <p className="text-card-title">
          {t('vat.preview.refund', { amount: whole(result.row65) })}
        </p>
      ) : null}
    </div>
  );
}

function Kh({ preview }: { preview: PeriodPreview }) {
  return (
    <div className="grid gap-4">
      {(preview.khSections ?? []).map((section) => (
        <section key={section.section} className="grid gap-2">
          <h3 className="text-card-title">{label(section.labelKey, section.section)}</h3>
          <ul className="grid gap-2 text-body">
            {section.rows.map((r) => (
              <li key={r.key}>
                {[r.counterparty, r.evidenceNumber, r.dppd === null ? null : fullDate(r.dppd)]
                  .filter((x) => x !== null && x !== '')
                  .join(' · ')}
                <span className="block">
                  {[
                    `${whole(r.zaklDane1)}/${whole(r.dan1)}`,
                    `${whole(r.zaklDane2)}/${whole(r.dan2)}`,
                  ].join(' ')}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Shv({ preview }: { preview: PeriodPreview }) {
  return (
    <ul className="grid gap-2 text-body">
      {(preview.shvRows ?? []).map((r) => (
        <li key={`${r.kStat}-${r.cVat}-${r.code}`}>
          {[
            `${r.kStat} ${r.cVat}`,
            label(r.labelKey, r.kStat),
            whole(r.plnHodnota),
            String(r.plnPocet),
          ].join(' · ')}
        </li>
      ))}
    </ul>
  );
}

const FORMS: readonly Form[] = ['DPHDP3', 'DPHKH1', 'DPHSHV'];

/** The period preview (M05 §6): plain row labels with a drill-down, then the filing steps. */
export function PreviewView({
  preview,
  form,
  periodStart,
  status,
  card,
  canWrite,
  today,
}: {
  preview: PeriodPreview;
  form: Form;
  periodStart: string;
  status: 'platce' | 'identifikovana_osoba';
  card: VatCardView | null;
  canWrite: boolean;
  today: string;
}) {
  const forms = status === 'platce' ? FORMS : FORMS.slice(0, 1);
  const actions = (card?.actions ?? []).filter((a) => a.kind !== 'open' && a.kind !== 'mark_filed');
  const markFiled = card?.actions.find((a) => a.kind === 'mark_filed');
  return (
    <div className="grid gap-6">
      <header className="grid gap-2">
        <Link href="/prehled" className={textLink}>
          {t('vat.preview.back')}
        </Link>
        <h1 className="text-title">{card?.title ?? t('vat.preview.title')}</h1>
        <p className="text-body text-muted-foreground">{t('vat.disclaimer')}</p>
      </header>
      <nav className="flex flex-wrap gap-3">
        {forms.map((f) => (
          <Link
            key={f}
            href={`/prehled/dph/${periodStart}?form=${f}`}
            aria-current={f === form ? 'page' : undefined}
            className={`${textLink} ${f === form ? 'font-semibold' : ''}`}
          >
            {t(`vat.form.${f.toLowerCase()}` as MessageKey)}
          </Link>
        ))}
      </nav>
      {form === 'DPHDP3' ? <Dp3 preview={preview} /> : null}
      {form === 'DPHKH1' ? <Kh preview={preview} /> : null}
      {form === 'DPHSHV' ? <Shv preview={preview} /> : null}
      {card !== null ? (
        <section className="grid gap-4">
          <p className="text-body">{card.body}</p>
          <div className="flex flex-wrap items-start gap-3">
            {actions.map((a) => (
              <VatActionView key={a.kind} action={a} canWrite={canWrite} today={today} />
            ))}
          </div>
          {markFiled?.kind === 'mark_filed' ? (
            <div className="grid gap-3">
              <h2 className="text-card-title">{t('vat.submit.title')}</h2>
              {/* TODO(verify): check the MOJE daně steps against the official help before release. */}
              <ol className="grid list-decimal gap-1 pl-6 text-body">
                <li>{t('vat.submit.step1')}</li>
                <li>{t('vat.submit.step2')}</li>
                <li>{t('vat.submit.step3')}</li>
                <li>{t('vat.submit.step4')}</li>
                <li>{t('vat.submit.step5')}</li>
                <li>{t('vat.submit.step6')}</li>
              </ol>
              <p className="text-body text-muted-foreground">{t('vat.submit.checked')}</p>
              {canWrite ? <MarkFiledForm filingId={markFiled.filingId} today={today} /> : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
