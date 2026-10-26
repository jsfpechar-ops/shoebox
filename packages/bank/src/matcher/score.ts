import type { MatchMethod } from '@shoebox/domain';
import { compareAmount } from './amount';
import { MATCHER_CONFIG, type MatcherConfig } from './config';
import { dateFactor, windowKindOf } from './dates';
import { docKeys, messageHasDocKey, normMerchant, normName, tokenSetRatio } from './text';
import type {
  Candidate,
  CandidateScore,
  DocView,
  Feature,
  FeatureCode,
  MatchContext,
  TxView,
} from './types';

/** Logistic function. */
export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

const NEEDS_REVIEW_CAP = 0.89;

function scoreOf(logit: number, capped: boolean): number {
  const s = Math.round(sigmoid(logit) * 1000) / 1000;
  return capped ? Math.min(s, NEEDS_REVIEW_CAP) : s;
}

function txAccountOf(t: TxView): string | undefined {
  return t.counterpartyAccount && t.counterpartyBankCode
    ? `${t.counterpartyAccount}/${t.counterpartyBankCode}`
    : undefined;
}

function srcOf(t: TxView): string {
  return normMerchant(t.cardMerchant ?? t.counterpartyName ?? '');
}

function nameSimilarity(src: string, d: DocView, ctx: MatchContext): number {
  if (src === '') return 0;
  let best = 0;
  if (d.partnerName !== undefined)
    best = Math.max(best, tokenSetRatio(src, normName(d.partnerName)));
  if (d.partnerId !== undefined) {
    for (const a of ctx.aliases) {
      if ((a.kind === 'merchant' || a.kind === 'name') && a.partnerId === d.partnerId) {
        best = Math.max(best, tokenSetRatio(src, a.value));
      }
    }
  }
  return best;
}

/** M07 §4.6.3: score one candidate pair. Returns null when the pair is dropped. */
export function scoreCandidate(
  c: Candidate,
  ctx: MatchContext,
  cfg: MatcherConfig = MATCHER_CONFIG,
): CandidateScore | null {
  const { t, d } = c;
  const w = cfg.weights;
  const vsExact = t.vs !== undefined && docKeys(d).includes(t.vs);
  const amount = compareAmount(t, d, ctx, vsExact, cfg);
  if (amount === null) return null;
  const kind = windowKindOf(t, d);
  const date = dateFactor(kind, t.bookedOn, d, cfg);
  if (date.outside && !vsExact) return null;

  const features: Feature[] = [];
  const push = (code: FeatureCode, contribution: number): void => {
    if (contribution !== 0) features.push({ code, contribution });
  };

  switch (amount.kind) {
    case 'exact':
      push('amount_exact', w.amountExact);
      break;
    case 'rounding':
      push('amount_rounding', w.amountRounding);
      break;
    case 'fx':
      push('amount_fx', w.amountFxMax * amount.ratio);
      break;
    default:
      push('amount_partial', w.amountPartial);
  }

  if (vsExact) {
    push('vs_exact', w.vsExact);
  } else if (
    t.vs !== undefined &&
    d.variableSymbol !== undefined &&
    d.partnerId !== undefined &&
    ctx.partnersWithVsHistory.has(d.partnerId)
  ) {
    push('vs_conflict', w.vsConflict);
  }

  if (!vsExact && messageHasDocKey(t.message, d)) push('msg_doc_number', w.msgDocNumber);

  const txKeys = [txAccountOf(t), t.counterpartyIban?.toUpperCase()].filter(
    (v): v is string => v !== undefined,
  );
  const accountMatch = txKeys.some(
    (v) =>
      d.partnerAccounts.includes(v) ||
      (d.partnerId !== undefined &&
        (ctx.knownAccounts.some((k) => k.value === v && k.partnerId === d.partnerId) ||
          ctx.aliases.some(
            (a) => a.kind === 'account' && a.value === v && a.partnerId === d.partnerId,
          ))),
  );
  if (accountMatch) {
    push('account_match', w.accountMatch);
  } else if (
    txKeys.some(
      (v) =>
        ctx.knownAccounts.some((k) => k.value === v && k.partnerId !== d.partnerId) ||
        ctx.aliases.some(
          (a) => a.kind === 'account' && a.value === v && a.partnerId !== d.partnerId,
        ),
    )
  ) {
    push('account_other_partner', w.accountOtherPartner);
  }

  const src = srcOf(t);
  const nameSim = nameSimilarity(src, d, ctx);
  push('name', w.nameMax * Math.max(0, (nameSim - 0.5) / 0.5));

  if (date.outside) push('date_outside', w.dateOutside);
  else push('date', w.dateMax * date.f);

  const aliasHit =
    d.partnerId !== undefined &&
    ctx.aliases.some(
      (a) =>
        a.partnerId === d.partnerId &&
        a.confirmations >= 2 &&
        ((a.kind === 'account' && txKeys.includes(a.value)) ||
          ((a.kind === 'merchant' || a.kind === 'name') && src !== '' && a.value === src)),
    );
  if (aliasHit) push('alias', w.alias);

  const logit = w.bias + features.reduce((sum, f) => sum + f.contribution, 0);
  const capped = d.status === 'needs_review';

  let method: MatchMethod;
  if (vsExact && (amount.kind === 'exact' || amount.kind === 'rounding')) method = 'vs_amount';
  else if (vsExact) method = 'vs_only';
  else if (features.some((f) => f.code === 'name') && t.cardMerchant !== undefined)
    method = 'card_merchant_fuzzy';
  else if (kind === 'payout') method = 'platform_statement';
  else method = 'amount_date_counterparty';

  return {
    transactionId: t.id,
    documentId: d.id,
    score: scoreOf(logit, capped),
    logit,
    features,
    method,
    amount,
    txRemaining: t.remaining ?? t.amount.abs(),
    docOpen: d.openAmount,
    anchorDistanceDays: date.anchorDistanceDays,
    ...(d.dueDate !== undefined ? { dueDate: d.dueDate } : {}),
    docCreatedAt: d.createdAt,
    capped,
  };
}

/** Scores all candidates; a pair that is the only one for its transaction and document gets `unique`. */
export function scoreBatch(
  cands: readonly Candidate[],
  ctx: MatchContext,
  cfg: MatcherConfig = MATCHER_CONFIG,
): CandidateScore[] {
  const scored: CandidateScore[] = [];
  for (const c of cands) {
    const s = scoreCandidate(c, ctx, cfg);
    if (s !== null) scored.push(s);
  }
  const pairsPerTx = new Map<string, number>();
  const txsPerDoc = new Map<string, Set<string>>();
  for (const s of scored) {
    pairsPerTx.set(s.transactionId, (pairsPerTx.get(s.transactionId) ?? 0) + 1);
    const txs = txsPerDoc.get(s.documentId) ?? new Set<string>();
    txs.add(s.transactionId);
    txsPerDoc.set(s.documentId, txs);
  }
  return scored.map((s) => {
    const unique = pairsPerTx.get(s.transactionId) === 1 && txsPerDoc.get(s.documentId)?.size === 1;
    if (!unique) return s;
    const logit = s.logit + cfg.weights.unique;
    const features: Feature[] = [
      ...s.features,
      { code: 'unique', contribution: cfg.weights.unique },
    ];
    return { ...s, features, logit, score: scoreOf(logit, s.capped) };
  });
}
