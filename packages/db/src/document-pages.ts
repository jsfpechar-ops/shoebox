import { asc, eq } from 'drizzle-orm';
import { documentPages } from './schema/document-pages';
import { sourceFiles } from './schema/documents';
import type { TenantTx } from './tenant';

/** One page (or one region of a page) of a sorted document, with its file. */
export interface DocumentPageForRead {
  readonly position: number;
  readonly sourceFileId: string;
  readonly storagePath: string;
  readonly mimeType: string;
  readonly filePage: number;
  readonly region: string;
}

/** The document's pages in order; [] when it has none (then the whole source file is the document). */
export async function loadDocumentPages(
  tx: TenantTx,
  documentId: string,
): Promise<DocumentPageForRead[]> {
  return tx
    .select({
      position: documentPages.position,
      sourceFileId: documentPages.sourceFileId,
      storagePath: sourceFiles.storagePath,
      mimeType: sourceFiles.mimeType,
      filePage: documentPages.filePage,
      region: documentPages.region,
    })
    .from(documentPages)
    .innerJoin(sourceFiles, eq(sourceFiles.id, documentPages.sourceFileId))
    .where(eq(documentPages.documentId, documentId))
    .orderBy(asc(documentPages.position));
}
