import { pragueToday } from '@shoebox/domain';
import { t } from '@shoebox/i18n';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getOrgContext } from '../../../../../src/auth/org-context';
import { createSupabaseServerClient } from '../../../../../src/supabase/server';
import { groupCards, vatCardView } from '../../../../../src/vat/card-view';
import { FILING_WRITE_ROLES } from '../../../../../src/vat/filings';
import {
  buildPeriodCards,
  computePreview,
  loadPeriodCardInputs,
  loadPreviewInputs,
  parseForm,
  parsePeriodStart,
} from '../../../../../src/vat/periods';
import { PreviewView } from '../../../../../src/vat/preview-view';

export const metadata: Metadata = { title: t('vat.preview.title') };

export default async function VatPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ periodStart: string }>;
  searchParams: Promise<{ form?: string }>;
}) {
  const { periodStart: rawStart } = await params;
  const { form: rawForm } = await searchParams;
  const periodStart = parsePeriodStart(rawStart);
  const form = rawForm === undefined ? 'DPHDP3' : parseForm(rawForm);
  if (periodStart === null || form === null) notFound();
  const ctx = await getOrgContext();
  const orgId = ctx?.active?.orgId;
  if (orgId === undefined) notFound();
  const today = pragueToday({ now: () => Date.now() });
  const supabase = await createSupabaseServerClient();
  const inputs = await loadPreviewInputs(supabase, orgId, periodStart);
  if (inputs === null) return <p className="text-body">{t('vat.preview.empty')}</p>;
  const preview = computePreview(form, inputs);
  let card = null;
  try {
    const cardInputs = await loadPeriodCardInputs(
      supabase,
      orgId,
      Number(periodStart.slice(0, 4)),
      today,
    );
    const group =
      cardInputs === null
        ? undefined
        : groupCards(buildPeriodCards(cardInputs)).find((g) => g[0]?.periodStart === periodStart);
    card = group === undefined ? null : vatCardView(group);
  } catch {
    card = null;
  }
  const role = ctx?.active?.role;
  const canWrite = role !== undefined && FILING_WRITE_ROLES.includes(role);
  return (
    <PreviewView
      preview={preview}
      form={form}
      periodStart={periodStart}
      status={inputs.status}
      card={card}
      canWrite={canWrite}
      today={today}
    />
  );
}
