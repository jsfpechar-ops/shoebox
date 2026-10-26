// M05 §4.11: registers the org's own filed DPHDP3 (a government_filing document) as an
// origin='imported' filing, once per source document. Never marks a generated filing as filed:
// only government_filing documents whose DIČ is the org's own are used.

import type {
  DocumentLinkInput,
  FilingInsert,
  FilingRow,
  GovernmentFilingDocument,
  insertDocumentLinks,
  insertFiling,
  listFilings,
  readGovernmentFilingFields,
  TenantTx,
} from '@shoebox/db';
import {
  type ImportedFilingFields,
  importedTotals,
  type LegalDate,
  parseImportedFilingFields,
} from '@shoebox/domain';
import type { Logger } from '@shoebox/platform';

export interface ImportedStore {
  readonly readGovernmentFilingFields: typeof readGovernmentFilingFields;
  readonly insertDocumentLinks: typeof insertDocumentLinks;
  readonly listFilings: typeof listFilings;
  readonly insertFiling: typeof insertFiling;
}

export interface ImportedPeriod {
  readonly orgId: string;
  readonly periodStart: LegalDate;
  readonly periodEnd: LegalDate;
  /** Digits of the org's DIČ; null when the profile has none (nothing can be matched then). */
  readonly orgDicDigits: string | null;
  /** Ledger documents of the period; each gets a reported_in link to the filed return. */
  readonly ledgerDocumentIds: readonly string[];
  readonly now: Date;
}

/** Registers the period's own filed DPHDP3 (once) and returns its parsed fields, or null when none. */
export async function registerImportedFilings(
  tx: TenantTx,
  period: ImportedPeriod,
  store: ImportedStore,
  logger: Pick<Logger, 'info'>,
): Promise<ImportedFilingFields | null> {
  if (period.orgDicDigits === null) return null;
  const docs: GovernmentFilingDocument[] = await store.readGovernmentFilingFields(tx, period.orgId);
  for (const doc of docs) {
    const parsed = parseImportedFilingFields(doc.fields);
    if (parsed === null || parsed.formCode !== 'DPHDP3') continue;
    if (parsed.periodStart !== period.periodStart) continue;
    if (parsed.filerDicDigits !== period.orgDicDigits) continue; // someone else's return
    const existing: FilingRow[] = await store.listFilings(tx, period.orgId, {
      periodStart: period.periodStart,
      types: ['DPHDP3'],
    });
    const known = existing.some(
      (f) =>
        f.origin === 'imported' && f.sourceDocumentId === doc.documentId && f.kind === parsed.kind,
    );
    if (!known) {
      const filing: FilingInsert = {
        orgId: period.orgId,
        type: 'DPHDP3',
        kind: parsed.kind,
        origin: 'imported',
        sourceDocumentId: doc.documentId,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        state: 'marked_filed',
        totals: importedTotals(parsed),
        simpleCheck: null,
        markedFiledAt: period.now,
        filedOn: doc.issueDate,
      };
      const id = await store.insertFiling(tx, filing, [], []);
      const links: DocumentLinkInput[] = period.ledgerDocumentIds.map((fromDocumentId) => ({
        fromDocumentId,
        toDocumentId: doc.documentId,
        kind: 'reported_in',
      }));
      await store.insertDocumentLinks(tx, period.orgId, links);
      logger.info(
        {
          event: 'filing.imported',
          filingId: id,
          periodStart: period.periodStart,
          links: links.length,
        },
        'imported filed return registered',
      );
    }
    return parsed;
  }
  return null;
}
