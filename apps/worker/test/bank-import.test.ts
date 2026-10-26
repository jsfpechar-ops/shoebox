import type { StatementImportInsert, StatementTxInsert, TenantTx } from '@shoebox/db';
import { describe, expect, it } from 'vitest';
import { type BankImportDeps, createBankImportHandler } from '../src/bank-import/handler';

const ORG = 'eeeeeeee-0000-4000-8000-000000000112';
const FILE = 'eeeeeeee-0000-4000-8000-0000000f0112';
const ctx = { tx: {} as TenantTx, jobId: 'j', attempt: 1, signal: new AbortController().signal };
const bytes = (text: string) => new TextEncoder().encode(text);

const STA = [
  ':20:STMT7',
  ':25:2400123455/2010',
  ':28C:7',
  ':60F:C260914CZK10000,00',
  ':61:2609150915C12100,00NTRF//12345678',
  ':86:/VS/2026001',
  ':61:2609160916D89,00NMSC',
  ':86:KAVA',
  ':62F:C260930CZK22011,00',
].join('\n');

function fake(file: Uint8Array | null, opts: { imported?: boolean; name?: string } = {}) {
  const imports: StatementImportInsert[] = [];
  const txs: StatementTxInsert[][] = [];
  const accounts: unknown[] = [];
  const deps: BankImportDeps = {
    blobs: { get: async () => file ?? new Uint8Array() },
    store: {
      loadSource: async () =>
        file === null ? null : { id: FILE, storagePath: `${ORG}/files/x`, originalFilename: opts.name ?? 'vypis.sta' },
      findImport: async () => (opts.imported ? 'imp-old' : null),
      findOrCreateAccount: async (_tx, _org, identity, format) => {
        accounts.push({ identity, format });
        return { id: 'acc-1', bankCode: '2010', currency: 'CZK', created: true };
      },
      insertImport: async (_tx, row) => {
        imports.push(row);
        return 'imp-1';
      },
      insertTransactions: async (_tx, _org, _acc, _imp, rows) => {
        txs.push([...rows]);
        return { inserted: rows.length, duplicates: 0, orphanReversals: 0 };
      },
    },
  };
  return { deps, imports, txs, accounts };
}

const run = (deps: BankImportDeps) => createBankImportHandler(deps)({ orgId: ORG, sourceFileId: FILE }, ctx);

describe('bank.import.statement', () => {
  it('imports an MT940 file: account, import row, transactions', async () => {
    const f = fake(bytes(STA));
    await run(f.deps);
    expect(f.accounts).toEqual([
      {
        identity: { account: '2400123455', bankCode: '2010', iban: 'CZ8720100000002400123455', currency: 'CZK' },
        format: 'mt940',
      },
    ]);
    expect(f.imports).toHaveLength(1);
    expect(f.imports[0]).toMatchObject({
      orgId: ORG,
      moneyAccountId: 'acc-1',
      sourceFileId: FILE,
      format: 'mt940',
      parserVersion: 1,
      periodFrom: '2026-09-14',
      periodTo: '2026-09-30',
      statementNumber: '7',
      openingBalance: '10000.00',
      closingBalance: '22011.00',
      balanceCheck: 'ok',
      txTotal: 2,
      state: 'parsed',
      errors: [],
    });
    const [inc, coffee] = f.txs[0] ?? [];
    expect(inc).toMatchObject({
      externalId: 'mt940:12345678',
      dedupeHash: null,
      amount: '12100.00',
      currency: 'CZK',
      vs: '2026001',
      bookedOn: '2026-09-15',
      isReversal: false,
    });
    expect(coffee?.externalId).toBeNull();
    expect(coffee?.dedupeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(coffee?.amount).toBe('-89.00');
    expect(coffee?.message).toBe('KAVA');
  });

  it('does nothing for a missing file or a file imported before', async () => {
    const gone = fake(null);
    await run(gone.deps);
    expect(gone.imports).toEqual([]);
    const again = fake(bytes(STA), { imported: true });
    await run(again.deps);
    expect(again.imports).toEqual([]);
  });

  it('records a PDF as failed and a CSV as needing a mapping', async () => {
    const pdf = fake(bytes('%PDF-1.7 ...'), { name: 'vypis.pdf' });
    await run(pdf.deps);
    expect(pdf.imports[0]).toMatchObject({
      format: 'unsupported_pdf',
      parserVersion: 0,
      moneyAccountId: null,
      state: 'failed',
      errors: [{ code: 'bank.import.pdf' }],
    });
    const csv = fake(bytes('date;amount\n2026-09-15;100\n'), { name: 'vypis.csv' });
    await run(csv.deps);
    expect(csv.imports[0]).toMatchObject({ format: 'csv_generic', state: 'needs_mapping', txTotal: 0 });
    expect(csv.txs).toEqual([]);
  });

  it('asks for the account when the file names none', async () => {
    const f = fake(bytes(':20:S\n:25:\n:60F:C260914CZK0,00\n:61:260915C5,00NTRF//R1\n:62F:C260915CZK5,00\n'));
    await run(f.deps);
    expect(f.imports[0]).toMatchObject({ format: 'mt940', state: 'needs_account', moneyAccountId: null });
    expect(f.accounts).toEqual([]);
  });

  it('records a file over 10 MB as failed', async () => {
    const f = fake(new Uint8Array(10 * 1024 * 1024 + 1));
    await run(f.deps);
    expect(f.imports[0]).toMatchObject({ state: 'failed', errors: [{ code: 'bank.import.too_large' }] });
  });
});
