import type { LegalDate, Money } from '@shoebox/domain';

/** M07 §6.1. Only gpc, camt053 and mt940 have parsers so far. */
export type StatementFormat =
  | 'gpc'
  | 'camt053'
  | 'mt940'
  | 'fio_json'
  | 'csv_fio'
  | 'csv_cs'
  | 'json_cs_george'
  | 'csv_csob'
  | 'csv_kb'
  | 'csv_rb'
  | 'csv_airbank'
  | 'csv_moneta'
  | 'csv_unicredit'
  | 'csv_mbank'
  | 'csv_airbnb'
  | 'csv_booking'
  | 'csv_comgate'
  | 'csv_gopay'
  | 'csv_paypal'
  | 'csv_zasilkovna'
  | 'csv_generic';

export interface AccountRef {
  /** `[prefix-]number`, no leading zeros. */
  account?: string;
  bankCode?: string;
  iban?: string;
  bic?: string;
}

export interface CanonicalTx {
  externalId?: string;
  bookedOn: LegalDate;
  valueDate?: LegalDate;
  /** Signed: + incoming, − outgoing, in account currency. */
  amount: Money;
  amountOriginal?: Money;
  counterparty: AccountRef & { name?: string };
  vs?: string;
  ks?: string;
  ss?: string;
  message?: string;
  cardMerchant?: string;
  cardLast4?: string;
  isReversal?: boolean;
  isPending?: boolean;
  bankTxCode?: string;
  raw: Record<string, unknown>;
}

export interface ParseWarning {
  line?: number;
  code: string;
  raw?: string;
}

export interface ParsedStatement {
  format: StatementFormat;
  parserVersion: number;
  profile?: string;
  account?: AccountRef & { currency?: string };
  periodFrom?: LegalDate;
  periodTo?: LegalDate;
  statementNumber?: string;
  openingBalance?: Money;
  closingBalance?: Money;
  controlDebit?: Money;
  controlCredit?: Money;
  /** 'ok' | 'mismatch'; undefined when the file has no balances. */
  balanceCheck?: 'ok' | 'mismatch';
  txs: CanonicalTx[];
  warnings: ParseWarning[];
}
