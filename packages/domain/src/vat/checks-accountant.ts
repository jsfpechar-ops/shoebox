// The needs_accountant checks, plus S_ENTRY_BEFORE_STATUS (not_ready), of the simple-period classifier
// (M05 §4.3, brief 0331). Pure. Imports from classify-period are type-only to avoid a runtime cycle.
import Decimal from 'decimal.js';
import { compareLegalDates } from '../dates/index';
import { CZK, Money } from '../money/index';
import type {
  PeriodDocument,
  PeriodLine,
  ProfileVersion,
  SimpleCheck,
  SimpleCheckCode,
  SimpleCheckContext,
  SimpleCheckFn,
} from './classify-period-types';

/** entry.dphdp3Rows that count toward the return (boxes 3 to 13). */
export const RETURN_ROWS_3_13: ReadonlySet<string> = new Set([
  '3',
  '4',
  '5',
  '6',
  '9',
  '10',
  '11',
  '12',
  '13',
]);

/** Sorted, de-duplicated document ids. */
export function uniqueSorted(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}

type Outcome = Omit<SimpleCheck, 'code'>;

function fail(documentIds: string[], params: Record<string, string | number> = {}): Outcome {
  return { outcome: 'needs_accountant', documentIds: uniqueSorted(documentIds), params };
}

function docIds(docs: readonly PeriodDocument[]): string[] {
  return docs.map((doc) => doc.documentId);
}

/** Profile versions that overlap the period (validFrom <= end and validTo >= start or open). */
function overlapping(ctx: SimpleCheckContext): ProfileVersion[] {
  const { start, end } = ctx.input.period;
  return ctx.input.profiles.filter(
    (p) =>
      compareLegalDates(p.validFrom, end) <= 0 &&
      (p.validTo === null || compareLegalDates(p.validTo, start) >= 0),
  );
}

const SELF_ASSESSED: ReadonlySet<string> = new Set([
  'rcv_domestic_vat',
  'rcv_eu_service_reverse_charge',
  'rcv_non_eu_service_reverse_charge',
  'rcv_eu_goods_acquisition',
]);

const ISSUED_OUTPUT: ReadonlySet<string> = new Set([
  'iss_domestic_vat',
  'iss_eu_service',
  'iss_eu_goods',
  'iss_non_eu_service',
]);

function isPartialShare(line: PeriodLine): boolean {
  if (line.vatTreatment === null || !SELF_ASSESSED.has(line.vatTreatment)) return false;
  const share = new Decimal(line.businessSharePct);
  return share.gt(0) && share.lt(100);
}

const profileUnsupported: SimpleCheckFn = (ctx) => {
  const unsupported =
    (!ctx.isPayer && !ctx.isIo) || overlapping(ctx).some((p) => p.entityType !== 'osvc');
  return unsupported ? fail([]) : null;
};

const profileChangedInPeriod: SimpleCheckFn = (ctx) => {
  const shapes = new Set(overlapping(ctx).map((p) => `${p.vatStatus}|${p.vatPeriod ?? ''}`));
  return shapes.size > 1 ? fail([]) : null;
};

const entryBeforeStatus: SimpleCheckFn = (ctx) => {
  const statusFrom = ctx.input.profiles
    .filter((p) => p.vatStatus === 'platce' || p.vatStatus === 'identifikovana_osoba')
    .map((p) => p.validFrom);
  if (statusFrom.length === 0) return null;
  const earliest = statusFrom.reduce((a, b) => (compareLegalDates(a, b) <= 0 ? a : b));
  const ids = ctx.input.entries
    .filter((e) => compareLegalDates(e.vatPointDate, earliest) < 0)
    .map((e) => e.documentId);
  if (ids.length === 0) return null;
  return { outcome: 'not_ready', documentIds: uniqueSorted(ids), params: { earliest } };
};

const treatmentNotAllowed: SimpleCheckFn = (ctx) => {
  const allowed = ctx.isPayer
    ? ctx.policy.allowed_treatments.platce
    : ctx.isIo
      ? ctx.policy.allowed_treatments.identifikovana_osoba
      : null;
  if (allowed === null) return null; // neplatce: S_PROFILE_UNSUPPORTED decides
  const bad = ctx.input.entries.filter((e) => !allowed.includes(e.vatTreatment));
  const first = bad[0];
  if (first === undefined) return null;
  return fail(
    bad.map((e) => e.documentId),
    { treatment: first.vatTreatment },
  );
};

// § 92a is in scope since 0603 (policy 2026.3): a reverse-charge document needs exactly one commodity
// code (one KH row per code), and a code never sits on a line with another treatment.
const RC_TREATMENTS: ReadonlySet<string> = new Set([
  'rcv_domestic_reverse_charge',
  'iss_domestic_reverse_charge',
]);
const rcCommodity: SimpleCheckFn = (ctx) => {
  const docs = ctx.input.documents.filter((d) => {
    const rcLines = d.lines.filter(
      (l) => l.vatTreatment !== null && RC_TREATMENTS.has(l.vatTreatment),
    );
    const codes = new Set(d.lines.map((l) => l.rcCommodityCode).filter((c) => c !== null));
    const codeOnOtherLine = d.lines.some(
      (l) =>
        l.rcCommodityCode !== null &&
        !(l.vatTreatment !== null && RC_TREATMENTS.has(l.vatTreatment)),
    );
    if (!ctx.isPayer) return codes.size > 0;
    if (rcLines.length === 0) return codes.size > 0;
    return codes.size !== 1 || codeOnOtherLine;
  });
  return docs.length > 0 ? fail(docIds(docs)) : null;
};

