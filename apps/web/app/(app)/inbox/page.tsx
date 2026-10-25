import { t } from '@shoebox/i18n';
import { Card, LegalDateText, MoneyText, StatusBadge } from '@shoebox/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireActiveRole } from '../../../src/auth/org-context';
import { AutoRefresh } from '../../../src/documents/auto-refresh';
import { loadInbox } from '../../../src/documents/inbox-data';
import { UploadDropzone } from '../../../src/documents/upload-dropzone';
import { createSupabaseServerClient } from '../../../src/supabase/server';

export const metadata: Metadata = { title: t('inbox.title') };

export default async function InboxPage() {
  const auth = await requireActiveRole(['owner', 'member', 'accountant', 'viewer']);
  const rows = auth.ok ? await loadInbox(await createSupabaseServerClient(), auth.orgId) : [];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-title">{t('inbox.title')}</h1>
      <UploadDropzone />
      {rows.length === 0 ? (
        <Card className="flex flex-col gap-2 p-6">
          <h2 className="text-card-title">{t('inbox.empty.title')}</h2>
          <p className="text-body">{t('inbox.empty.body')}</p>
        </Card>
      ) : (
        <ul
          aria-label={t('inbox.list.label')}
          className="flex flex-col divide-y divide-border rounded-control border border-border bg-card"
        >
          {rows.map((row) => (
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
      )}
      <AutoRefresh active={rows.some((row) => row.processing)} />
    </div>
  );
}
