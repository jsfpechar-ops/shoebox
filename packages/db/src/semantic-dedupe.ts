// Semantic dedupe (M01 §4.6.3): the same invoice uploaded twice as different files, e.g. a phone
// photo and the PDF. Runs right after a reading is saved: the earlier live document stays, the new
// one becomes 'duplicate' with a duplicate_of link. TODO(fidelity): prefer ISDOC/PDF over a photo.
import { type SQL, sql } from 'drizzle-orm';
import { documentLinks } from './schema/document-details';
import type { TenantTx } from './tenant';

/** Supplier key of a documents alias: 'ico:<digits>' when an IČO is printed, else 'name:<lower name>'. */
function supplierKey(alias: string): SQL {
  const a = sql.raw(alias);
  return sql`case when regexp_replace(coalesce(${a}.partner_snapshot->>'ico', ''), '[^0-9]', '', 'g') <> ''
    then 'ico:' || regexp_replace(${a}.partner_snapshot->>'ico', '[^0-9]', '', 'g')
    else 'name:' || regexp_replace(lower(trim(coalesce(${a}.partner_snapshot->>'name', ''))), '[[:space:]]+', ' ', 'g') end`;
}

function numberKey(alias: string): SQL {
  return sql`regexp_replace(upper(${sql.raw(alias)}.document_number), '[^A-Z0-9]', '', 'g')`;
}

/**
 * When `documentId` repeats an earlier live document of the org (same supplier, document number,
 * gross total and currency), marks it 'duplicate', links it to that document and returns the
 * earlier document's id; otherwise returns null and changes nothing.
 */
export async function markIfSemanticDuplicate(
  tx: TenantTx,
  orgId: string,
  documentId: string,
): Promise<string | null> {
  // One dedupe at a time per org, so two copies read at once cannot both stay.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${orgId} || ':semantic-dedupe'))`);
  const rows = await tx.execute<{ id: string }>(sql`
    select o.id from documents n
    join documents o on o.org_id = n.org_id and o.id <> n.id
    where n.id = ${documentId} and n.org_id = ${orgId}
      and not n.semantic_dedupe_exempt and not o.semantic_dedupe_exempt
      and o.deleted_at is null
      and o.status in ('needs_review', 'ready', 'finalized')
      and n.document_number is not null and n.total_gross is not null
      and ${numberKey('n')} <> ''
      and o.total_gross = n.total_gross and o.currency = n.currency
      and ${numberKey('o')} = ${numberKey('n')}
      and regexp_replace(${supplierKey('n')}, '^name:$', '') <> ''
      and ${supplierKey('o')} = ${supplierKey('n')}
    order by o.created_at asc, o.id asc
    limit 1`);
  const original = rows[0]?.id;
  if (original === undefined) return null;

  await tx.execute(
    sql`update documents set status = 'duplicate' where id = ${documentId} and org_id = ${orgId}`,
  );
  await tx
    .insert(documentLinks)
    .values({ orgId, fromDocumentId: documentId, toDocumentId: original, kind: 'duplicate_of' })
    .onConflictDoNothing();
  return original;
}
