import type { MatchMethod, Money } from '@shoebox/domain';
import { MATCHER_CONFIG, type MatcherConfig } from './config';
import type { CandidateScore, Feature } from './types';

export interface LinkDraft {
  readonly transactionId: string;
  readonly documentId: string;
  readonly linkType: 'payment';
  readonly amountDoc: Money;
  readonly amountAccount: Money;
  readonly matchMethod: MatchMethod;
  readonly confidence: number;
  readonly features: readonly Feature[];
}

export interface SuggestionDraft {
  readonly transactionId: string;
  readonly kind: 'document';
  readonly documentId: string;
  readonly documentIds: readonly string[];
  readonly amounts: readonly Money[];
  readonly score: number;
  readonly features: readonly Feature[];
}

const MAX_SUGGESTIONS_PER_TX = 3;

const cmp = <T extends string | number>(x: T, y: T): number => (x < y ? -1 : x > y ? 1 : 0);
const minMoney = (a: Money, b: Money): Money => (a.compare(b) <= 0 ? a : b);

/** M07 §4.6.4 step 3 order; pure, stable. */
export function orderScores(scores: readonly CandidateScore[]): CandidateScore[] {
  return [...scores].sort(
    (a, b) =>
      cmp(b.score, a.score) ||
      cmp(a.anchorDistanceDays, b.anchorDistanceDays) ||
      cmp(a.dueDate ?? '￿', b.dueDate ?? '￿') ||
      cmp(a.docCreatedAt, b.docCreatedAt) ||
      cmp(a.documentId, b.documentId) ||
      cmp(a.transactionId, b.transactionId),
  );
}

export function assign(
  scores: readonly CandidateScore[],
  cfg: MatcherConfig = MATCHER_CONFIG,
  rejected: ReadonlySet<string> = new Set(),
): { links: LinkDraft[]; suggestions: SuggestionDraft[] } {
  const kept = orderScores(
    scores.filter(
      (s) => s.score >= cfg.suggestThreshold && !rejected.has(`${s.transactionId}:${s.documentId}`),
    ),
  );

  // Margin rule: a side is eligible when it has one kept pair or best − second ≥ minMargin.
  const marginEligible = (key: (s: CandidateScore) => string): Set<string> => {
    const groups = new Map<string, number[]>();
    for (const s of kept) {
      const k = key(s);
      const g = groups.get(k) ?? [];
      g.push(s.score);
      groups.set(k, g);
    }
    const ok = new Set<string>();
    for (const [k, g] of groups) {
      const sorted = [...g].sort((x, y) => y - x);
      if (sorted.length === 1 || (sorted[0] ?? 0) - (sorted[1] ?? 0) >= cfg.minMargin) ok.add(k);
    }
    return ok;
  };
  const txOk = marginEligible((s) => s.transactionId);
  const docOk = marginEligible((s) => s.documentId);

  // Capacities come from the first kept pair of each transaction / document.
  const txRemaining = new Map<string, Money>();
  const docOpen = new Map<string, Money>();
  for (const s of kept) {
    if (!txRemaining.has(s.transactionId)) txRemaining.set(s.transactionId, s.txRemaining);
    if (!docOpen.has(s.documentId)) docOpen.set(s.documentId, s.docOpen);
  }

  const links: LinkDraft[] = [];
  const suggestions: SuggestionDraft[] = [];
  const suggestedFor = new Map<string, number>();

  for (const s of kept) {
    const tr = txRemaining.get(s.transactionId);
    const dOpen = docOpen.get(s.documentId);
    if (!tr || !dOpen || !tr.isPositive() || !dOpen.isPositive()) continue;

    if (s.score >= cfg.autoThreshold && txOk.has(s.transactionId) && docOk.has(s.documentId)) {
      const amountAccount = minMoney(tr, s.amount.amountAccount);
      let amountDoc = minMoney(dOpen, s.amount.amountDoc);
      if (amountDoc.currency === amountAccount.currency)
        amountDoc = minMoney(amountDoc, amountAccount);
      links.push({
        transactionId: s.transactionId,
        documentId: s.documentId,
        linkType: 'payment',
        amountDoc,
        amountAccount,
        matchMethod: s.method,
        confidence: s.score,
        features: s.features,
      });
      txRemaining.set(s.transactionId, tr.subtract(amountAccount));
      docOpen.set(s.documentId, dOpen.subtract(amountDoc));
    } else {
      const n = suggestedFor.get(s.transactionId) ?? 0;
      if (n >= MAX_SUGGESTIONS_PER_TX) continue;
      suggestedFor.set(s.transactionId, n + 1);
      suggestions.push({
        transactionId: s.transactionId,
        kind: 'document',
        documentId: s.documentId,
        documentIds: [s.documentId],
        amounts: [s.amount.amountDoc],
        score: s.score,
        features: s.features,
      });
    }
  }
  return { links, suggestions };
}
