import type { LegalDate } from '@shoebox/domain';
import type { MessageKey } from '@shoebox/i18n';
import type { createSupabaseServerClient } from '../supabase/server';

type SupabaseLike = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface SettingsView {
  readonly firm: { name: string; ico: string; dic: string | null; address: string | null };
  readonly tax: {
    vat: MessageKey;
    regime: MessageKey;
    flatRate: number | null;
    since: LegalDate;
  } | null;
  readonly team: readonly { userId: string; role: MessageKey; isYou: boolean }[];
}

interface AddressParts {
  street?: unknown;
  house_number?: unknown;
  orientation_number?: unknown;
  city?: unknown;
  zip?: unknown;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** One line: "Jankovcova 1522/53, 170 00 Praha". null when street and city are both missing. */
export function formatAddress(raw: unknown): string | null {
  if (raw === null || typeof raw !== 'object') return null;
  const parts = raw as AddressParts;
  const street = text(parts.street);
  const city = text(parts.city);
  if (street === null && city === null) return null;

  const house = text(parts.house_number);
  const orientation = text(parts.orientation_number);
  const houseWithOrientation =
    house === null ? null : orientation === null ? house : `${house}/${orientation}`;
  const line = [street, houseWithOrientation].filter((p): p is string => p !== null).join(' ');

  const zipRaw = text(parts.zip);
  const zip =
    zipRaw === null ? null : zipRaw.replace(/\s+/g, '').replace(/^(\d{3})(\d{2})$/, '$1 $2');
  const zipCity = [zip, city].filter((p): p is string => p !== null).join(' ');

  return [line, zipCity].filter((p) => p !== '').join(', ');
}

/** The profile valid on `today` (latest valid_from), or null. */
export function currentProfile<T extends { valid_from: string; valid_to: string | null }>(
  rows: readonly T[],
  today: LegalDate,
): T | null {
  let best: T | null = null;
  for (const row of rows) {
    if (row.valid_from > today) continue;
    if (row.valid_to !== null && row.valid_to < today) continue;
    if (best === null || row.valid_from > best.valid_from) best = row;
  }
  return best;
}

/** vat_status + vat_period → the onboarding label key. */
export function vatLabel(status: string, period: string | null): MessageKey {
  if (status === 'platce') {
    return period === 'quarterly'
      ? 'onboarding.vat.platce_quarterly'
      : 'onboarding.vat.platce_monthly';
  }
  if (status === 'identifikovana_osoba') return 'onboarding.vat.identifikovana_osoba';
  return 'onboarding.vat.neplatce';
}

/** tax_regime → its onboarding label key. */
export function regimeLabel(regime: string): MessageKey {
  if (regime === 'danova_evidence') return 'onboarding.regime.danova_evidence';
  if (regime === 'pausalni_vydaje') return 'onboarding.regime.pausalni_vydaje';
  if (regime === 'pausalni_dan') return 'onboarding.regime.pausalni_dan';
  return 'onboarding.regime.nevim';
}

function roleLabel(role: string): MessageKey {
  if (role === 'owner') return 'settings.role.owner';
  if (role === 'member') return 'settings.role.member';
  if (role === 'accountant') return 'settings.role.accountant';
  return 'settings.role.viewer';
}

interface OrgRow {
  name: string;
  ico: string | null;
  dic: string | null;
}

interface ProfileRow {
  valid_from: string;
  valid_to: string | null;
  vat_status: string;
  vat_period: string | null;
  tax_regime: string;
  pausal_rate: number | string | null;
  address: unknown;
}

interface MembershipRow {
  user_id: string;
  role: string;
}

/** Settings for one org. Any error, or a missing org, gives null. */
export async function loadSettings(
  supabase: SupabaseLike,
  orgId: string,
  userId: string,
  today: LegalDate,
): Promise<SettingsView | null> {
  try {
    const [orgRes, profileRes, memberRes] = await Promise.all([
      supabase.from('organizations').select('name, ico, dic').eq('id', orgId).single(),
      supabase
        .from('taxpayer_profiles')
        .select('valid_from, valid_to, vat_status, vat_period, tax_regime, pausal_rate, address')
        .eq('org_id', orgId),
      supabase.from('memberships').select('user_id, role').eq('org_id', orgId),
    ]);
    if (orgRes.error || !orgRes.data) return null;
    if (profileRes.error || !Array.isArray(profileRes.data)) return null;
    if (memberRes.error || !Array.isArray(memberRes.data)) return null;

    const org = orgRes.data as OrgRow;
    const profile = currentProfile(profileRes.data as ProfileRow[], today);
    const members = memberRes.data as MembershipRow[];

    const team = members
      .map((m) => ({
        userId: m.user_id,
        role: roleLabel(m.role),
        isYou: m.user_id === userId,
        isOwner: m.role === 'owner',
      }))
      .sort((a, b) => Number(b.isOwner) - Number(a.isOwner))
      .map(({ userId: id, role, isYou }) => ({ userId: id, role, isYou }));

    return {
      firm: {
        name: org.name,
        ico: org.ico ?? '',
        dic: text(org.dic),
        address: profile === null ? null : formatAddress(profile.address),
      },
      tax:
        profile === null
          ? null
          : {
              vat: vatLabel(profile.vat_status, profile.vat_period),
              regime: regimeLabel(profile.tax_regime),
              flatRate: profile.pausal_rate === null ? null : Number(profile.pausal_rate),
              since: profile.valid_from as LegalDate,
            },
      team,
    };
  } catch {
    return null;
  }
}
