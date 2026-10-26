import type { createSupabaseServerClient } from '../supabase/server';

type SupabaseLike = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** Documents re-queued by one reset; the rest is left for a later batch. */
const REPROCESS_CAP = 200;
const OPEN_STATUSES = ['needs_review', 'ready'];

/** Only the literal `true` turns the re-queue on. */
export function parseReprocess(value: string | null): boolean {
  return value === 'true';
}

export type ResetResult =
  | { ok: true; partnerId: string; openDocuments: { id: string; revision: number }[] }
  | { ok: false; status: 404; error: 'not_found' };

interface ProfileRow {
  id: string;
  partner_id: string;
  extraction_hints: unknown;
}

interface DocumentRow {
  id: string;
  revision: number;
}

/**
 * Resets the category memory of one profile (org-scoped) and lists the partner's open documents
 * (needs_review|ready, not deleted, at most 200). `extraction_hints` loses only `subject_cs`.
 * TODO(cat-05-bulk): batch the re-queue beyond the cap.
 */
export async function resetVendorMemory(
  supabase: SupabaseLike,
  input: { orgId: string; profileId: string },
): Promise<ResetResult> {
  const { data: profileData, error: readError } = await supabase
    .from('vendor_profiles')
    .select('id, partner_id, extraction_hints')
    .eq('id', input.profileId)
    .eq('org_id', input.orgId)
    .maybeSingle();
  if (readError) throw readError;
  const profile = profileData as ProfileRow | null;
  if (!profile) return { ok: false, status: 404, error: 'not_found' };

  const hints: Record<string, unknown> =
    typeof profile.extraction_hints === 'object' &&
    profile.extraction_hints !== null &&
    !Array.isArray(profile.extraction_hints)
      ? { ...(profile.extraction_hints as Record<string, unknown>) }
      : {};
  delete hints.subject_cs;

  const { error: writeError } = await supabase
    .from('vendor_profiles')
    .update({
      default_category_code: null,
      default_vat_treatment: null,
      default_business_flag: null,
      confirmations: 0,
      pinned: false,
      multi_category: false,
      last_confirmed_at: null,
      extraction_hints: hints,
    })
    .eq('id', input.profileId)
    .eq('org_id', input.orgId);
  if (writeError) throw writeError;

  const { data: docData, error: docsError } = await supabase
    .from('documents')
    .select('id, revision')
    .eq('org_id', input.orgId)
    .eq('partner_id', profile.partner_id)
    .in('status', OPEN_STATUSES)
    .is('deleted_at', null)
    .limit(REPROCESS_CAP);
  if (docsError) throw docsError;
  const docs = (docData ?? []) as DocumentRow[];

  return {
    ok: true,
    partnerId: profile.partner_id,
    openDocuments: docs.map((d) => ({ id: d.id, revision: d.revision })),
  };
}

export interface VendorProfileDto {
  id: string;
  partner_id: string;
  default_category_code: string | null;
  default_vat_treatment: string | null;
  default_business_flag: string | null;
  confirmations: number;
  pinned: boolean;
  multi_category: boolean;
  last_confirmed_at: string | null;
}

/** Learned category state of the org's vendors (optionally one partner). Never returns `extraction_hints`. */
export async function listVendorProfiles(
  supabase: SupabaseLike,
  input: { orgId: string; partnerId: string | null },
): Promise<VendorProfileDto[]> {
  let query = supabase
    .from('vendor_profiles')
    .select(
      'id, partner_id, default_category_code, default_vat_treatment, default_business_flag, confirmations, pinned, multi_category, last_confirmed_at',
    )
    .eq('org_id', input.orgId);
  if (input.partnerId !== null) query = query.eq('partner_id', input.partnerId);
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as unknown as VendorProfileDto[];
  return rows.map((r) => ({
    id: r.id,
    partner_id: r.partner_id,
    default_category_code: r.default_category_code,
    default_vat_treatment: r.default_vat_treatment,
    default_business_flag: r.default_business_flag,
    confirmations: r.confirmations,
    pinned: r.pinned,
    multi_category: r.multi_category,
    last_confirmed_at: r.last_confirmed_at,
  }));
}
