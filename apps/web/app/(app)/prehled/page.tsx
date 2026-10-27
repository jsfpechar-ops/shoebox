import { createCzRules, pragueToday } from '@shoebox/domain';
import { t } from '@shoebox/i18n';
import { focusRing } from '@shoebox/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getOrgContext } from '../../../src/auth/org-context';
import { loadOverview } from '../../../src/overview/load';
import { OverviewScreen } from '../../../src/overview/overview-screen';
import { buildOverviewView } from '../../../src/overview/view';
import { podkladyCardModel, reserveText } from '../../../src/podklady/card-view';
import { loadPodkladyPreview, loadTaxReserve } from '../../../src/podklady/load';
import { PodkladyCard } from '../../../src/podklady/podklady-card';
import { PODKLADY_WRITE_ROLES, shouldShowPodkladyCard } from '../../../src/podklady/preview';
import { ReserveTile } from '../../../src/podklady/reserve-tile';
import type { PodkladyPreviewView } from '../../../src/podklady/view';
import { createSupabaseServerClient } from '../../../src/supabase/server';
import { groupCards, type VatCardView, vatCardView } from '../../../src/vat/card-view';
import { FILING_WRITE_ROLES } from '../../../src/vat/filings';
import { buildPeriodCards, loadPeriodCardInputs } from '../../../src/vat/periods';
import { VatCards } from '../../../src/vat/vat-cards';

export const metadata: Metadata = { title: t('overview.title') };

const textLink = `${focusRing} inline-flex min-h-11 items-center rounded-control px-1 text-body text-foreground underline`;

export default async function OverviewPage() {
  const asOf = pragueToday({ now: () => Date.now() });
  const ctx = await getOrgContext();
  const orgId = ctx?.active?.orgId;
  const role = ctx?.active?.role;
  const lastYear = Number(asOf.slice(0, 4)) - 1;

  // The four loads are independent: run them at the same time. Each one handles its own failure.
  async function loadVatViews(org: string): Promise<VatCardView[]> {
    try {
      const supabase = await createSupabaseServerClient();
      const inputs = await loadPeriodCardInputs(supabase, org, Number(asOf.slice(0, 4)), asOf);
      return inputs === null ? [] : groupCards(buildPeriodCards(inputs)).map(vatCardView);
    } catch {
      return [];
    }
  }
  async function loadPreviewOrNull(org: string, r: NonNullable<typeof role>) {
    try {
      return await loadPodkladyPreview(org, lastYear, r);
    } catch {
      return null;
    }
  }
  async function loadReserveOrNull(org: string): Promise<{ main: string; badge: string } | null> {
    try {
      return reserveText(await loadTaxReserve(org));
    } catch {
      return null;
    }
  }

  const [view, views, preview, reserve] = await Promise.all([
    orgId === undefined
      ? buildOverviewView({ profile: null, documents: [], asOf, rules: createCzRules() })
      : loadOverview(orgId, asOf),
    orgId === undefined ? Promise.resolve<VatCardView[]>([]) : loadVatViews(orgId),
    orgId === undefined || role === undefined
      ? Promise.resolve<PodkladyPreviewView | null>(null)
      : loadPreviewOrNull(orgId, role),
    orgId === undefined || role === undefined
      ? Promise.resolve<{ main: string; badge: string } | null>(null)
      : loadReserveOrNull(orgId),
  ]);
  const canWrite = role !== undefined && FILING_WRITE_ROLES.includes(role);
  const showCard = preview !== null && shouldShowPodkladyCard(asOf, lastYear, !preview.empty).show;
  const canWritePodklady = role !== undefined && PODKLADY_WRITE_ROLES.includes(role);
  const tax = (
    <>
      {showCard && preview !== null ? (
        <PodkladyCard model={podkladyCardModel(preview)} canWrite={canWritePodklady} today={asOf} />
      ) : (
        <p>
          <Link href={`/prehled/podklady/${asOf.slice(0, 4)}`} className={textLink}>
            {t('podklady.link')}
          </Link>
        </p>
      )}
      {reserve !== null ? <ReserveTile text={reserve} /> : null}
    </>
  );
  return (
    <OverviewScreen view={view} vat={<VatCards views={views} canWrite={canWrite} />} tax={tax} />
  );
}
