// The simple-period classifier skeleton (M05 §4.3, brief 0331). Pure: input in, verdict out.
// Rules come from `rules.at(period.start)`; the policy is parsed with the strict schema below.
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
import type { createCzRules } from '../rules/index';
import { ACCOUNTANT_CHECKS, RETURN_ROWS_3_13, uniqueSorted } from './checks-accountant';
import type { BusinessFlag, VatLedgerEntryDraft } from './ledger';

export { RETURN_ROWS_3_13 } from './checks-accountant';

type CzRules = ReturnType<typeof createCzRules>;

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
}
/** null = pass. */
export type SimpleCheckFn = (ctx: SimpleCheckContext) => Omit<SimpleCheck, 'code'> | null;

/** Not-ready half of the registry: 0332 fills these in. Until then each one passes. */
const PENDING: SimpleCheckFn = () => null; // TODO(0332)

const ACCOUNTANT_BY_CODE = new Map<SimpleCheckCode, SimpleCheckFn>(ACCOUNTANT_CHECKS);

/** Order = the code list in M05 §4.3. Every code appears exactly once. */
const SIMPLE_CHECK_ORDER: readonly SimpleCheckCode[] = [
  'S_PROFILE_UNSUPPORTED',
  'S_PROFILE_CHANGED_IN_PERIOD',
  'S_ENTRY_BEFORE_STATUS',
  'S_TREATMENT_NOT_ALLOWED',
  'S_RC_COMMODITY',
  'S_FORBIDDEN_CLASS',
  'S_EU_GOODS_MULTI_RATE',
  'S_PRIOR_PERIOD_CREDIT_NOTE',
  'S_PARTIAL_SHARE_DEDUCTION',
  'S_PLATFORM_INCOME_PAYER',
  'S_IO_OUTPUT_VAT',
  'S_MAX_DOCS',
  'S_IO_NEGATIVE_TAX',
  'S_PENDING_DOCUMENTS',
  'S_BLOCKING_VALIDATION',
  'S_BUSINESS_FLAG_UNKNOWN',
  'S_FX_MISSING',
  'S_DATE_MISSING',
  'S_SELF_ASSESSED_RATE_UNKNOWN',
  'S_MIXED_TREATMENT_SAME_RATE',
  'S_KH_DIC_MISSING',
  'S_KH_EVIDENCE_NUMBER_MISSING',
  'S_DOMESTIC_NOT_TAX_DOC',
  'S_SH_VAT_ID_INVALID',
];

export const SIMPLE_CHECKS: ReadonlyArray<readonly [SimpleCheckCode, SimpleCheckFn]> =
  SIMPLE_CHECK_ORDER.map((code) => [code, ACCOUNTANT_BY_CODE.get(code) ?? PENDING] as const);

function groupByDocument(
  entries: readonly VatLedgerEntryDraft[],
): Map<string, VatLedgerEntryDraft[]> {
  const grouped = new Map<string, VatLedgerEntryDraft[]>();
  for (const entry of entries) {
    const list = grouped.get(entry.documentId);
    if (list) list.push(entry);
    else grouped.set(entry.documentId, [entry]);
  }
  return grouped;
}

function decideVerdict(
  input: PeriodClassifierInput,
  checks: readonly SimpleCheck[],
): SimpleVerdict {
  if (checks.some((c) => c.outcome === 'needs_accountant')) return 'needs_accountant';
  if (checks.some((c) => c.outcome === 'not_ready')) return 'not_ready';
  const hasReturnOrSh = input.entries.some(
    (e) => e.shvCode !== null || e.dphdp3Rows.some((row) => RETURN_ROWS_3_13.has(row)),
  );
  if (input.status === 'identifikovana_osoba' && !hasReturnOrSh) return 'nothing_to_file';
  return 'simple';
}

export function classifyPeriod(input: PeriodClassifierInput, rules: CzRules): SimpleCheckResult {
  const policy = SimplePeriodPolicySchema.parse(
    rules.at(input.period.start).get('vat.simple_period_policy'),
  );
  const ctx: SimpleCheckContext = {
    input,
    policy,
    isPayer: input.status === 'platce',
    isIo: input.status === 'identifikovana_osoba',
    entriesByDocument: groupByDocument(input.entries),
    docsById: new Map(input.documents.map((doc) => [doc.documentId, doc] as const)),
  };
  const checks: SimpleCheck[] = SIMPLE_CHECKS.map(([code, check]) => {
    const found = check(ctx);
    if (found === null) return { code, outcome: 'pass', documentIds: [], params: {} };
    return {
      code,
      outcome: found.outcome,
      documentIds: uniqueSorted(found.documentIds),
      params: found.params,
    };
  });
  return {
    verdict: decideVerdict(input, checks),
    checks,
    policyVersion: policy.version,
    rulesDate: input.period.start,
    evaluatedAt: input.evaluatedAt,
  };
}
