import { pragueToday } from '@shoebox/domain';
import { t } from '@shoebox/i18n';
import { Button, Card, cn, focusRing, Label } from '@shoebox/ui';
import type { Metadata } from 'next';
import { parsePeriod, periodOptions } from '../../../src/documents/export-period';

export const metadata: Metadata = { title: t('accountant.title') };

const selectClass = cn(
  'min-h-11 rounded-control border border-input bg-card px-3 text-body',
  focusRing,
);

function optionLabel(key: string): string {
  const quarter = key.match(/^(\d{4})-Q([1-4])$/);
  if (quarter) return t('export.quarter', { q: quarter[2], year: quarter[1] });
  if (/^\d{4}$/.test(key)) return t('export.year', { year: key });
  return t('export.month', { label: key });
}

export default function AccountantPage() {
  const today = pragueToday({ now: () => Date.now() });
  const selected = parsePeriod(null, today).key;
  return (
    <>
      <h1 className="text-title">{t('accountant.title')}</h1>
      <p className="text-body">{t('export.intro')}</p>
      <Card>
        <form method="get" action="/api/export" className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="export-period">{t('export.period')}</Label>
            <select id="export-period" name="period" defaultValue={selected} className={selectClass}>
              {periodOptions(today).map((option) => (
                <option key={option.key} value={option.key}>
                  {optionLabel(option.key)}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit">{t('export.download')}</Button>
        </form>
      </Card>
    </>
  );
}
