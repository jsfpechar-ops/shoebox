import { pragueToday } from '@shoebox/domain';
import { t } from '@shoebox/i18n';
import { Card } from '@shoebox/ui';
import type { Metadata } from 'next';
import { requireActiveRole } from '../../../src/auth/org-context';
import { loadDocumentOverview } from '../../../src/documents/export-data';
import { ExportForm } from '../../../src/documents/export-form';
import { defaultPeriodKey, periodChoices } from '../../../src/documents/export-period';
import { createSupabaseServerClient } from '../../../src/supabase/server';

export const metadata: Metadata = { title: t('accountant.title') };

const monthFormat = new Intl.DateTimeFormat('en', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

function periodName(key: string): string {
  const quarter = key.match(/^(\d{4})-Q([1-4])$/);
  if (quarter) return t('export.quarter', { q: quarter[2] ?? '', year: quarter[1] ?? '' });
  if (/^\d{4}$/.test(key)) return t('export.year', { year: key });
  return monthFormat.format(new Date(`${key}-01T00:00:00Z`));
}

export default async function AccountantPage() {
  const today = pragueToday({ now: () => Date.now() });
  const auth = await requireActiveRole(['owner', 'member', 'accountant', 'viewer']);
  const overview = auth.ok
    ? await loadDocumentOverview(await createSupabaseServerClient(), auth.orgId)
    : { dates: [], undated: 0 };
  const choices = periodChoices(today, overview.dates);
  const options = choices.map((choice) => ({
    key: choice.key,
    label:
      choice.count > 0
        ? t('export.option', { label: periodName(choice.key), n: choice.count })
        : periodName(choice.key),
  }));
  const monthLabels: Record<string, string> = {};
  for (const choice of choices) monthLabels[choice.key] = periodName(choice.key);
  return (
    <>
      <h1 className="text-title">{t('accountant.title')}</h1>
      <p className="text-body">{t('export.intro')}</p>
      <Card>
        <ExportForm
          options={options}
          selected={defaultPeriodKey(today, overview.dates)}
          monthLabels={monthLabels}
        />
      </Card>
    </>
  );
}
