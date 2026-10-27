// Documents that still wait for categorization (brief 0622): ready or needs_review, not deleted,
// with lines, with the inputs planCategorization needs, and no stage_version.categorize yet.
import { and, asc, eq, exists, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { documentLines } from './schema/document-details';
import { documents } from './schema/documents';
import type { TenantTx } from './tenant';

export interface DocumentToCategorize {
  readonly id: string;
  readonly revision: number;
}

export async function listDocumentsToCategorize(
  tx: TenantTx,
  orgId: string,
  limit: number,
): Promise<DocumentToCategorize[]> {
  return tx
    .select({ id: documents.id, revision: documents.revision })
    .from(documents)
    .where(
      and(
        eq(documents.orgId, orgId),
        isNull(documents.deletedAt),
        inArray(documents.status, ['ready', 'needs_review']),
        isNotNull(documents.direction),
        isNotNull(documents.issueDate),
        sql`${documents.stageVersion} -> 'categorize' is null`,
        exists(
          tx
            .select({ one: sql`1` })
            .from(documentLines)
            .where(
              and(eq(documentLines.orgId, orgId), eq(documentLines.documentId, documents.id)),
            ),
        ),
      ),
    )
    .orderBy(asc(documents.createdAt))
    .limit(limit);
}
