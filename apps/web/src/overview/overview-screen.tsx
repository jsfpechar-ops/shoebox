import { addDays, compareLegalDates, type Deadline } from '@shoebox/domain';
import { t } from '@shoebox/i18n';
import { focusRing } from '@shoebox/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatCzkWhole, formatDue, formatMoneyText, periodLabel } from './format';
import { HelpTip } from './help-tip';
import { LimitMeterBar } from './limit-meter';
import { MarkPaidButton } from './mark-paid-button';
import type { OverviewView } from './view';

const WINDOW_DAYS = 60;
const card = 'grid gap-4 rounded-card border border-border bg-card p-6 text-foreground';
const primaryLink = `${focusRing} inline-flex min-h-11 items-center rounded-control bg-primary px-4 text-body font-semibold text-primary-foreground`;
const textLink = `${focusRing} inline-flex min-h-11 items-center rounded-control px-1 text-body text-foreground underline`;

function amountText(deadline: Deadline): string {
  if (deadline.amount === null) return t('overview.next.amount_unknown');
  const amount = formatCzkWhole(deadline.amount);
  return deadline.amountIsMinimum ? t('overview.next.minimum', { amount }) : amount;
}

function kindName(deadline: Deadline): string {
  return t(`overview.kind.${deadline.kind}`);
}

function NextPayment({ view, upcoming }: { view: OverviewView; upcoming: readonly Deadline[] }) {
  const next =
    view.nextPayment !== null && upcoming.includes(view.nextPayment) ? view.nextPayment : null;
  return (
    <section aria-labelledby="next-title" className={card}>
      <h2 id="next-title" className="text-card-title">
        {t('overview.next.title')}
      </h2>
      {view.profile === null ? (
        <>
          <p className="text-body">{t('overview.next.no_profile')}</p>
          <p>
            <Link href="/nastaveni" className={textLink}>
              {t('overview.next.no_profile_action')}
            </Link>
          </p>
        </>
      ) : next === null ? (
        <p className="text-body">{t('overview.next.none', { days: String(WINDOW_DAYS) })}</p>
      ) : (
        <div className="grid gap-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-body font-semibold">
              {kindName(next)} {periodLabel(next)}
            </p>
            <HelpTip term={kindName(next)} text={t(`overview.help.kind.${next.kind}`)} />
          </div>
          <p className="num text-kpi">{amountText(next)}</p>
          <p className="text-body">{formatDue(next.due, view.asOf)}</p>
        </div>
      )}
    </section>
  );
}

function Meters({ view }: { view: OverviewView }) {
  return (
    <section aria-labelledby="meters-title" className={card}>
      <h2 id="meters-title" className="text-card-title">
        {t('overview.meters.title')}
      </h2>
      <ul className="grid gap-6">
        {view.meters.map((meter) => (
          <LimitMeterBar key={meter.id} meter={meter} />
        ))}
      </ul>
    </section>
  );
}

