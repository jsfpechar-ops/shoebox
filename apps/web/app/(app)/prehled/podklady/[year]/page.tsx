import { pragueToday } from '@shoebox/domain';
import { catalogs, type MessageKey, t } from '@shoebox/i18n';
import { focusRing } from '@shoebox/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getOrgContext } from '../../../../../src/auth/org-context';
import { podkladyCardModel, wholeCzk } from '../../../../../src/podklady/card-view';
import { loadPodkladyPreview } from '../../../../../src/podklady/load';
import { PodkladyCard } from '../../../../../src/podklady/podklady-card';
import { PODKLADY_WRITE_ROLES, parseYearParam } from '../../../../../src/podklady/preview';
import type { PodkladyPreviewView } from '../../../../../src/podklady/view';

export const metadata: Metadata = { title: t('podklady.page.title') };

const textLink = `${focusRing} inline-flex min-h-11 items-center rounded-control px-1 text-body text-foreground underline`;
const panel = 'grid gap-3 rounded-card border border-border bg-card p-6 text-foreground';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

type Row = { label: string; value: string };

function headlineRows(summary: unknown): Row[] {
  if (!isRecord(summary)) return [];
  const headline: Record<string, unknown> = isRecord(summary.headline) ? summary.headline : {};
  const flat: Record<string, unknown> = isRecord(summary.flatRate) ? summary.flatRate : {};
  const rate = flat.rate;
  const amount = (value: unknown): string | null =>
    typeof value === 'string' ? wholeCzk(value) : null;
  const expenses: Row | { label: string; value: string | null } =
    headline.label === 'flat' && (typeof rate === 'number' || typeof rate === 'string')
      ? {
          label: t('podklady.headline.expenses_flat', { rate: String(rate) }),
          value: amount(headline.expenses),
        }
      : { label: t('podklady.headline.expenses'), value: amount(headline.expenses) };
  const candidates = [
    { label: t('podklady.headline.income'), value: amount(headline.income) },
    expenses,
    { label: t('podklady.headline.base'), value: amount(headline.base) },
    { label: t('podklady.headline.advances'), value: amount(summary.advancesPaid) },
  ];
  return candidates.filter((row): row is Row => row.value !== null);
}

function checklistKeys(summary: unknown): MessageKey[] {
  if (!isRecord(summary) || !Array.isArray(summary.checklistKeys)) return [];
  return summary.checklistKeys.filter(
    (key): key is MessageKey => typeof key === 'string' && key in catalogs.en,
  );
}

export default async function PodkladyYearPage({ params }: { params: Promise<{ year: string }> }) {
  const { year: raw } = await params;
  const asOf = pragueToday({ now: () => Date.now() });
  const year = parseYearParam(raw, asOf);
  if (year === null) notFound();

  const ctx = await getOrgContext();
  const orgId = ctx?.active?.orgId;
  const role = ctx?.active?.role;
  let preview: PodkladyPreviewView | null = null;
  if (orgId !== undefined && role !== undefined) {
    try {
      preview = await loadPodkladyPreview(orgId, year, role);
    } catch {
      preview = null;
    }
  }
  const canWrite = role !== undefined && PODKLADY_WRITE_ROLES.includes(role);
  const rows = preview === null ? [] : headlineRows(preview.summary);

  return (
    <div className="grid gap-6">
      <Link href="/prehled" className={textLink}>
        {t('vat.preview.back')}
      </Link>
      <h1 className="text-title font-semibold">{t('podklady.title', { year: String(year) })}</h1>
      {preview === null ? <p className="text-body">{t('podklady.page.unavailable')}</p> : null}
      {preview?.empty ? (
        <p className="text-body">{t('podklady.no_data', { year: String(year) })}</p>
      ) : null}
      {preview !== null && !preview.empty ? (
        <>
          <PodkladyCard model={podkladyCardModel(preview)} canWrite={canWrite} today={asOf} />
          <section className={panel}>
            <h2 className="text-body font-semibold">{t('podklady.page.numbers')}</h2>
            <dl className="grid gap-2">
              {rows.map((row) => (
                <div key={row.label} className="flex justify-between gap-4 text-body">
                  <dt>{row.label}</dt>
                  <dd className="num">{row.value}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section className={panel}>
            <h2 className="text-body font-semibold">{t('podklady.page.not_included')}</h2>
            <ul className="grid gap-1 text-body">
              {checklistKeys(preview.summary).map((key) => (
                <li key={key}>{t(key)}</li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
    </div>
  );
}
