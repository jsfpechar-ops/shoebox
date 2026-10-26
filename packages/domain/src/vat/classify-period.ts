// The simple-period classifier skeleton (M05 §4.3, brief 0331). Pure: input in, verdict out.
// Rules come from `rules.at(period.start)`; the policy is parsed with the strict schema below.
import type { createCzRules } from '../rules/index';
import { ACCOUNTANT_CHECKS, RETURN_ROWS_3_13, uniqueSorted } from './checks-accountant';
import {
  type PeriodClassifierInput,
  type SimpleCheck,
  type SimpleCheckCode,
  type SimpleCheckContext,
  type SimpleCheckFn,
  type SimpleCheckResult,
  SimplePeriodPolicySchema,
  type SimpleVerdict,
} from './classify-period-types';
import type { VatLedgerEntryDraft } from './ledger';

export { RETURN_ROWS_3_13 } from './checks-accountant';
export * from './classify-period-types';

type CzRules = ReturnType<typeof createCzRules>;

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
