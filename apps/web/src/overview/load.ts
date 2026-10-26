import {
  createCzRules,
  type LedgerTotalsEntry,
  type LegalDate,
  type OverviewDocument,
} from '@shoebox/domain';
import { createSupabaseServerClient } from '../supabase/server';
import { LEDGER_SELECT, toLedgerEntry } from './ledger';
import {
  DOCUMENTS_SELECT,
  type OverviewProfile,
  PROFILE_SELECT,
  toOverviewDocument,
  toOverviewProfile,
} from './rows';
import { buildOverviewView, type OverviewView } from './view';

interface LoadedRows {
  readonly profile: OverviewProfile | null;
  readonly documents: readonly OverviewDocument[];
  readonly ledgerEntries: readonly LedgerTotalsEntry[];
}

const NO_DATA: LoadedRows = { profile: null, documents: [], ledgerEntries: [] };

/**
 * The Přehled data of one org for `asOf` (server only). Every query is org-scoped and runs under the
 * user's session, so RLS applies too. Fails closed: a failed query, a throw or a row that does not
 * parse counts as no data, never as an error page.
 */
export async function loadOverview(orgId: string, asOf: LegalDate): Promise<OverviewView> {
  let rows: LoadedRows = NO_DATA;
  let insuranceSelfPaid = true;
  try {
    const supabase = await createSupabaseServerClient();
    const year = asOf.slice(0, 4);

    const profileResult = await supabase
      .from('taxpayer_profiles')
      .select(PROFILE_SELECT)
      .eq('org_id', orgId)
      .lte('valid_from', asOf)
      .or(`valid_to.is.null,valid_to.gte.${asOf}`)
      .order('valid_from', { ascending: false })
      .limit(1);

    const settingsResult = await supabase
      .from('organizations')
      .select('settings')
      .eq('id', orgId)
      .maybeSingle();

    const documentsResult = await supabase
      .from('documents')
      .select(DOCUMENTS_SELECT)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .or(
        `duzp.gte.${year}-01-01,issue_date.gte.${year}-01-01,received_date.gte.${year}-01-01,service_period_to.gte.${year}-01-01,and(duzp.is.null,issue_date.is.null,received_date.is.null)`,
      )
      .limit(5000);

    const ledgerResult = await supabase
      .from('tax_ledger_entries')
      .select(LEDGER_SELECT)
      .eq('org_id', orgId)
      .gte('entry_date', `${year}-01-01`)
      .lte('entry_date', asOf)
      .limit(20000);

    if (settingsResult.error === null) {
      const settings = settingsResult.data?.settings as { insurance_reminders?: unknown } | null;
      insuranceSelfPaid = settings?.insurance_reminders !== false;
    }

    const profileRow =
      profileResult.error === null && Array.isArray(profileResult.data)
        ? profileResult.data[0]
        : undefined;
    const profile =
      profileRow === undefined ? null : toOverviewProfile(profileRow, insuranceSelfPaid);

    const documents: OverviewDocument[] = [];
    if (documentsResult.error === null && Array.isArray(documentsResult.data)) {
      for (const row of documentsResult.data) {
        const doc = toOverviewDocument(row);
        if (doc !== null) documents.push(doc);
      }
    }

    const ledgerEntries: LedgerTotalsEntry[] = [];
    if (ledgerResult.error === null && Array.isArray(ledgerResult.data)) {
      for (const row of ledgerResult.data) {
        const entry = toLedgerEntry(row);
        if (entry !== null) ledgerEntries.push(entry);
      }
    }

    rows = { profile, documents, ledgerEntries };
  } catch {
    // Any throw (no session, no PostgREST, network) is no data: the screen shows its empty state.
    rows = NO_DATA;
  }

  return buildOverviewView({
    profile: rows.profile,
    documents: rows.documents,
    ledgerEntries: rows.ledgerEntries,
    asOf,
    rules: createCzRules(),
  });
}
