import {
  type CanonicalTx,
  computeDedupeHash,
  type DetectionResult,
  dedupeSeqs,
  detectStatementFormat,
  type ParsedStatement,
  parseStatement,
  StatementFormatNeededError,
  StatementTooLargeError,
} from '@shoebox/bank';
import type {
  AccountIdentity,
  findOrCreateMoneyAccount,
  findStatementImport,
  insertStatementImport,
  insertStatementTransactions,
  loadStatementSource,
  MoneyAccountRef,
  StatementImportInsert,
  StatementTxInsert,
} from '@shoebox/db';
import type { TenantHandler } from '../registry';

export interface BankImportDeps {
  readonly blobs: { get(path: string): Promise<Uint8Array> };
  readonly store: {
    loadSource: typeof loadStatementSource;
    findImport: typeof findStatementImport;
    findOrCreateAccount: typeof findOrCreateMoneyAccount;
    insertImport: typeof insertStatementImport;
    insertTransactions: typeof insertStatementTransactions;
  };
}

const FIO_BANK_CODE = '2010';
const PARTIAL_THRESHOLD = 0.05;

type Header = Omit<
  StatementImportInsert,
  'orgId' | 'moneyAccountId' | 'sourceFileId' | 'txTotal' | 'state' | 'errors'
>;

function emptyHeader(format: string): Header {
  return {
    format,
    parserVersion: 0,
    periodFrom: null,
    periodTo: null,
    statementNumber: null,
    openingBalance: null,
    closingBalance: null,
    balanceCheck: 'not_available',
  };
}

function headerOf(p: ParsedStatement): Header {
  return {
    format: p.format,
    parserVersion: p.parserVersion,
    periodFrom: p.periodFrom ?? null,
    periodTo: p.periodTo ?? null,
    statementNumber: p.statementNumber ?? null,
    openingBalance: p.openingBalance?.toFixed2() ?? null,
    closingBalance: p.closingBalance?.toFixed2() ?? null,
    balanceCheck: p.balanceCheck ?? 'not_available',
  };
}

function toTxRow(t: CanonicalTx, account: MoneyAccountRef, seq: number): StatementTxInsert {
  return {
    externalId: t.externalId ?? null,
    dedupeHash: t.externalId === undefined ? computeDedupeHash(account.id, t, seq) : null,
    bookedOn: t.bookedOn,
    valueDate: t.valueDate ?? null,
    amount: t.amount.toFixed2(),
    currency: account.currency,
    amountOriginal: t.amountOriginal?.toFixed2() ?? null,
    currencyOriginal: t.amountOriginal ? account.currency : null,
    counterpartyName: t.counterparty.name ?? null,
    counterpartyAccount: t.counterparty.account ?? null,
    counterpartyBankCode: t.counterparty.bankCode ?? null,
    counterpartyIban: t.counterparty.iban ?? null,
    vs: t.vs ?? null,
    ks: t.ks ?? null,
    ss: t.ss ?? null,
    message: t.message ?? null,
    cardMerchant: t.cardMerchant ?? null,
    cardLast4: t.cardLast4 ?? null,
    isReversal: t.isReversal ?? false,
    raw: t.raw,
  };
}

/** bank.import.statement: one uploaded statement file → statement_imports row + transactions. */
export function createBankImportHandler(
  deps: BankImportDeps,
): TenantHandler<{ orgId: string; sourceFileId: string }> {
  return async ({ orgId, sourceFileId }, ctx) => {
    const tx = ctx.tx;
    const source = await deps.store.loadSource(tx, sourceFileId);
    if (source === null) return;
    if ((await deps.store.findImport(tx, orgId, sourceFileId)) !== null) return;

    const failed = (
      format: string,
      state: 'failed' | 'needs_mapping',
      errors: StatementImportInsert['errors'],
    ): Promise<string> =>
      deps.store.insertImport(tx, {
        ...emptyHeader(format),
        orgId,
        moneyAccountId: null,
        sourceFileId,
        txTotal: 0,
        state,
        errors,
      });

    const bytes = await deps.blobs.get(source.storagePath);

    let detection: DetectionResult;
    try {
      detection = detectStatementFormat(bytes, source.originalFilename ?? undefined);
    } catch (err) {
      if (err instanceof StatementTooLargeError) {
        await failed('unknown', 'failed', [{ code: err.code }]);
        return;
      }
      throw err;
    }

    if (detection.format === 'unsupported_pdf') {
      await failed('unsupported_pdf', 'failed', [{ code: 'bank.import.pdf' }]);
      return;
    }

    let parsed: ParsedStatement;
    try {
      parsed = parseStatement(
        bytes,
        detection,
        detection.format === 'gpc' ? { gpcProfile: 'gpc_generic' } : undefined,
      );
    } catch (err) {
      if (err instanceof StatementFormatNeededError) {
        await failed(detection.format, 'needs_mapping', []);
        return;
      }
      throw err;
    }

    const ref = parsed.account;
    if (!ref || (!ref.account && !ref.iban)) {
      await deps.store.insertImport(tx, {
        ...headerOf(parsed),
        orgId,
        moneyAccountId: null,
        sourceFileId,
        txTotal: 0,
        state: 'needs_account',
        errors: [],
      });
      return;
    }

    const identity: AccountIdentity = {
      ...(ref.account === undefined ? {} : { account: ref.account }),
      ...(ref.bankCode === undefined ? {} : { bankCode: ref.bankCode }),
      iban: ref.iban,
      ...(ref.currency === undefined ? {} : { currency: ref.currency }),
    };
    const account = await deps.store.findOrCreateAccount(tx, orgId, identity, parsed.format);

    let statement = parsed;
    if (detection.format === 'gpc' && account.bankCode === FIO_BANK_CODE) {
      statement = parseStatement(bytes, detection, { gpcProfile: 'gpc_fio' });
    }

    const warnings = statement.warnings;
    const total = statement.txs.length + warnings.length;
    const state =
      total > 0 && warnings.length / total > PARTIAL_THRESHOLD ? 'partially_parsed' : 'parsed';
    const errors = warnings.map((w) =>
      w.line === undefined ? { code: w.code } : { line: w.line, code: w.code },
    );

    const importId = await deps.store.insertImport(tx, {
      ...headerOf(statement),
      orgId,
      moneyAccountId: account.id,
      sourceFileId,
      txTotal: statement.txs.length,
      state,
      errors,
    });

    const seqs = dedupeSeqs(statement.txs);
    const rows = statement.txs.map((t, i) => toTxRow(t, account, seqs[i] ?? 0));
    await deps.store.insertTransactions(tx, orgId, account.id, importId, rows);
  };
}
