import type { LegalDate } from '../dates/index';
import { CZK, Money, round2 } from '../money/index';

export interface PrivateUseInput {
  readonly personalDocuments: ReadonlyArray<{
    readonly documentId: string;
    readonly paidAt: LegalDate;
    readonly amountCzk: Money;
  }>;
  readonly partialShareLines: ReadonlyArray<{
    readonly documentId: string;
    readonly lineId: string;
    readonly description: string | null;
    readonly totalCzk: Money;
    readonly businessSharePct: string;
  }>;
  readonly carRegimeAnswers: ReadonlyArray<{
    readonly questionId: string;
    readonly answer: 'actual_costs' | 'flat_km' | null;
    readonly businessSharePct: string | null;
  }>;
}
export interface PartialShareRow {
  readonly documentId: string;
  readonly lineId: string;
  readonly description: string | null;
  readonly totalCzk: Money;
  readonly businessSharePct: string;
  readonly businessPart: Money;
  readonly privatePart: Money;
}
export interface PrivateUseSummary {
  readonly personalCount: number;
  readonly personalSum: Money;
  readonly partialShares: readonly PartialShareRow[];
  readonly carRegime: 'actual_costs' | 'flat_km' | 'unanswered';
  readonly carBusinessSharePct: string | null;
}

/** M06 §4.6: personal documents, partial business shares and the car regime answer. */
export function summarizePrivateUse(input: PrivateUseInput): PrivateUseSummary {
  const personalSum = Money.sum(
    input.personalDocuments.map((d) => d.amountCzk),
    CZK,
  );

  const partialShares: PartialShareRow[] = input.partialShareLines
    .filter((l) => {
      const pct = Number.parseFloat(l.businessSharePct);
      return pct > 0 && pct < 100;
    })
    .map((l) => {
      const businessPart = round2(l.totalCzk.multiply(l.businessSharePct).divide('100'));
      return {
        documentId: l.documentId,
        lineId: l.lineId,
        description: l.description,
        totalCzk: l.totalCzk,
        businessSharePct: l.businessSharePct,
        businessPart,
        privatePart: l.totalCzk.subtract(businessPart),
      };
    });

  const answered = input.carRegimeAnswers.filter((a) => a.answer !== null);
  const last = answered.length > 0 ? answered[answered.length - 1] : undefined;

  return {
    personalCount: input.personalDocuments.length,
    personalSum,
    partialShares,
    carRegime: last?.answer ?? 'unanswered',
    carBusinessSharePct: last?.businessSharePct ?? null,
  };
}
