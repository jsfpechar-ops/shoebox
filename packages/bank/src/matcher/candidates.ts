import { compareAmount } from './amount';
import { MATCHER_CONFIG, type MatcherConfig } from './config';
import { dateFactor, windowKindOf } from './dates';
import { docKeys, messageHasDocKey, normMerchant, normName, tokenSetRatio } from './text';
import type { Candidate, DocView, MatchContext, RetrievalKey, TxView } from './types';

const OPEN_STATUSES = new Set<string>(['ready', 'finalized', 'needs_review']);
const INCOMING_CLASSES = new Set<string>([
  'received_invoice',
  'received_receipt',
  'received_advance_tax_doc',
  'received_proforma',
]);
const POSITIVE_CLASSES = new Set<string>([
  'issued_invoice',
  'platform_statement',
  'settlement_statement',
  'received_credit_note',
]);

/** M07 §4.6.1: which documents a transaction may be matched with, by sign and class. */
export function isEligible(t: Pick<TxView, 'amount'>, d: DocView): boolean {
  if (!OPEN_STATUSES.has(d.status)) return false;
  if (!d.openAmount.isPositive()) return false;
  if (t.amount.isZero()) return false;
  if (t.amount.isPositive()) return POSITIVE_CLASSES.has(d.cls);
  if (d.direction === 'in' && INCOMING_CLASSES.has(d.cls)) return true;
  if (d.cls === 'issued_credit_note') return true;
  return d.cls === 'government_filing' && d.amountDue.isPositive();
}

/** M07 §4.6.2: retrieve candidate documents for one transaction (at most 50). */
export function generateCandidates(
  t: TxView,
  docs: readonly DocView[],
  ctx: MatchContext,
  cfg: MatcherConfig = MATCHER_CONFIG,
): Candidate[] {
  const txAccount =
    t.counterpartyAccount && t.counterpartyBankCode
      ? `${t.counterpartyAccount}/${t.counterpartyBankCode}`
      : undefined;
  const txIban = t.counterpartyIban?.toUpperCase();
  const txKeys = [txAccount, txIban].filter((v): v is string => v !== undefined);
  const src = normMerchant(t.cardMerchant ?? t.counterpartyName ?? '');
  const out: Candidate[] = [];
  for (const d of docs) {
    if (!isEligible(t, d)) continue;
    const via: RetrievalKey[] = [];
    if (t.vs !== undefined && docKeys(d).includes(t.vs)) via.push('vs');
    if (messageHasDocKey(t.message, d)) via.push('message');
    if (
      compareAmount(t, d, ctx, false, cfg) !== null &&
      !dateFactor(windowKindOf(t, d), t.bookedOn, d, cfg).outside
    ) {
      via.push('amount');
    }
    const accountHit = txKeys.some(
      (v) =>
        d.partnerAccounts.includes(v) ||
        (d.partnerId !== undefined &&
          (ctx.knownAccounts.some((k) => k.value === v && k.partnerId === d.partnerId) ||
            ctx.aliases.some(
              (a) => a.kind === 'account' && a.value === v && a.partnerId === d.partnerId,
            ))),
    );
    if (accountHit) via.push('account');
    const nameHit =
      src !== '' &&
      ((d.partnerName !== undefined && tokenSetRatio(src, normName(d.partnerName)) >= 0.5) ||
        (d.partnerId !== undefined &&
          ctx.aliases.some(
            (a) =>
              (a.kind === 'merchant' || a.kind === 'name') &&
              a.partnerId === d.partnerId &&
              tokenSetRatio(src, a.value) >= 0.5,
          )));
    if (nameHit) via.push('name');
    if (via.length > 0) out.push({ t, d, via });
  }
  return out.sort((a, b) => b.via.length - a.via.length).slice(0, 50);
}
