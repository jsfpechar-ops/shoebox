// Canonical enums (04 is the source of truth, 05 §1 is the DDL). Each union is derived from its
// value list, so the runtime list and the type can never drift. Change = migration + 05 edit + here.

export const VAT_STATUS_VALUES = ['neplatce', 'identifikovana_osoba', 'platce'] as const;
export type VatStatus = (typeof VAT_STATUS_VALUES)[number];

export const VAT_PERIOD_VALUES = ['monthly', 'quarterly'] as const;
export type VatPeriod = (typeof VAT_PERIOD_VALUES)[number];

export const TAX_REGIME_VALUES = [
  'danova_evidence',
  'pausalni_vydaje',
  'pausalni_dan',
  'ucetnictvi',
] as const;
export type TaxRegime = (typeof TAX_REGIME_VALUES)[number];

export const MEMBER_ROLE_VALUES = ['owner', 'member', 'accountant', 'viewer'] as const;
export type MemberRole = (typeof MEMBER_ROLE_VALUES)[number];

export const DOCUMENT_CLASS_VALUES = [
  'received_invoice',
  'received_receipt',
  'received_credit_note',
  'received_advance_tax_doc',
  'received_proforma',
  'issued_invoice',
  'issued_credit_note',
  'platform_statement',
  'settlement_statement',
  'order_confirmation',
  'delivery_note',
  'bank_statement',
  'government_filing',
  'contract',
  'other_supporting',
  'non_document',
  'unknown',
] as const;
export type DocumentClass = (typeof DOCUMENT_CLASS_VALUES)[number];

export const DOCUMENT_STATUS_VALUES = [
  'received',
  'splitting',
  'classifying',
  'extracting',
  'validating',
  'categorizing',
  'needs_review',
  'ready',
  'finalized',
  'supporting',
  'duplicate',
  'failed',
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUS_VALUES)[number];

export const TAX_DOC_STATUS_VALUES = [
  'full_tax_document',
  'simplified_tax_document',
  'not_tax_document',
  'foreign_document',
  'unknown',
] as const;
export type TaxDocStatus = (typeof TAX_DOC_STATUS_VALUES)[number];

/** in = expense side (received), out = income side (issued). */
export const DIRECTION_VALUES = ['in', 'out'] as const;
export type Direction = (typeof DIRECTION_VALUES)[number];

export const LINE_TYPE_VALUES = [
  'item',
  'discount',
  'shipping',
  'fee',
  'rounding',
  'advance_deduction',
  'deposit',
  'text',
] as const;
export type LineType = (typeof LINE_TYPE_VALUES)[number];

export const VAT_RATE_TYPE_VALUES = ['standard', 'reduced', 'zero', 'none'] as const;
export type VatRateType = (typeof VAT_RATE_TYPE_VALUES)[number];

export const VAT_TREATMENT_VALUES = [
  'rcv_domestic_vat',
  'rcv_domestic_no_vat',
  'rcv_eu_service_reverse_charge',
  'rcv_non_eu_service_reverse_charge',
  'rcv_eu_goods_acquisition',
  'rcv_domestic_reverse_charge',
  'rcv_import_customs',
  'rcv_foreign_vat_charged',
  'rcv_out_of_scope',
  'iss_domestic_vat',
  'iss_eu_service',
  'iss_eu_goods',
  'iss_non_eu_service',
  'iss_export_goods',
  'iss_domestic_reverse_charge',
  'iss_exempt',
  'iss_no_vat',
] as const;
export type VatTreatment = (typeof VAT_TREATMENT_VALUES)[number];

export const TAX_EFFECT_VALUES = [
  'taxable_income',
  'non_taxable_income',
  'deductible_expense',
  'non_deductible_expense',
  'asset',
  'pass_through',
  'transfer',
  'tax_or_insurance_payment',
  'private',
] as const;
export type TaxEffect = (typeof TAX_EFFECT_VALUES)[number];

/** Typed (manual entry) and spreadsheet-imported values are 'user' (04 §2.2a). */
export const FIELD_SOURCE_VALUES = [
  'isdoc',
  'qr',
  'pdf_text',
  'template',
  'llm',
  'llm_escalated',
  'registry',
  'rule',
  'vendor_memory',
  'user',
  'derived',
] as const;
export type FieldSource = (typeof FIELD_SOURCE_VALUES)[number];

export const SEVERITY_VALUES = ['blocking', 'warning', 'info'] as const;
export type Severity = (typeof SEVERITY_VALUES)[number];

