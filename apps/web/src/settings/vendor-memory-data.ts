import type { createSupabaseServerClient } from '../supabase/server';

type SupabaseLike = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export const VENDOR_MEMORY_LIMIT = 50;

export interface VendorMemoryRow {
  readonly id: string;
  readonly supplier: string;
  readonly category: string;
  readonly pinned: boolean;
}

const one = (value: unknown): Record<string, unknown> | null => {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
};

/** One remembered supplier, or null when the row has no category or no supplier name. */
export function vendorMemoryRowOf(raw: Record<string, unknown>): VendorMemoryRow | null {
  const supplier = one(raw.partners)?.name;
  const category = one(raw.categories)?.label_en;
  if (typeof raw.id !== 'string' || typeof supplier !== 'string' || typeof category !== 'string')
    return null;
  return { id: raw.id, supplier, category, pinned: raw.pinned === true };
}

/** The org's remembered suppliers, last confirmed first; null on a read error. */
export async function loadVendorMemory(
  supabase: SupabaseLike,
  orgId: string,
): Promise<VendorMemoryRow[] | null> {
  const { data, error } = await supabase
    .from('vendor_profiles')
    .select('id, pinned, partners(name), categories(label_en)')
    .eq('org_id', orgId)
    .not('default_category_code', 'is', null)
    .order('last_confirmed_at', { ascending: false, nullsFirst: false })
    .limit(VENDOR_MEMORY_LIMIT);
  if (error || !data) return null;
  return (data as Record<string, unknown>[])
    .map(vendorMemoryRowOf)
    .filter((row): row is VendorMemoryRow => row !== null);
}
