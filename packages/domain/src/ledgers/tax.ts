import { Decimal } from 'decimal.js';
import type { LegalDate } from '../dates/index';
import type { DocumentClass, DocumentStatus, LineType, LinkType, TaxEffect } from '../enums/index';
import { convertToCzk, type FxRateRow, resolveFxRate } from '../fx';
import { type Currency, CZK, Money, round2 } from '../money/index';
import type { RULE_SCHEMAS } from '../rules/keys';
import type { RuleResolver } from '../rules/resolver';
import { type CategoryCode, getCategory } from '../taxonomy/categories';
import type { ProfileAt } from '../vat/point-date';
import { allocateProRata } from './allocate';

export type TaxLedgerBasis = 'payment' | 'document_evidence' | 'provisional';

export class LedgerInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerInputError';
  }
}

export interface TaxLedgerLine {
  readonly lineId: string;
  readonly position: number;
  readonly lineType: LineType;
  readonly net: Money | null;
  readonly vat: Money | null;
  readonly gross: Money | null;
  readonly categoryCode: CategoryCode | null;
  readonly businessSharePct: string;
  readonly coveredByDocumentId: string | null;
}

export interface TaxLedgerDocument {
  readonly documentId: string;
  readonly class: DocumentClass;
  readonly status: DocumentStatus;
  readonly deleted: boolean;
  readonly currency: Currency;
  readonly issueDate: LegalDate | null;
  readonly dueDate: LegalDate | null;
  readonly paidAt: LegalDate | null;
  readonly vatPointDate: LegalDate | null;
  readonly isPaidPerDocument: boolean | null;
  readonly paymentMethod: string | null;
  readonly deductionAllowed: boolean;
  readonly lines: readonly TaxLedgerLine[];
}

export interface TaxLedgerPayment {
  readonly paymentLinkId: string;
  readonly transactionId: string;
  readonly linkType: LinkType;
  readonly bookedOn: LegalDate;
  /** Document currency, as stored (positive). */
  readonly amountDoc: Money;
  /** Account currency, as stored (positive). */
  readonly amountAccount: Money;
}

export interface TaxLedgerInput {
  readonly doc: TaxLedgerDocument;
  readonly payments: readonly TaxLedgerPayment[];
  readonly profileAt: ProfileAt;
  readonly fxRates: readonly FxRateRow[];
  readonly rules: RuleResolver<typeof RULE_SCHEMAS>;
}

export interface TaxLedgerEntryDraft {
  readonly entryDate: LegalDate;
  readonly taxYear: number;
  readonly basis: TaxLedgerBasis;
  readonly documentId: string;
  readonly lineId: string;
  readonly paymentLinkId: string | null;
  readonly transactionId: string | null;
  readonly categoryCode: CategoryCode;
  readonly taxEffect: TaxEffect;
  readonly amountCzk: Money;
  readonly businessSharePct: string;
  readonly businessAmountCzk: Money;
}

export const BOOKABLE_CLASSES: readonly DocumentClass[] = [
  'received_invoice',
  'received_receipt',
  'received_credit_note',
  'received_advance_tax_doc',
  'issued_invoice',
  'issued_credit_note',
  'platform_statement',
];

export const LEDGER_ALGO_VERSION = 2;

// TODO(rules:validation.tol.sum): replace with the rule value once lane B seeds the key.
const REMAINDER_TOLERANCE = '0.01';

interface PaymentPlan {
  readonly date: LegalDate;
  readonly pDoc: Money;
  readonly pCzk: Money;
  readonly basis: TaxLedgerBasis;
  readonly paymentLinkId: string | null;
  readonly transactionId: string | null;
}

const SIGNED_EXPENSE_EFFECTS: readonly TaxEffect[] = [
  'deductible_expense',
  'non_deductible_expense',
];
const CARD_OR_CASH: readonly string[] = ['card', 'cash'];