export const VALIDATION_STATE_VALUES = ['open', 'resolved', 'dismissed'] as const;
export type ValidationState = (typeof VALIDATION_STATE_VALUES)[number];

export const MONEY_ACCOUNT_TYPE_VALUES = ['bank', 'cash', 'card', 'platform'] as const;
export type MoneyAccountType = (typeof MONEY_ACCOUNT_TYPE_VALUES)[number];

export const TX_SOURCE_VALUES = [
  'statement_file',
  'email_notice',
  'bank_api',
  'manual',
  'document_evidence',
] as const;
export type TxSource = (typeof TX_SOURCE_VALUES)[number];

export const LINK_TYPE_VALUES = [
  'payment',
  'refund',
  'fee',
  'fx_difference',
  'platform_payout',
  'offset',
] as const;
export type LinkType = (typeof LINK_TYPE_VALUES)[number];

export const MATCH_METHOD_VALUES = [
  'vs_amount',
  'vs_only',
  'amount_date_counterparty',
  'card_merchant_fuzzy',
  'platform_statement',
  'manual',
  'document_evidence',
] as const;
export type MatchMethod = (typeof MATCH_METHOD_VALUES)[number];

export const DOC_LINK_KIND_VALUES = [
  'duplicate_of',
  'corrects',
  'settles',
  'supports',
  'fulfills',
  'reported_in',
  'same_period_reconciles',
] as const;
export type DocLinkKind = (typeof DOC_LINK_KIND_VALUES)[number];

export const FILING_TYPE_VALUES = [
  'DPHDP3',
  'DPHKH1',
  'DPHSHV',
  'DPFDP7_PARTIAL',
  'PODKLADY_DPFO',
  'VAT_WORKBOOK',
] as const;
export type FilingType = (typeof FILING_TYPE_VALUES)[number];

export const FILING_KIND_VALUES = ['radne', 'opravne', 'dodatecne', 'nasledne'] as const;
export type FilingKind = (typeof FILING_KIND_VALUES)[number];

export const FILING_STATE_VALUES = [
  'draft',
  'generated',
  'downloaded',
  'marked_filed',
  'superseded',
] as const;
export type FilingState = (typeof FILING_STATE_VALUES)[number];

/** imported = the user's own filed return (M05 §4.11). */
export const FILING_ORIGIN_VALUES = ['generated', 'imported'] as const;
export type FilingOrigin = (typeof FILING_ORIGIN_VALUES)[number];

export const PACKAGE_STATE_VALUES = ['draft', 'ready', 'sent', 'acknowledged'] as const;
export type PackageState = (typeof PACKAGE_STATE_VALUES)[number];

/** Every 05 §1 Postgres enum by its SQL type name, in 05 order. Used by tests and later by db checks. */
export const ENUMS = {
  vat_status: VAT_STATUS_VALUES,
  vat_period: VAT_PERIOD_VALUES,
  tax_regime: TAX_REGIME_VALUES,
  member_role: MEMBER_ROLE_VALUES,
  document_class: DOCUMENT_CLASS_VALUES,
  document_status: DOCUMENT_STATUS_VALUES,
  tax_doc_status: TAX_DOC_STATUS_VALUES,
  direction: DIRECTION_VALUES,
  line_type: LINE_TYPE_VALUES,
  vat_rate_type: VAT_RATE_TYPE_VALUES,
  vat_treatment: VAT_TREATMENT_VALUES,
  tax_effect: TAX_EFFECT_VALUES,
  field_source: FIELD_SOURCE_VALUES,
  severity: SEVERITY_VALUES,
  validation_state: VALIDATION_STATE_VALUES,
  money_account_type: MONEY_ACCOUNT_TYPE_VALUES,
  tx_source: TX_SOURCE_VALUES,
  link_type: LINK_TYPE_VALUES,
  match_method: MATCH_METHOD_VALUES,
  doc_link_kind: DOC_LINK_KIND_VALUES,
  filing_type: FILING_TYPE_VALUES,
  filing_kind: FILING_KIND_VALUES,
  filing_state: FILING_STATE_VALUES,
  filing_origin: FILING_ORIGIN_VALUES,
  package_state: PACKAGE_STATE_VALUES,
} as const;

export type EnumName = keyof typeof ENUMS;

/** Narrows an unknown string to a member of the named enum (for parsing DB rows and inputs). */
export function isEnumValue<N extends EnumName>(
  name: N,
  value: string,
): value is (typeof ENUMS)[N][number] {
  return (ENUMS[name] as readonly string[]).includes(value);
}
