import type {
  DocumentLinkInput,
  FilingInsert,
  FilingRow,
  GovernmentFilingDocument,
  TenantTx,
} from '@shoebox/db';
import { parseLegalDate } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import {
  type ImportedPeriod,
  type ImportedStore,
  registerImportedFilings,
} from '../src/vat/imported';

const ORG = '11111111-1111-4111-8111-111111111111';
const AUG = parseLegalDate('2026-08-01');
const AUG_END = parseLegalDate('2026-08-31');
const OWN_DIC = '7801011229';
const tx = {} as TenantTx;
const logger = { info: () => undefined };

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected a value');
  return value;
}

/** Invented P4 decoy: a DPHDP3 for August filed by the org itself. */
function decoy(filerDic: string, documentId: string): GovernmentFilingDocument {
  return {
    documentId,
    issueDate: '2026-09-25',
    fields: [
      { key: 'filing.form_code', value: 'DPHDP3' },
      { key: 'filing.period_start', value: '2026-08' },
      { key: 'filing.kind', value: 'radne' },
      { key: 'filing.filer_dic', value: `CZ${filerDic}` },
      { key: 'filing.rows.5.base', value: '13 700' },
      { key: 'filing.rows.5.tax', value: '2877' },
      { key: 'filing.rows.62.tax', value: '2877' },
    ],
  };
}

function fakeStore(documents: GovernmentFilingDocument[]) {
  const inserted: FilingInsert[] = [];
  const links: DocumentLinkInput[][] = [];
  const store: ImportedStore = {
    readGovernmentFilingFields: async () => documents,
    insertDocumentLinks: async (_tx, _org, batch) => {
      links.push([...batch]);
    },
    listFilings: async () =>
      inserted.map(
        (f, i) =>
          ({
            id: `f${i}`,
            type: f.type,
            kind: f.kind,
            origin: f.origin ?? 'generated',
            periodStart: f.periodStart,
            periodEnd: f.periodEnd,
            state: f.state,
            sourceDocumentId: f.sourceDocumentId ?? null,
          }) as unknown as FilingRow,
      ),
    insertFiling: async (_tx, filing) => {
      inserted.push(filing);
      return `f${inserted.length - 1}`;
    },
  };
  return { store, inserted, links };
}

const PERIOD: ImportedPeriod = {
  orgId: ORG,
  periodStart: AUG,
  periodEnd: AUG_END,
  orgDicDigits: OWN_DIC,
  ledgerDocumentIds: ['ledger-doc-1'],
  now: new Date('2026-09-26T10:00:00Z'),
};

describe('registerImportedFilings (M05 §4.11)', () => {
  it('registers the decoy once as an imported filing and links the ledger documents', async () => {
    const { store, inserted, links } = fakeStore([decoy(OWN_DIC, 'decoy-doc')]);
    const parsed = must(await registerImportedFilings(tx, PERIOD, store, logger));
    expect(parsed.rows['5']).toEqual({ base: 13700, tax: 2877 });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      origin: 'imported',
      state: 'marked_filed',
      sourceDocumentId: 'decoy-doc',
      kind: 'radne',
      filedOn: '2026-09-25',
    });
    expect(inserted[0]?.totals).toMatchObject({ source: 'imported' });
    expect(links).toEqual([
      [{ fromDocumentId: 'ledger-doc-1', toDocumentId: 'decoy-doc', kind: 'reported_in' }],
    ]);
  });

  it('a second run creates no duplicate filing and no duplicate links', async () => {
    const { store, inserted, links } = fakeStore([decoy(OWN_DIC, 'decoy-doc')]);
    await registerImportedFilings(tx, PERIOD, store, logger);
    const again = await registerImportedFilings(tx, PERIOD, store, logger);
    expect(again).not.toBeNull();
    expect(inserted).toHaveLength(1);
    expect(links).toHaveLength(1);
  });

  it('ignores a return filed under a foreign DIC', async () => {
    const { store, inserted, links } = fakeStore([decoy('99999999', 'foreign-doc')]);
    expect(await registerImportedFilings(tx, PERIOD, store, logger)).toBeNull();
    expect(inserted).toHaveLength(0);
    expect(links).toHaveLength(0);
  });
});
