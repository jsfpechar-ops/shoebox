import { createCzRules, pragueToday } from '@shoebox/domain';
import { t } from '@shoebox/i18n';
import type { Metadata } from 'next';
import { getOrgContext } from '../../../src/auth/org-context';
import { loadOverview } from '../../../src/overview/load';
import { OverviewScreen } from '../../../src/overview/overview-screen';
import { buildOverviewView } from '../../../src/overview/view';

export const metadata: Metadata = { title: t('overview.title') };

export default async function OverviewPage() {
  const asOf = pragueToday({ now: () => Date.now() });
  const ctx = await getOrgContext();
  const orgId = ctx?.active?.orgId;
  const view =
    orgId === undefined
      ? buildOverviewView({ profile: null, documents: [], asOf, rules: createCzRules() })
      : await loadOverview(orgId, asOf);
  return <OverviewScreen view={view} />;
}
