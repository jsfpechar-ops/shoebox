import { t } from '@shoebox/i18n';
import { Card } from '@shoebox/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireActiveRole } from '../../../../src/auth/org-context';
import { ManualEntryForm } from '../../../../src/documents/manual-entry-form';

export const metadata: Metadata = { title: t('manual.title') };

export default async function NewManualEntryPage() {
  const auth = await requireActiveRole(['owner', 'member']);
  if (!auth.ok) redirect('/inbox');

  return (
    <div className="flex flex-col gap-6">
      <Link href="/inbox" className="text-body underline">
        {t('doc.detail.back')}
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="text-title">{t('manual.title')}</h1>
        <p className="text-body">{t('manual.intro')}</p>
      </div>
      <Card className="p-6">
        <ManualEntryForm />
      </Card>
    </div>
  );
}
