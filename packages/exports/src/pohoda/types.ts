import type { DocumentClass, VatRateType, VatStatus, VatTreatment } from '@shoebox/domain';

export type PohodaPaymentMethod =
  | 'bank_transfer'
  | 'card'
  | 'cash'
  | 'cod'
  | 'platform_offset'
  | 'other';

export interface PohodaLine {
  net: string;
  vat: string;
  gross: string;
  vatRateType: VatRateType;
  vatRatePct: string | null;
  vatTreatment: VatTreatment;
  categoryCode: string;
}

export interface PohodaVatSummaryRow {
  vatRateType: VatRateType;
  base: string;
  vat: string;
}

export interface PohodaPartner {
  name: string;
  ico: string | null;
  dic: string | null;
  street: string | null;
  city: string | null;
  zip: string | null;
  country: string | null;
}

export interface PohodaDocument {
  id: string;
  revision: number;
  class: DocumentClass;
  issueDate: string;
  duzp: string | null;
  receivedDate: string | null;
  vatPointDate: string | null;
  dueDate: string | null;
  documentNumber: string | null;
  variableSymbol: string | null;
  summary: string | null;
  currency: string;
  paymentMethod: PohodaPaymentMethod | null;
  payToAccount: { accountNumber: string; bankCode: string } | null;
  partner: PohodaPartner | null;
  lines: PohodaLine[];
  vatSummary: PohodaVatSummaryRow[];
}

export interface PohodaProfile {
  vatStatus: VatStatus;
  ico: string;
  /** Pohoda cash register code (`typ:ids`); required for cash receipts to become vouchers. */
  cashAccount?: string;
  classificationVAT: Partial<Record<VatTreatment, string>>;
  /** Keys are category codes or category group names (`expense`, `asset`, ...). */
  accounting: Record<string, string>;
  categoryLabel(code: string): string;
}

export interface PohodaInput {
  periodLabel: string;
  version: number;
  documents: PohodaDocument[];
}

export type PohodaAgenda = 'invoice' | 'intDoc' | 'voucher';

export type PohodaWarningCode =
  | 'cash_account_missing'
  | 'foreign_currency'
  | 'truncated'
  | 'unmapped_classification'
  | 'unmapped_accounting';

export interface PohodaWarning {
  code: PohodaWarningCode;
  documentId: string;
  /** Field name for `truncated`. */
  detail?: string;
  /** Number of affected items for the `unmapped_*` codes. */
  count?: number;
}

export interface PohodaItemRef {
  documentId: string;
  itemId: string;
  agenda: PohodaAgenda;
}

export interface PohodaResult {
  xml: string;
  items: PohodaItemRef[];
  warnings: PohodaWarning[];
}
