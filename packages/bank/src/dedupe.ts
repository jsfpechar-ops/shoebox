import { createHash } from 'node:crypto';
import type { CanonicalTx } from './types';

/** The M07 §4.5 tuple of a transaction without seq: booked_on|amount|account|vs|ks|ss|message40. */
export function dedupeTuple(t: CanonicalTx): string {
  const folded = (t.message ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().slice(0, 40);
  const counterparty = `${t.counterparty.account ?? t.counterparty.iban ?? ''}/${t.counterparty.bankCode ?? ''}`;
  return [
    `${t.bookedOn}`,
    t.amount.toFixed2(),
    counterparty,
    t.vs ?? '',
    t.ks ?? '',
    t.ss ?? '',
    folded,
  ].join('|');
}

/** For each tx, how many earlier txs in the same file have the same tuple (0-based). */
export function dedupeSeqs(txs: readonly CanonicalTx[]): number[] {
  const seen = new Map<string, number>();
  return txs.map((t) => {
    const key = dedupeTuple(t);
    const seq = seen.get(key) ?? 0;
    seen.set(key, seq + 1);
    return seq;
  });
}

/** sha256 hex of `accountId|<tuple>|seq`. */
export function computeDedupeHash(accountId: string, t: CanonicalTx, seq: number): string {
  return createHash('sha256')
    .update(`${accountId}|${dedupeTuple(t)}|${seq}`)
    .digest('hex');
}
