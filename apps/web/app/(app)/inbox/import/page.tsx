import { t } from '@shoebox/i18n';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireActiveRole } from '../../../../src/auth/org-context';
import { ImportWizard } from '../../../../src/imports/import-wizard';

export const metadata: Metadata = { title: t('import.title') };

export default async function ImportPage() {
  const auth = await requireActiveRole(['owner', 'member']);
  if (!auth.ok) redirect('/inbox');

  return (
    <div className="flex flex-col gap-6">
      <Link href="/inbox" className="text-body underline">
        {t('doc.detail.back')}
      </Link>
      <h1 className="text-title">{t('import.title')}</h1>
      <ImportWizard />
    </div>
  );
}