function Totals({ view }: { view: OverviewView }) {
  const { totals } = view;
  const rows = [
    { label: t('overview.totals.income'), month: totals.month.income, ytd: totals.ytd.income },
    {
      label: t('overview.totals.expenses'),
      month: totals.month.expenses,
      ytd: totals.ytd.expenses,
    },
  ];
  return (
    <section aria-labelledby="totals-title" className={card}>
      <div className="flex items-center justify-between gap-2">
        <h2 id="totals-title" className="text-card-title">
          {t('overview.totals.title')}
        </h2>
        <HelpTip term={t('overview.totals.title')} text={t('overview.help.totals')} />
      </div>
      <p className="text-body">{t('overview.totals.basis')}</p>
      <table className="w-full text-body">
        <thead>
          <tr>
            <th scope="col" className="py-2 text-left font-semibold">
              <span className="sr-only">{t('overview.totals.title')}</span>
            </th>
            <th scope="col" className="py-2 text-right font-semibold">
              {t('overview.totals.month')}
            </th>
            <th scope="col" className="py-2 text-right font-semibold">
              {t('overview.totals.ytd')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-border">
              <th scope="row" className="py-2 text-left font-normal">
                {row.label}
              </th>
              <td className="num py-2 text-right">{formatCzkWhole(row.month)}</td>
              <td className="num py-2 text-right">{formatCzkWhole(row.ytd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {view.pausal ? (
        <p className="text-body">{t('overview.totals.expenses_note_pausal')}</p>
      ) : null}
      {totals.pending.count > 0 ? (
        <p className="text-body">
          {t('overview.totals.pending', {
            n: totals.pending.count,
            amount: formatCzkWhole(totals.pending.grossCzk),
          })}
        </p>
      ) : null}
    </section>
  );
}

function Deadlines({ view, upcoming }: { view: OverviewView; upcoming: readonly Deadline[] }) {
  return (
    <section aria-labelledby="deadlines-title" className={card}>
      <h2 id="deadlines-title" className="text-card-title">
        {t('overview.deadlines.title')}
      </h2>
      {upcoming.length === 0 ? (
        <p className="text-body">{t('overview.deadlines.none', { days: String(WINDOW_DAYS) })}</p>
      ) : (
        <ul className="grid gap-3">
          {upcoming.map((deadline) => (
            <li
              key={`${deadline.kind}-${deadline.periodStart}`}
              className="flex items-start justify-between gap-2 border-t border-border pt-3 first:border-t-0 first:pt-0"
            >
              <div className="grid gap-1 text-body">
                <p className="font-semibold">
                  {kindName(deadline)} {periodLabel(deadline)}
                </p>
                <p>{formatDue(deadline.due, view.asOf)}</p>
                <p className="num">{amountText(deadline)}</p>
              </div>
              <HelpTip term={kindName(deadline)} text={t(`overview.help.kind.${deadline.kind}`)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function WorkCard({ view }: { view: OverviewView }) {
  const { work } = view;
  return (
    <section aria-labelledby="work-title" className={card}>
      <div className="flex items-center justify-between gap-2">
        <h2 id="work-title" className="text-card-title">
          {t('overview.work.title')}
        </h2>
        <HelpTip term={t('overview.work.title')} text={t('overview.help.work')} />
      </div>
      <p className="num text-kpi">{work.waiting}</p>
      <p className="text-body">{t('overview.work.reading', { n: work.reading })}</p>
      {work.autoReadPct === null ? null : (
        <div className="flex items-center justify-between gap-2">
          <p className="text-body">{t('overview.work.auto_read', { pct: work.autoReadPct })}</p>
          <HelpTip
            term={t('overview.work.auto_read', { pct: work.autoReadPct })}
            text={t('overview.help.auto_read')}
          />
        </div>
      )}
      {work.waiting > 0 ? (
        <p>
          <Link href="/inbox?tab=review" className={textLink}>
            {t('overview.work.review')}
          </Link>
        </p>
      ) : null}
    </section>
  );
}

function BillsCard({ view }: { view: OverviewView }) {
  const { bills } = view;
  const more = bills.count - bills.items.length;
  return (
    <section aria-labelledby="bills-title" className={card}>
      <div className="flex items-center justify-between gap-2">
        <h2 id="bills-title" className="text-card-title">
          {t('overview.bills.title')}
        </h2>
        <HelpTip term={t('overview.bills.title')} text={t('overview.help.bills')} />
      </div>
      {bills.items.length === 0 ? (
        <p className="text-body">{t('overview.bills.none')}</p>
      ) : (
        <ul className="grid gap-3">
          {bills.items.map((bill) => {
            const name = bill.partnerName ?? bill.number ?? '';
            return (
              <li
                key={bill.id}
                className="flex flex-wrap items-start justify-between gap-2 border-t border-border pt-3 first:border-t-0 first:pt-0"
              >
                <div className="grid gap-1 text-body">
                  <p className="font-semibold">
                    {bill.partnerName ?? bill.number ?? t('overview.bills.title')}
                  </p>
                  {bill.partnerName !== null && bill.number !== null ? <p>{bill.number}</p> : null}
                  <p className="num">{formatMoneyText(bill.amount, bill.currency)}</p>
                  <p>{formatDue(bill.due, view.asOf)}</p>
                  {bill.overdue ? (
                    <p className="font-semibold text-warning">{t('overview.bills.overdue')}</p>
                  ) : null}
                </div>
                <MarkPaidButton
                  documentId={bill.id}
                  label={`${t('overview.bills.mark_paid')}: ${name}`}
                />
              </li>
            );
          })}
        </ul>
      )}
      {bills.totalCzk === null ? null : (
        <p className="num text-body">
          {t('overview.bills.total', { amount: formatMoneyText(bills.totalCzk, 'CZK') })}
        </p>
      )}
      {more > 0 ? (
        <p>
          <Link href="/inbox?tab=all&paid=unpaid" className={textLink}>
            {t('overview.bills.more', { n: more })}
          </Link>
        </p>
      ) : null}
    </section>
  );
}

/** Přehled (M11 §5.2): next payment, limit meters, totals, deadlines and one way to the accountant. */
export function OverviewScreen({
  view,
  vat,
  tax,
}: {
  view: OverviewView;
  vat?: ReactNode;
  tax?: ReactNode;
}) {
  const horizon = addDays(view.asOf, WINDOW_DAYS);
  const upcoming = view.deadlines.filter(
    (deadline) => compareLegalDates(deadline.due, horizon) <= 0,
  );
  const empty = view.totals.countedCount === 0;
  return (
    <div className="grid gap-6">
      <h1 className="text-title">{t('overview.title')}</h1>
      <div className="grid items-start gap-6 md:grid-cols-2">
        <WorkCard view={view} />
        <BillsCard view={view} />
      </div>
      <NextPayment view={view} upcoming={upcoming} />
      {vat}
      {tax}
      {empty ? (
        <section aria-labelledby="empty-title" className={card}>
          <h2 id="empty-title" className="text-card-title">
            {t('overview.empty.title')}
          </h2>
          <p className="text-body">{t('overview.empty.body')}</p>
          <p>
            <Link href="/inbox" className={primaryLink}>
              {t('overview.empty.action')}
            </Link>
          </p>
        </section>
      ) : (
        <div className="grid items-start gap-6 md:grid-cols-2">
          {view.meters.length > 0 ? <Meters view={view} /> : null}
          <Totals view={view} />
        </div>
      )}
      <Deadlines view={view} upcoming={upcoming} />
      {empty ? null : (
        <p>
          <Link href="/ucetni" className={primaryLink}>
            {t('overview.send_accountant')}
          </Link>
        </p>
      )}
    </div>
  );
}