export function buildTaxLedgerEntries(input: TaxLedgerInput): TaxLedgerEntryDraft[] {
  const { doc, rules, profileAt, fxRates } = input;

  // M04 §4.11: qualification.
  if (!BOOKABLE_CLASSES.includes(doc.class)) return [];
  if (doc.status !== 'ready' && doc.status !== 'finalized') return [];
  if (doc.deleted) return [];

  const active = doc.lines
    .filter((l) => l.lineType !== 'text' && l.coveredByDocumentId === null)
    .slice()
    .sort((a, b) => a.position - b.position);
  for (const l of active) {
    if (l.categoryCode === null) {
      throw new LedgerInputError(`Line ${l.lineId} of ${doc.documentId} has no category`);
    }
  }

  const zero = Money.zero(doc.currency);
  const hundred = new Decimal(100);

  // §4.11.1: cost basis per line in document currency.
  const vatDate = doc.vatPointDate ?? doc.issueDate;
  if (vatDate === null) throw new LedgerInputError(`Document ${doc.documentId} has no date`);
  const profile = profileAt(vatDate);
  const vatIsCost = !(profile.vatStatus === 'platce' && doc.deductionAllowed);

  // K-C01: for a deducting payer the non-deductible VAT of the private share is private, never a
  // business cost (M04 §4.11.2, deduction_pct = share), so the basis is the net alone.
  const basisOf = (l: TaxLedgerLine): Money => {
    if (l.lineType === 'rounding') return l.gross ?? zero;
    const base = l.net ?? l.gross ?? zero;
    const vat = l.vat ?? zero;
    return vatIsCost ? base.add(vat) : base;
  };

  const basis = new Map<string, Money>();
  const weight = new Map<string, Money>();
  for (const l of active) {
    basis.set(l.lineId, basisOf(l));
    weight.set(l.lineId, l.gross ?? zero);
  }
  const weights = active.map((l) => weight.get(l.lineId) ?? zero);
  const W = Money.sum(weights, doc.currency);
  if (W.isZero()) return [];
  const sumBasis = Money.sum(
    active.map((l) => basis.get(l.lineId) ?? zero),
    doc.currency,
  );

  // Converts an amount to CZK at the ČNB rate of `date`; null when no rate is in the look-back window.
  const toCzk = (amount: Money, date: LegalDate): Money | null => {
    if (amount.currency === CZK) return amount;
    const at = rules.at(date);
    const fx = resolveFxRate(
      amount.currency,
      date,
      fxRates,
      at.get('vat.cnb_rate_rule'),
      at.get('fx.max_lookback_days'),
    );
    return fx ? round2(convertToCzk(amount, fx)) : null;
  };

  // §4.11.2: payment evidence, by precedence.
  const plans: PaymentPlan[] = [];
  const linked = input.payments.filter((p) => p.linkType !== 'fx_difference');
  const dueOrIssue = doc.dueDate ?? doc.issueDate;
  const paidOrIssue = doc.paidAt ?? doc.issueDate;
  if (linked.length > 0) {
    let sumPDoc = Money.zero(doc.currency);
    for (const p of linked) {
      const sign = p.linkType === 'refund' ? -1 : 1;
      const pDoc = sign < 0 ? p.amountDoc.abs().negate() : p.amountDoc.abs();
      const accountAmount = sign < 0 ? p.amountAccount.abs().negate() : p.amountAccount.abs();
      const pCzk = toCzk(accountAmount, p.bookedOn);
      if (pCzk === null) return [];
      plans.push({
        date: p.bookedOn,
        pDoc,
        pCzk,
        basis: 'payment',
        paymentLinkId: p.paymentLinkId,
        transactionId: p.transactionId,
      });
      sumPDoc = sumPDoc.add(pDoc);
    }
    // Partial payments: remainder is provisional.
    const remainder = W.subtract(sumPDoc);
    if (remainder.abs().compare(Money.parse(REMAINDER_TOLERANCE, doc.currency)) > 0) {
      if (dueOrIssue === null) throw new LedgerInputError(`Document ${doc.documentId} has no date`);
      const rCzk = toCzk(remainder, dueOrIssue);
      if (rCzk === null) return [];
      plans.push({
        date: dueOrIssue,
        pDoc: remainder,
        pCzk: rCzk,
        basis: 'provisional',
        paymentLinkId: null,
        transactionId: null,
      });
    }
  } else if (
    doc.isPaidPerDocument === true ||
    (doc.class === 'received_receipt' &&
      doc.paymentMethod !== null &&
      CARD_OR_CASH.includes(doc.paymentMethod))
  ) {
    // Rule 2: paid per document (synthetic payment of the full document).
    if (paidOrIssue === null) throw new LedgerInputError(`Document ${doc.documentId} has no date`);
    const pCzk = toCzk(W, paidOrIssue);
    if (pCzk === null) return [];
    plans.push({
      date: paidOrIssue,
      pDoc: W,
      pCzk,
      basis: 'document_evidence',
      paymentLinkId: null,
      transactionId: null,
    });
  } else if (doc.class === 'platform_statement') {
    // Rule 3: platform payout without links.
    if (paidOrIssue === null) throw new LedgerInputError(`Document ${doc.documentId} has no date`);
    const pCzk = toCzk(W, paidOrIssue);
    if (pCzk === null) return [];
    plans.push({
      date: paidOrIssue,
      pDoc: W,
      pCzk,
      basis: 'document_evidence',
      paymentLinkId: null,
      transactionId: null,
    });
  } else {
    // Rule 4: provisional.
    if (dueOrIssue === null) throw new LedgerInputError(`Document ${doc.documentId} has no date`);
    const pCzk = toCzk(W, dueOrIssue);
    if (pCzk === null) return [];
    plans.push({
      date: dueOrIssue,
      pDoc: W,
      pCzk,
      basis: 'provisional',
      paymentLinkId: null,
      transactionId: null,
    });
  }

  // §4.11.3: allocation over lines, then the sign mapping and the entries.
  const entries: TaxLedgerEntryDraft[] = [];
  for (const plan of plans) {
    const alloc = allocateProRata(plan.pCzk, weights);
    const amounts = active.map((l, i) => {
      const a = alloc[i] ?? zero;
      const g = l.gross ?? zero;
      const b = basis.get(l.lineId) ?? zero;
      if (g.isZero()) return a;
      return round2(
        Money.fromDecimal(
          a.toDecimal().times(b.toDecimal()).div(g.toDecimal()),
          plan.pCzk.currency,
        ),
      );
    });

    // Target: round2(p_czk × Σbasis / W); the residual goes to the largest |weight| (tie: lowest position).
    const target = round2(
      Money.fromDecimal(
        plan.pCzk.toDecimal().times(sumBasis.toDecimal()).div(W.toDecimal()),
        plan.pCzk.currency,
      ),
    );
    const residual = target.subtract(Money.sum(amounts, plan.pCzk.currency));
    if (!residual.isZero()) {
      let best = 0;
      for (let i = 1; i < active.length; i += 1) {
        const cur = (weights[i] ?? zero).abs();
        const top = (weights[best] ?? zero).abs();
        if (cur.compare(top) > 0) best = i;
      }
      amounts[best] = (amounts[best] ?? zero).add(residual);
    }

    active.forEach((l, i) => {
      const category = getCategory(l.categoryCode as string);
      const amount = amounts[i] ?? zero;
      const signed =
        doc.class === 'platform_statement' && SIGNED_EXPENSE_EFFECTS.includes(category.taxEffect)
          ? amount.negate()
          : amount;
      const share = l.businessSharePct;
      entries.push({
        entryDate: plan.date,
        taxYear: Number.parseInt(plan.date.split('-')[0] ?? '', 10),
        basis: plan.basis,
        documentId: doc.documentId,
        lineId: l.lineId,
        paymentLinkId: plan.paymentLinkId,
        transactionId: plan.transactionId,
        categoryCode: l.categoryCode as CategoryCode,
        taxEffect: category.taxEffect,
        amountCzk: signed,
        businessSharePct: share,
        businessAmountCzk: round2(
          Money.fromDecimal(signed.toDecimal().times(share).div(hundred), CZK),
        ),
      });
    });
  }
  return entries;
}
