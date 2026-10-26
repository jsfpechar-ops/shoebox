// Types and the policy schema of the simple-period classifier (brief 0331), split out so that
// checks-accountant.ts can import them without an import cycle.
import { z } from 'zod';
import type { LegalDate } from '../dates/index';
import {
  DOCUMENT_CLASS_VALUES,
  type DocumentClass,
  type DocumentStatus,
  LINE_TYPE_VALUES,
  type LineType,
  type TaxDocStatus,
  VAT_TREATMENT_VALUES,
  type VatPeriod,
  type VatRateType,
  type VatStatus,
  type VatTreatment,
} from '../enums/index';
import type { BusinessFlag, VatLedgerEntryDraft } from './ledger';

export type SimpleCheckCode =
  | 'S_PROFILE_UNSUPPORTED'
  | 'S_PROFILE_CHANGED_IN_PERIOD'
  | 'S_ENTRY_BEFORE_STATUS'
  | 'S_TREATMENT_NOT_ALLOWED'
  | 'S_RC_COMMODITY'
  | 'S_FORBIDDEN_CLASS'
  | 'S_EU_GOODS_MULTI_RATE'
  | 'S_PRIOR_PERIOD_CREDIT_NOTE'
  | 'S_PARTIAL_SHARE_DEDUCTION'
  | 'S_PLATFORM_INCOME_PAYER'
  | 'S_IO_OUTPUT_VAT'
  | 'S_MAX_DOCS'
  | 'S_IO_NEGATIVE_TAX'
  | 'S_PENDING_DOCUMENTS'
  | 'S_BLOCKING_VALIDATION'
  | 'S_BUSINESS_FLAG_UNKNOWN'
  | 'S_FX_MISSING'
  | 'S_DATE_MISSING'
  | 'S_SELF_ASSESSED_RATE_UNKNOWN'
  | 'S_MIXED_TREATMENT_SAME_RATE'
  | 'S_KH_DIC_MISSING'
  | 'S_KH_EVIDENCE_NUMBER_MISSING'
  | 'S_DOMESTIC_NOT_TAX_DOC'
  | 'S_SH_VAT_ID_INVALID';
export type SimpleOutcome = 'pass' | 'not_ready' | 'needs_accountant';
export interface SimpleCheck {
  readonly code: SimpleCheckCode;
  readonly outcome: SimpleOutcome;
  readonly documentIds: string[];
  readonly params: Record<string, string | number>;
}
export type SimpleVerdict = 'simple' | 'not_ready' | 'needs_accountant' | 'nothing_to_file';
export interface SimpleCheckResult {
  readonly verdict: SimpleVerdict;
  readonly checks: SimpleCheck[];
  readonly policyVersion: string;
  readonly rulesDate: string;
  readonly evaluatedAt: string;
}
export interface PeriodLine {
  readonly lineType: LineType;
  readonly vatTreatment: VatTreatment | null;
  readonly vatRateType: VatRateType;
  readonly businessSharePct: string;
  readonly rcCommodityCode: string | null;
  readonly categoryCode: string | null;
  readonly linkedIssuedInvoiceId: string | null;
}
export interface PeriodDocument {
  readonly documentId: string;
  readonly class: DocumentClass;
  readonly status: DocumentStatus;
  readonly taxDocStatus: TaxDocStatus;
  readonly businessFlag: BusinessFlag;
  readonly vatPointDate: LegalDate | null;
  readonly correctsDocumentId: string | null;
  readonly correctsVatPointDate: LegalDate | null;
  readonly partner: {
    readonly dic: string | null;
    readonly vatId: string | null;
    readonly vatIdValid: boolean | null;
    readonly documentShowsDic: boolean;
  };
  readonly lines: readonly PeriodLine[];
  readonly hasBlockingValidation: boolean;
}
export interface ProfileVersion {
  readonly validFrom: LegalDate;
  readonly validTo: LegalDate | null;
  readonly vatStatus: VatStatus;
  readonly vatPeriod: VatPeriod | null;
  readonly entityType: 'osvc' | 'sro';
}
export interface LedgerIssueRef {
  readonly code:
    | 'S_FX_MISSING'
    | 'S_DATE_MISSING'
    | 'S_SELF_ASSESSED_RATE_UNKNOWN'
    | 'S_MIXED_TREATMENT_SAME_RATE';
  readonly documentId: string;
}
export interface PeriodClassifierInput {
  readonly status: VatStatus;
  readonly period: { readonly start: LegalDate; readonly end: LegalDate };
  readonly entries: readonly VatLedgerEntryDraft[];
  readonly documents: readonly PeriodDocument[];
  readonly profiles: readonly ProfileVersion[];
  readonly ledgerIssues: readonly LedgerIssueRef[];
  readonly evaluatedAt: string;
}

/** Strict form of the `vat.simple_period_policy` value (0328 CZ_SIMPLE_PERIOD_POLICY). */
export const SimplePeriodPolicySchema = z.strictObject({
  version: z.string().min(1),
  allowed_treatments: z.strictObject({
    identifikovana_osoba: z.array(z.enum(VAT_TREATMENT_VALUES)),
    platce: z.array(z.enum(VAT_TREATMENT_VALUES)),
  }),
  forbid_document_classes: z.array(z.enum(DOCUMENT_CLASS_VALUES)),
  forbid_line_types: z.array(z.enum(LINE_TYPE_VALUES)),
  max_docs: z.number().int().nonnegative(),
  max_rates_per_eu_goods_document: z.number().int().nonnegative(),
  allow_partial_business_share_on_deduction: z.boolean(),
  allow_prior_period_credit_notes: z.boolean(),
});
/** Named apart from 0328's `SimplePeriodPolicy` type, which is already exported from rules. */
export type ParsedSimplePeriodPolicy = z.infer<typeof SimplePeriodPolicySchema>;

export interface SimpleCheckContext {
  readonly input: PeriodClassifierInput;
  readonly policy: ParsedSimplePeriodPolicy;
  readonly isPayer: boolean;
  readonly isIo: boolean;
  readonly entriesByDocument: ReadonlyMap<string, readonly VatLedgerEntryDraft[]>;
  readonly docsById: ReadonlyMap<string, PeriodDocument>;
  /** vat.kh_document_limit at the period start, in whole CZK. */
  readonly khDocumentLimitCzk: number;
}
/** null = pass. */
export type SimpleCheckFn = (ctx: SimpleCheckContext) => Omit<SimpleCheck, 'code'> | null;
