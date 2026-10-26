import { createCzRules, pragueToday } from '@shoebox/domain';
import { t } from '@shoebox/i18n';
import type { Metadata } from 'next';
import { getOrgContext } from '../../../src/auth/org-context';
import { loadOverview } from '../../../src/overview/load';
import { OverviewScreen } from '../../../src/overview/overview-screen';
import { buildOverviewView } from '../../../src/overview/view';
import { createSupabaseServerClient } from '../../../src/supabase/server';
import { groupCards, type VatCardView, vatCardView } from '../../../src/vat/card-view';
import { FILING_WRITE_ROLES } from '../../../src/vat/filings';
import { buildPeriodCards, loadPeriodCardInputs } from '../../../src/vat/periods';
import { VatCards } from '../../../src/vat/vat-cards';

export const metadata: Metadata = { title: t('overview.title') };

export default async function OverviewPage() {
  const asOf = pragueToday({ now: () => Date.now() });
  const ctx = await getOrgContext();
  const orgId = ctx?.active?.orgId;
  const view =
    orgId === undefined
      ? buildOverviewView({ profile: null, documents: [], asOf, rules: createCzRules() })
      : await loadOverview(orgId, asOf);
  let views: VatCardView[] = [];
  if (orgId !== undefined) {
    try {
      const supabase = await createSupabaseServerClient();
      const inputs = await loadPeriodCardInputs(supabase, orgId, Number(asOf.slice(0, 4)), asOf);
      views = inputs === null ? [] : groupCards(buildPeriodCards(inputs)).map(vatCardView);
    } catch {
      views = [];
    }
  }
  const role = ctx?.active?.role;
  const canWrite = role !== undefined && FILING_WRITE_ROLES.includes(role);
  return <OverviewScreen view={view} vat={<VatCards views={views} canWrite={canWrite} />} />;
}
