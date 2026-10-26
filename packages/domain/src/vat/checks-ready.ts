// The not_ready checks of the simple-period classifier (M05 §4.3, brief 0332). Pure.
// Imports from classify-period are type-only to avoid a runtime cycle.
import { BOOKABLE_CLASSES } from '../ledgers/tax';
import type {
  LedgerIssueRef,
  SimpleCheck,
  SimpleCheckCode,
  SimpleCheckContext,
  SimpleCheckFn,
} from './classify-period-types';

type Outcome = Omit<SimpleCheck, 'code'>;

const DOCUMENTS_DONE: ReadonlySet<string> = new Set(['finalized', 'supporting', 'duplicate']);
const TAX_DOCUMENT_OK: ReadonlySet<string> = new Set([
  'full_tax_document',
  'simplified_tax_document',
]);
/** KH sections that need the supplier's document number (evidence). */
const KH_EVIDENCE_SECTIONS: ReadonlySet<string> = new Set(['A2', 'A4', 'B2']);
/** KH sections that the document-total limit routes to (A4/B2 candidates routed down). */
const KH_TOTAL_SECTIONS: ReadonlySet<string> = new Set(['A5', 'B3']);

function notReady(documentIds: string[]): Outcome | null {
  if (documentIds.length === 0) return null;
  return { outcome: 'not_ready', documentIds, params: {} };
}

/** S_PENDING_DOCUMENTS: a bookable document that is not finalized, supporting or duplicate. */
const pendingDocuments: SimpleCheckFn = (ctx) =>
  notReady(
    ctx.input.documents
      .filter((doc) => BOOKABLE_CLASSES.includes(doc.class) && !DOCUMENTS_DONE.has(doc.status))
      .map((doc) => doc.documentId),
  );

/** S_BLOCKING_VALIDATION */
const blockingValidation: SimpleCheckFn = (ctx) =>
  notReady(
    ctx.input.documents.filter((doc) => doc.hasBlockingValidation).map((doc) => doc.documentId),
  );

/** S_BUSINESS_FLAG_UNKNOWN: a document with at least one entry whose business flag is unknown. */
const businessFlagUnknown: SimpleCheckFn = (ctx) =>
  notReady(
    ctx.input.documents
      .filter(
        (doc) =>
          doc.businessFlag === 'unknown' &&
          (ctx.entriesByDocument.get(doc.documentId)?.length ?? 0) > 0,
      )
      .map((doc) => doc.documentId),
  );

/** Pass-through of input.ledgerIssues for one code. */
function ledgerIssue(code: LedgerIssueRef['code']): SimpleCheckFn {
  return (ctx) =>
    notReady(
      ctx.input.ledgerIssues
        .filter((issue) => issue.code === code)
        .map((issue) => issue.documentId),
    );
}

/** S_KH_DIC_MISSING (payer only): (a) domestic VAT received without a supplier DIČ; (b) A5/B3 over the limit with a DIČ printed but not captured. */
const khDicMissing: SimpleCheckFn = (ctx: SimpleCheckContext) => {
  if (!ctx.isPayer) return null;
  const ids: string[] = [];
  for (const [documentId, entries] of ctx.entriesByDocument) {
    const partner = ctx.docsById.get(documentId)?.partner;
    if (partner === undefined || partner.dic !== null) continue;
    const domesticWithoutDic = entries.some((e) => e.vatTreatment === 'rcv_domestic_vat');
    const overLimitWithDicPrinted =
      partner.documentShowsDic &&
      entries.some(
        (e) =>
          e.khSection !== null &&
          KH_TOTAL_SECTIONS.has(e.khSection) &&
          e.khDocumentTotalCzk?.toDecimal().abs().greaterThan(ctx.khDocumentLimitCzk),
      );
    if (domesticWithoutDic || overLimitWithDicPrinted) ids.push(documentId);
  }
  return notReady(ids);
};

/** S_KH_EVIDENCE_NUMBER_MISSING (payer only): A2/A4/B2 entry without a document number. */
const khEvidenceNumberMissing: SimpleCheckFn = (ctx) => {
  if (!ctx.isPayer) return null;
  return notReady(
    ctx.input.entries
      .filter(
        (e) =>
          e.khSection !== null &&
          KH_EVIDENCE_SECTIONS.has(e.khSection) &&
          (e.evidenceNumber ?? '').trim() === '',
      )
      .map((e) => e.documentId),
  );
};

/** S_DOMESTIC_NOT_TAX_DOC (payer only): domestic VAT line on a document that is not a tax document. */
const domesticNotTaxDoc: SimpleCheckFn = (ctx) => {
  if (!ctx.isPayer) return null;
  return notReady(
    ctx.input.documents
      .filter(
        (doc) =>
          !TAX_DOCUMENT_OK.has(doc.taxDocStatus) &&
          doc.lines.some((line) => line.vatTreatment === 'rcv_domestic_vat'),
      )
      .map((doc) => doc.documentId),
  );
};

/** S_SH_VAT_ID_INVALID: a summary-report (SH) entry needs a VIES-valid VAT ID on its partner. */
const shVatIdInvalid: SimpleCheckFn = (ctx) =>
  notReady(
    ctx.input.entries
      .filter((e) => {
        if (e.shvCode === null) return false;
        const partner = ctx.docsById.get(e.documentId)?.partner;
        return partner === undefined || partner.vatId === null || partner.vatIdValid !== true;
      })
      .map((e) => e.documentId),
  );

/** The not_ready half of the registry, in M05 §4.3 order. */
export const READY_CHECKS: ReadonlyArray<readonly [SimpleCheckCode, SimpleCheckFn]> = [
  ['S_PENDING_DOCUMENTS', pendingDocuments],
  ['S_BLOCKING_VALIDATION', blockingValidation],
  ['S_BUSINESS_FLAG_UNKNOWN', businessFlagUnknown],
  ['S_FX_MISSING', ledgerIssue('S_FX_MISSING')],
  ['S_DATE_MISSING', ledgerIssue('S_DATE_MISSING')],
  ['S_SELF_ASSESSED_RATE_UNKNOWN', ledgerIssue('S_SELF_ASSESSED_RATE_UNKNOWN')],
  ['S_MIXED_TREATMENT_SAME_RATE', ledgerIssue('S_MIXED_TREATMENT_SAME_RATE')],
  ['S_KH_DIC_MISSING', khDicMissing],
  ['S_KH_EVIDENCE_NUMBER_MISSING', khEvidenceNumberMissing],
  ['S_DOMESTIC_NOT_TAX_DOC', domesticNotTaxDoc],
  ['S_SH_VAT_ID_INVALID', shVatIdInvalid],
];
