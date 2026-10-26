// M05 §4.11 helpers: read government_filing documents (their current extracted fields) and link
// ledger documents to a filed return. Every query is org-scoped (AGENTS rule 3).

import type { DocLinkKind } from '@shoebox/domain';
import { and, eq, isNull } from 'drizzle-orm';
import { documentFields, documentLinks } from './schema/document-details';
import { documents } from './schema/documents';
import type { TenantTx } from './tenant';

export interface GovernmentFilingDocument {
  readonly documentId: string;
  readonly issueDate: string | null;
  readonly fields: ReadonlyArray<{ key: string; value: string | null }>;
}

/** Current extracted fields of the org's non-deleted government_filing documents. */
export async function readGovernmentFilingFields(
  tx: TenantTx,
  orgId: string,
): Promise<GovernmentFilingDocument[]> {
  const rows = await tx
    .select({
      documentId: documents.id,
      issueDate: documents.issueDate,
      fieldKey: documentFields.fieldKey,
      valueText: documentFields.valueText,
    })
    .from(documents)
    .innerJoin(
      documentFields,
      and(
        eq(documentFields.documentId, documents.id),
        eq(documentFields.orgId, orgId),
        eq(documentFields.isCurrent, true),
      ),
    )
    .where(
      and(
        eq(documents.orgId, orgId),
        eq(documents.class, 'government_filing'),
        isNull(documents.deletedAt),
      ),
    );
  const byDocument = new Map<
    string,
    GovernmentFilingDocument & { fields: { key: string; value: string | null }[] }
  >();
  for (const row of rows) {
    let doc = byDocument.get(row.documentId);
    if (!doc) {
      doc = { documentId: row.documentId, issueDate: row.issueDate, fields: [] };
      byDocument.set(row.documentId, doc);
    }
    doc.fields.push({ key: row.fieldKey, value: row.valueText });
  }
  return [...byDocument.values()];
}

export interface DocumentLinkInput {
  readonly fromDocumentId: string;
  readonly toDocumentId: string;
  readonly kind: DocLinkKind;
}

/** Inserts links idempotently; both documents must belong to the org. */
export async function insertDocumentLinks(
  tx: TenantTx,
  orgId: string,
  links: readonly DocumentLinkInput[],
): Promise<void> {
  if (links.length === 0) return;
  await tx
    .insert(documentLinks)
    .values(links.map((l) => ({ orgId, ...l })))
    .onConflictDoNothing();
}
