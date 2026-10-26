import type { DocumentClass, DocumentStatus, LegalDate, MatchMethod, Money } from '@shoebox/domain';

export interface TxView {
  readonly id: string;
  readonly moneyAccountId: string;
  readonly bookedOn: LegalDate;
  /** Signed, account currency (+ incoming, − outgoing). */
  readonly amount: Money;
  readonly currency: string;
  /** Signed, original currency, when the bank gives one. */
  readonly amountOriginal?: Money;
  /** |amount| − Σ linked account-currency amounts; undefined = nothing linked yet. */
  readonly remaining?: Money;
  readonly counterpartyName?: string;
  /** Normalised `[prefix-]number` (no leading zeros). */
  readonly counterpartyAccount?: string;
  readonly counterpartyBankCode?: string;
  readonly counterpartyIban?: string;
  /** Normalised (digits, no leading zeros). */
  readonly vs?: string;
  readonly message?: string;
  readonly cardMerchant?: string;
  readonly bankTxCode?: string;
}
export interface DocView {
  readonly id: string;
  readonly cls: DocumentClass;
  readonly status: DocumentStatus;
  readonly direction: 'in' | 'out' | null;
  readonly currency: string;
  /** coalesce(amount_due, total_gross), document currency. */
  readonly amountDue: Money;
  /** amountDue − Σ links (M07 §4.6.2), document currency. */
  readonly openAmount: Money;
  readonly documentNumber?: string | undefined;
  readonly variableSymbol?: string | undefined;
  readonly issueDate?: LegalDate;
  readonly dueDate?: LegalDate;
  readonly servicePeriodTo?: LegalDate;
  readonly paymentMethod?: string;
  readonly partnerId?: string;
  readonly partnerName?: string;
  /** pay_to_account plus partner_bank_accounts, each `[prefix-]number/bank` or an IBAN. */
  readonly partnerAccounts: readonly string[];
  /** ISO timestamp; tie-breaker only. */
  readonly createdAt: string;
}
export interface AliasView {
  readonly kind: 'account' | 'merchant' | 'name';
  readonly value: string;
  readonly partnerId: string;
  readonly confirmations: number;
}
export interface MatchContext {
  readonly aliases: readonly AliasView[];
  /** `${transactionId}:${documentId}` of suggestions the user rejected. */
  readonly rejected: ReadonlySet<string>;
  /** partner_bank_accounts: `[prefix-]number/bank` or IBAN → partner. */
  readonly knownAccounts: readonly { readonly value: string; readonly partnerId: string }[];
  /** Partners that used a VS on at least one confirmed match. */
  readonly partnersWithVsHistory: ReadonlySet<string>;
  /** Account-currency units per one unit of `currency` on `on` (decimal string); null = unknown. */
  readonly fxRate: (currency: string, on: LegalDate) => string | null;
}
export type RetrievalKey = 'vs' | 'message' | 'amount' | 'account' | 'name';
export interface Candidate {
  readonly t: TxView;
  readonly d: DocView;
  readonly via: readonly RetrievalKey[];
}
export type AmountKind = 'exact' | 'rounding' | 'fx' | 'partial' | 'overpayment';
export interface AmountFeature {
  readonly kind: AmountKind;
  /** fx: 1 − |Δ%| / tol%; otherwise 1. */
  readonly ratio: number;
  /** Proposed link amount, document currency. */
  readonly amountDoc: Money;
  /** Proposed link amount, account currency. */
  readonly amountAccount: Money;
}
export type FeatureCode =
  | 'amount_exact'
  | 'amount_rounding'
  | 'amount_fx'
  | 'amount_partial'
  | 'vs_exact'
  | 'vs_conflict'
  | 'msg_doc_number'
  | 'account_match'
  | 'account_other_partner'
  | 'name'
  | 'date'
  | 'date_outside'
  | 'alias'
  | 'unique';
export interface Feature {
  readonly code: FeatureCode;
  readonly contribution: number;
}
export interface CandidateScore {
  readonly transactionId: string;
  readonly documentId: string;
  /** σ(logit) rounded to 3 decimals, then capped (M07 §4.6.3). */
  readonly score: number;
  readonly logit: number;
  readonly features: readonly Feature[];
  readonly method: MatchMethod;
  readonly amount: AmountFeature;
  readonly txRemaining: Money;
  readonly docOpen: Money;
  readonly anchorDistanceDays: number;
  readonly dueDate?: LegalDate | undefined;
  readonly docCreatedAt: string;
  readonly capped: boolean;
}
