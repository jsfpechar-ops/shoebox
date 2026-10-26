import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { documents } from './schema/documents';
import { partners } from './schema/partners';
import type { TenantTx } from './tenant';

/** IČOs of the org's saved suppliers. */
export async function knownSupplierIcos(tx: TenantTx, orgId: string): Promise<string[]> {
  const rows = await tx
    .select({ ico: partners.ico })
    .from(partners)
    .where(and(eq(partners.orgId, orgId), isNotNull(partners.ico)));
  return rows.flatMap((row) => (row.ico === null ? [] : [row.ico]));
}

/** Upserts the supplier by (org, ico) and sets documents.partner_id; returns the partner id. Name falls back to the IČO. dic/name are only overwritten by non-null values. */
export async function rememberSupplier(
  tx: TenantTx,
  s: {
    orgId: string;
    documentId: string;
    ico: string;
    name: string | null;
    dic: string | null;
    country: string | null;
  },
): Promise<string> {
  const country = s.country !== null && /^[A-Z]{2}$/.test(s.country) ? s.country : 'CZ';
  const [partner] = await tx
    .insert(partners)
    .values({ orgId: s.orgId, name: s.name ?? s.ico, ico: s.ico, dic: s.dic, country })
    .onConflictDoUpdate({
      target: [partners.orgId, partners.ico],
      set: {
        name: sql`coalesce(${s.name}, ${partners.name})`,
        dic: sql`coalesce(${s.dic}, ${partners.dic})`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: partners.id });
  if (partner === undefined) {
    throw new Error('supplier upsert returned no row');
  }
  await tx
    .update(documents)
    .set({ partnerId: partner.id })
    .where(and(eq(documents.id, s.documentId), eq(documents.orgId, s.orgId)));
  return partner.id;
}
