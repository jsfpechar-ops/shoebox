import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { reviewQuestions } from './schema/document-details';
import { documents } from './schema/documents';
import { vendorProfiles } from './schema/partners';
import type { TenantTx } from './tenant';

export interface VendorProfileWrite {
  readonly orgId: string;
  readonly partnerId: string;
  readonly defaultCategoryCode: string | null;
  readonly defaultVatTreatment: string | null;
  readonly defaultBusinessFlag: string | null;
  readonly confirmations: number;
  readonly pinned: boolean;
  readonly multiCategory: boolean;
  readonly subjectHint: string | null;
  readonly lastConfirmedAt: Date | null;
}

/** Upsert on (org_id, partner_id); extraction_hints = extraction_hints || {"subject_cs": subjectHint} (key removed when null). Returns the profile id. */
export async function saveVendorProfile(tx: TenantTx, write: VendorProfileWrite): Promise<string> {
  const values = {
    defaultCategoryCode: write.defaultCategoryCode,
    defaultVatTreatment:
      write.defaultVatTreatment as (typeof vendorProfiles.$inferInsert)['defaultVatTreatment'],
    defaultBusinessFlag: write.defaultBusinessFlag,
    confirmations: write.confirmations,
    pinned: write.pinned,
    multiCategory: write.multiCategory,
    lastConfirmedAt: write.lastConfirmedAt,
  };
  const [row] = await tx
    .insert(vendorProfiles)
    .values({
      orgId: write.orgId,
      partnerId: write.partnerId,
      ...values,
      extractionHints: write.subjectHint === null ? {} : { subject_cs: write.subjectHint },
    })
    .onConflictDoUpdate({
      target: [vendorProfiles.orgId, vendorProfiles.partnerId],
      set: {
        ...values,
        extractionHints:
          write.subjectHint === null
            ? sql`${vendorProfiles.extractionHints} - 'subject_cs'`
            : sql`${vendorProfiles.extractionHints} || ${JSON.stringify({ subject_cs: write.subjectHint })}::jsonb`,
      },
    })
    .returning({ id: vendorProfiles.id });
  if (!row) throw new Error('vendor profile upsert returned no row');
  return row.id;
}

/** Ids and revisions of the partner's documents in needs_review|ready, not deleted, excluding `exceptDocumentId`. */
export async function openDocumentsOfPartner(
  tx: TenantTx,
  orgId: string,
  partnerId: string,
  exceptDocumentId: string | null,
): Promise<{ id: string; revision: number }[]> {
  return tx
    .select({ id: documents.id, revision: documents.revision })
    .from(documents)
    .where(
      and(
        eq(documents.orgId, orgId),
        eq(documents.partnerId, partnerId),
        inArray(documents.status, ['needs_review', 'ready']),
        isNull(documents.deletedAt),
        exceptDocumentId === null ? undefined : ne(documents.id, exceptDocumentId),
      ),
    );
}

/** Inserts a relearn_vendor question unless an unanswered one with the same partner_id and new_code exists (any document of the org). */
export async function insertRelearnQuestion(
  tx: TenantTx,
  orgId: string,
  documentId: string,
  payload: unknown,
): Promise<boolean> {
  const params =
    typeof payload === 'object' && payload !== null && 'params' in payload
      ? (payload as { params: Record<string, unknown> }).params
      : null;
  const partnerId = params?.partner_id;
  const newCode = params?.new_code;
  if (typeof partnerId !== 'string' || typeof newCode !== 'string') return false;

  const [open] = await tx
    .select({ id: reviewQuestions.id })
    .from(reviewQuestions)
    .where(
      and(
        eq(reviewQuestions.orgId, orgId),
        eq(reviewQuestions.kind, 'relearn_vendor'),
        isNull(reviewQuestions.answeredAt),
        sql`${reviewQuestions.payload} -> 'params' ->> 'partner_id' = ${partnerId}`,
        sql`${reviewQuestions.payload} -> 'params' ->> 'new_code' = ${newCode}`,
      ),
    )
    .limit(1);
  if (open) return false;

  await tx.insert(reviewQuestions).values({ orgId, documentId, kind: 'relearn_vendor', payload });
  return true;
}
