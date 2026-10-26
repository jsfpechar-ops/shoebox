import type { LegalDate } from '@shoebox/domain';
import { t } from '@shoebox/i18n';
import {
  Button,
  Card,
  cn,
  focusRing,
  formatLegalDate,
  Input,
  Label,
  LegalDateText,
  MoneyText,
  StatusBadge,
} from '@shoebox/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireActiveRole } from '../../../src/auth/org-context';
import { AutoRefresh } from '../../../src/documents/auto-refresh';
import { loadInbox } from '../../../src/documents/inbox-data';
import { inboxHref, inboxTabOf, registerDownloadHref } from '../../../src/documents/inbox-tabs';
import {
  applyRegisterFilter,
  loadRegister,
  parseRegisterFilter,
} from '../../../src/documents/register-data';
import { RegisterTable } from '../../../src/documents/register-table';
import { restoreAction } from '../../../src/documents/trash-actions';
import { loadTrash } from '../../../src/documents/trash-data';
import { UploadDropzone } from '../../../src/documents/upload-dropzone';
import { createSupabaseServerClient } from '../../../src/supabase/server';

export const metadata: Metadata = { title: t('inbox.title') };

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') params.set(key, value);
  }
  const auth = await requireActiveRole(['owner', 'member', 'accountant', 'viewer']);
  const supabase = auth.ok ? await createSupabaseServerClient() : null;
  const rows = auth.ok && supabase ? await loadInbox(supabase, auth.orgId) : [];

  const needsUser = rows.some((r) => r.processing || r.status === 'needs_review');
  const tab = inboxTabOf(params.get('tab') ?? undefined, needsUser);
  const filter = parseRegisterFilter(params);
  const register =
    tab === 'all' && auth.ok && supabase
      ? applyRegisterFilter(await loadRegister(supabase, auth.orgId), filter)
      : [];
  const trashRows =
    tab === 'trash' && auth.ok && supabase ? await loadTrash(supabase, auth.orgId) : [];
  const reviewRows = rows.filter((r) => r.processing || r.status === 'needs_review');
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 6 }, (_, i) => currentYear - i);
  const tabLink =
    'rounded-control px-3 py-2 text-body aria-[current=page]:bg-muted aria-[current=page]:text-foreground text-muted-foreground';
  const selectClass = cn(
    'min-h-11 rounded-control border border-input bg-card px-3 text-body',
    focusRing,
  );

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-title">{t('inbox.title')}</h1>
      <nav aria-label={t('inbox.tabs.label')}>
        <ul className="flex gap-2">
          <li>
            <Link
              href={inboxHref('review')}
              aria-current={tab === 'review' ? 'page' : undefined}
              className={cn(tabLink, focusRing)}
            >
              {t('inbox.tabs.review')}
            </Link>
          </li>
          <li>
            <Link
              href={inboxHref('all', filter)}
              aria-current={tab === 'all' ? 'page' : undefined}
              className={cn(tabLink, focusRing)}
            >
              {t('inbox.tabs.all')}
            </Link>
          </li>
          <li>
            <Link
              href={inboxHref('trash')}
              aria-current={tab === 'trash' ? 'page' : undefined}
              className={cn(tabLink, focusRing)}
            >
              {t('inbox.tabs.trash')}
            </Link>
          </li>
        </ul>
      </nav>
      <UploadDropzone />
      <Link href="/inbox/new" className="text-body underline">
        {t('manual.cta')}
      </Link>
      {tab === 'trash' ? (
        <>
          <p className="text-body">{t('trash.note')}</p>
          {trashRows.length === 0 ? (
            <Card className="flex flex-col gap-2 p-6">
              <p className="text-body">{t('trash.empty')}</p>
            </Card>
          ) : (
            <ul
              aria-label={t('trash.title')}
              className="flex flex-col divide-y divide-border rounded-control border border-border bg-card"
            >
              {trashRows.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
                  <div className="flex flex-col gap-1">
                    <span className="text-body text-foreground">
                      {row.title ?? t('inbox.row.unknown_supplier')}
                    </span>
                    <span className="text-body text-muted-foreground">
                      {t('trash.deleted_on', {
                        date: formatLegalDate(row.deletedAt.slice(0, 10) as LegalDate),
                      })}
                    </span>
                  </div>
                  {auth.ok && (auth.role === 'owner' || auth.role === 'member') ? (
                    <form action={restoreAction}>
                      <input type="hidden" name="id" value={row.id} />
                      <Button type="submit" variant="secondary">
                        {t('trash.restore')}
                      </Button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : tab === 'all' ? (
        <>
          <form method="get" action="/inbox" className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="tab" value="all" />
            <div className="flex flex-col gap-1">
              <Label htmlFor="register-year">{t('register.filter.year')}</Label>
              <select
                id="register-year"
                name="year"
                defaultValue={filter.year ?? ''}
                className={selectClass}
              >
                <option value="">{t('register.filter.year_all')}</option>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="register-paid">{t('register.filter.paid')}</Label>
              <select
                id="register-paid"
                name="paid"
                defaultValue={filter.paid}
                className={selectClass}
              >
                <option value="all">{t('register.filter.paid_all')}</option>
                <option value="paid">{t('register.paid.yes')}</option>
                <option value="unpaid">{t('register.paid.no')}</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="register-q">{t('register.filter.search')}</Label>
              <Input id="register-q" name="q" type="search" defaultValue={filter.q} />
            </div>
            <Button type="submit">{t('register.filter.apply')}</Button>
          </form>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-body">{t('register.count', { n: register.length })}</p>
            <a
              href={registerDownloadHref(filter)}
              download
              className={cn('text-body underline', focusRing)}
            >
              {t('register.download')}
            </a>
          </div>
          {register.length === 0 ? (
            <Card className="flex flex-col gap-2 p-6">
              <p className="text-body">{t('register.empty')}</p>
            </Card>
          ) : (
            <RegisterTable rows={register} />
          )}
        </>
      ) : reviewRows.length === 0 ? (
        <Card className="flex flex-col gap-2 p-6">
          <h2 className="text-card-title">{t('inbox.empty.title')}</h2>
          <p className="text-body">{t('inbox.empty.body')}</p>
        </Card>
      ) : (
        <>
        <Link href="/inbox/review" className="text-body underline">
          {t('review.cta')}
        </Link>
        <ul
          aria-label={t('inbox.list.label')}
          className="flex flex-col divide-y divide-border rounded-control border border-border bg-card"
        >
          {reviewRows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
              <div className="flex flex-col gap-1">
                <span className="text-body text-foreground">
                  <Link href={`/inbox/${row.id}`} className="underline">
                    {row.title ?? t('inbox.row.unknown_supplier')}
                  </Link>
                </span>
                {row.issueDate ? <LegalDateText date={row.issueDate} /> : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {row.total ? (
                  <MoneyText value={row.total.value} currency={row.total.currency} />
                ) : null}
                <StatusBadge
                  status={row.status}
                  cls={row.cls}
                  {...(row.processing ? { processingSince: row.createdAt } : {})}
                />
              </div>
            </li>
          ))}
        </ul>
        </>
      )}
      <AutoRefresh active={rows.some((row) => row.processing)} />
    </div>
  );
}
