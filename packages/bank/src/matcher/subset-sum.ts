import { type LegalDate, type Money, round2 } from '@shoebox/domain';
import { MATCHER_CONFIG, type MatcherConfig } from './config';
import { sigmoid } from './score';

const NO_DUE = '9999-12-31';
const CAP_UNIQUE = 0.89;
const CAP_AMBIGUOUS = 0.75;

/** Haléře (1/100 CZK) from the exact decimal of round2(m). Never via Number. */
export function toHalere(m: Money): bigint {
  return BigInt(round2(m).toFixed2().replace('.', ''));
}

/** All subsets of size 1..maxSize whose sum is within tolerance; size first, then lexicographic by input index. */
export function findSubsetSum(
  targetHalere: bigint,
  items: readonly { id: string; halere: bigint }[],
  tolHalere: bigint,
  maxSize: number,
): string[][] {
  const out: string[][] = [];
  const top = Math.min(maxSize, items.length);
  for (let size = 1; size <= top; size++) {
    const walk = (start: number, chosen: string[], sum: bigint): void => {
      if (chosen.length === size) {
        const diff = sum - targetHalere;
        if ((diff < 0n ? -diff : diff) <= tolHalere) out.push([...chosen]);
        return;
      }
      for (let i = start; i < items.length; i++) {
        const item = items[i];
        if (item === undefined) continue;
        chosen.push(item.id);
        walk(i + 1, chosen, sum + item.halere);
        chosen.pop();
      }
    };
    walk(0, [], 0n);
  }
  return out;
}

function latestDue(
  ids: readonly string[],
  dueById: Readonly<Record<string, LegalDate | undefined>>,
): string {
  let max = '';
  for (const id of ids) {
    const d: string = dueById[id] ?? NO_DUE;
    if (d > max) max = d;
  }
  return max;
}

/** One subset → unique. Several → the one with the oldest maximum due date (first on ties). */
export function chooseSubset(
  subsets: readonly (readonly string[])[],
  dueById: Readonly<Record<string, LegalDate | undefined>>,
): { ids: string[]; unique: boolean } | null {
  const first = subsets[0];
  if (first === undefined) return null;
  if (subsets.length === 1) return { ids: [...first], unique: true };
  let best = first;
  let bestDue = latestDue(first, dueById);
  for (const s of subsets.slice(1)) {
    const d = latestDue(s, dueById);
    if (d < bestDue) {
      best = s;
      bestDue = d;
    }
  }
  return { ids: [...best], unique: false };
}

/** M07 §4.7.2 multi-document score: capped unless the message names every document. */
export function multiDocumentScore(
  f: {
    account: boolean;
    alias: boolean;
    nameSim: number;
    meanDateFactor: number;
    unique: boolean;
    messageHasAll: boolean;
  },
  cfg: MatcherConfig = MATCHER_CONFIG,
): number {
  const w = cfg.weights;
  const logit =
    w.bias +
    w.amountExact +
    (f.account ? w.accountMatch : 0) +
    (f.alias ? w.alias : 0) +
    w.nameMax * Math.max(0, (f.nameSim - 0.5) / 0.5) +
    w.dateMax * f.meanDateFactor +
    (f.messageHasAll ? w.msgDocNumber : 0);
  const score = Math.round(sigmoid(logit) * 1000) / 1000;
  if (f.messageHasAll) return score;
  return Math.min(score, f.unique ? CAP_UNIQUE : CAP_AMBIGUOUS);
}
