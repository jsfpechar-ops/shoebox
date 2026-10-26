import type { OpenPageDocument } from '@shoebox/db';
import { type SortResult, supplierKeyOf } from '@shoebox/extraction';

const numberKey = (n: string): string => n.toUpperCase().replace(/\s+/g, '');

type PieceItem = SortResult['groups'][number][number]['item'];

/** The open document and the piece's item both have a value and the values differ. */
function differs(open: OpenPageDocument, item: PieceItem): boolean {
  const key = supplierKeyOf(item);
  if (open.supplierKey && key && open.supplierKey !== key) return true;
  return Boolean(
    open.docNumber && item.docNumber && numberKey(open.docNumber) !== numberKey(item.docNumber),
  );
}

/** Same number, or same supplier key. */
function alike(open: OpenPageDocument, item: PieceItem): boolean {
  if (open.docNumber && item.docNumber && numberKey(open.docNumber) === numberKey(item.docNumber)) {
    return true;
  }
  const key = supplierKeyOf(item);
  return Boolean(open.supplierKey && key && open.supplierKey === key);
}

/**
 * Groups of a new drop that may continue an open document of an earlier upload (0509): the
 * group's first piece does not start a document, and the open document does not differ from it
 * (both supplier keys set and different = differs; both numbers set and different = differs).
 * Among the open documents that do not differ, prefer one with the same number or the same
 * supplier key; otherwise the first (newest). One open document is used for one group at most.
 * Returns [{ group, otherDocumentId }] in group order.
 */
export function matchLatePages(
  result: SortResult,
  open: readonly OpenPageDocument[],
): { readonly group: number; readonly otherDocumentId: string }[] {
  const pool = [...open];
  const matches: { group: number; otherDocumentId: string }[] = [];
  for (const [group, pieces] of result.groups.entries()) {
    const first = pieces[0];
    if (!first || first.item.startsDocument) continue;
    const candidates = pool.filter((o) => !differs(o, first.item));
    const chosen = candidates.find((o) => alike(o, first.item)) ?? candidates[0];
    if (!chosen) continue;
    pool.splice(pool.indexOf(chosen), 1);
    matches.push({ group, otherDocumentId: chosen.documentId });
  }
  return matches;
}