const forbiddenClass: SimpleCheckFn = (ctx) => {
  const classes = ctx.policy.forbid_document_classes;
  const lineTypes = ctx.policy.forbid_line_types;
  const docs = ctx.input.documents.filter(
    (d) => classes.includes(d.class) || d.lines.some((l) => lineTypes.includes(l.lineType)),
  );
  return docs.length > 0 ? fail(docIds(docs)) : null;
};

const euGoodsMultiRate: SimpleCheckFn = (ctx) => {
  const ids: string[] = [];
  for (const [documentId, entries] of ctx.entriesByDocument) {
    if (!entries.some((e) => e.vatTreatment === 'rcv_eu_goods_acquisition')) continue;
    const rates = new Set(entries.map((e) => e.vatRateType));
    if (rates.size > ctx.policy.max_rates_per_eu_goods_document) ids.push(documentId);
  }
  return ids.length > 0 ? fail(ids) : null;
};

const priorPeriodCreditNote: SimpleCheckFn = (ctx) => {
  const { start } = ctx.input.period;
  const docs = ctx.input.documents.filter(
    (d) =>
      d.class.endsWith('_credit_note') &&
      ctx.entriesByDocument.has(d.documentId) &&
      d.correctsVatPointDate !== null &&
      compareLegalDates(d.correctsVatPointDate, start) < 0,
  );
  return docs.length > 0 ? fail(docIds(docs)) : null;
};

const partialShareDeduction: SimpleCheckFn = (ctx) => {
  // § 75 proportional deduction is computed by computeDphdp3/computeKh since 0602 (policy 2026.2).
  if (!ctx.isPayer || ctx.policy.allow_partial_business_share_on_deduction) return null;
  const docs = ctx.input.documents.filter((d) => d.lines.some(isPartialShare));
  return docs.length > 0 ? fail(docIds(docs)) : null;
};

const platformIncomePayer: SimpleCheckFn = (ctx) => {
  if (!ctx.isPayer) return null;
  const docs = ctx.input.documents.filter(
    (d) =>
      d.class === 'platform_statement' &&
      d.lines.some(
        (l) => l.categoryCode?.startsWith('income_') && l.linkedIssuedInvoiceId === null,
      ),
  );
  return docs.length > 0 ? fail(docIds(docs)) : null;
};

const ioOutputVat: SimpleCheckFn = (ctx) => {
  if (!ctx.isIo) return null;
  const docs = ctx.input.documents.filter((d) =>
    d.lines.some((l) => l.vatTreatment !== null && ISSUED_OUTPUT.has(l.vatTreatment)),
  );
  return docs.length > 0 ? fail(docIds(docs)) : null;
};

const maxDocs: SimpleCheckFn = (ctx) => {
  const count = ctx.entriesByDocument.size;
  return count > ctx.policy.max_docs ? fail([], { count, max: ctx.policy.max_docs }) : null;
};

// TODO(decision-TA-11): TA-11 default; a negative IO return sum goes to the accountant.
const ioNegativeTax: SimpleCheckFn = (ctx) => {
  if (!ctx.isIo) return null;
  const rowEntries = ctx.input.entries.filter((e) =>
    e.dphdp3Rows.some((row) => RETURN_ROWS_3_13.has(row)),
  );
  const sum = Money.sum(
    rowEntries.map((e) => e.vatCzk),
    CZK,
  );
  if (!sum.isNegative()) return null;
  return fail(
    rowEntries.map((e) => e.documentId),
    { sumVatCzk: sum.toFixed2() },
  );
};

export const ACCOUNTANT_CHECKS: ReadonlyArray<readonly [SimpleCheckCode, SimpleCheckFn]> = [
  ['S_PROFILE_UNSUPPORTED', profileUnsupported],
  ['S_PROFILE_CHANGED_IN_PERIOD', profileChangedInPeriod],
  ['S_ENTRY_BEFORE_STATUS', entryBeforeStatus],
  ['S_TREATMENT_NOT_ALLOWED', treatmentNotAllowed],
  ['S_RC_COMMODITY', rcCommodity],
  ['S_FORBIDDEN_CLASS', forbiddenClass],
  ['S_EU_GOODS_MULTI_RATE', euGoodsMultiRate],
  ['S_PRIOR_PERIOD_CREDIT_NOTE', priorPeriodCreditNote],
  ['S_PARTIAL_SHARE_DEDUCTION', partialShareDeduction],
  ['S_PLATFORM_INCOME_PAYER', platformIncomePayer],
  ['S_IO_OUTPUT_VAT', ioOutputVat],
  ['S_MAX_DOCS', maxDocs],
  ['S_IO_NEGATIVE_TAX', ioNegativeTax],
];
