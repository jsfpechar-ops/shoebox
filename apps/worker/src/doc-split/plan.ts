import type { SortPlan, SortPlanDocument, SplitBatchFile, SplitRun } from '@shoebox/db';
import { type SortResult, supplierKeyOf } from '@shoebox/extraction';

/**
 * The plan for one drop. `files[i]` is fileIndex i of the grouping.
 * - Group by group, in order: reuse the document of the first piece's file if that document is not
 *   used yet; otherwise a new document (documentId null) on that file, with that file's receivedDate.
 * - Pages: one row per piece, in order: sourceFileId of its file, filePage, region, supplierKey =
 *   supplierKeyOf(item), docNumber, labelN, labelOf, hasTotals, startsDocument from the item.
 * - deleteDocumentIds: the files' documents not reused, in file order.
 * - questions: result.questions as they are; runs: as given.
 */
export function planSort(
  orgId: string,
  batchId: string,
  files: readonly SplitBatchFile[],
  result: SortResult,
  runs: readonly SplitRun[],
): SortPlan {
  const usedDocumentIds = new Set<string>();
  const planDocuments: SortPlanDocument[] = [];

  for (const group of result.groups) {
    const first = group[0];
    if (!first) continue;
    const firstFile = files[first.fileIndex];
    if (!firstFile) throw new Error(`planSort: no file for index ${first.fileIndex}`);

    const reuse = !usedDocumentIds.has(firstFile.documentId);
    if (reuse) usedDocumentIds.add(firstFile.documentId);

    planDocuments.push({
      documentId: reuse ? firstFile.documentId : null,
      sourceFileId: firstFile.sourceFileId,
      receivedDate: firstFile.receivedDate,
      pages: group.map((piece) => {
        const file = files[piece.fileIndex];
        if (!file) throw new Error(`planSort: no file for index ${piece.fileIndex}`);
        return {
          sourceFileId: file.sourceFileId,
          filePage: piece.filePage,
          region: piece.region,
          supplierKey: supplierKeyOf(piece.item),
          docNumber: piece.item.docNumber,
          labelN: piece.item.labelN,
          labelOf: piece.item.labelOf,
          hasTotals: piece.item.hasTotals,
          startsDocument: piece.item.startsDocument,
        };
      }),
    });
  }

  const deleteDocumentIds = files.map((f) => f.documentId).filter((id) => !usedDocumentIds.has(id));

  return {
    orgId,
    batchId,
    documents: planDocuments,
    deleteDocumentIds,
    questions: result.questions.map(([a, b]) => [a, b] as const),
    runs,
  };
}
