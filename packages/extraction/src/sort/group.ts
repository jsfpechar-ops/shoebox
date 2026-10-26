import type { PageItem } from './page-map';

export interface SortPage {
  readonly fileIndex: number; // 0-based, upload order
  readonly filePage: number; // 1-based
  readonly blank: boolean;
  readonly items: readonly PageItem[];
}

export interface SortPiece {
  readonly fileIndex: number;
  readonly filePage: number;
  readonly region: string;
  readonly item: PageItem;
}

export interface SortResult {
  /** One entry per document, pieces in reading order; groups ordered by first upload index. */
  readonly groups: readonly (readonly SortPiece[])[];
  readonly skipped: readonly { readonly fileIndex: number; readonly filePage: number }[];
  /** Pairs of group indexes [low, high] that may be one document: ask the user. */
  readonly questions: readonly (readonly [number, number])[];
}

function nameKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function numberKey(n: string): string {
  return n.toUpperCase().replace(/\s+/g, '');
}

export function supplierKeyOf(item: PageItem): string {
  return item.supplierIco !== '' ? item.supplierIco : nameKey(item.supplierName);
}

export function sameSupplier(a: PageItem, b: PageItem): 'yes' | 'no' | 'unknown' {
  if (a.supplierIco !== '' && b.supplierIco !== '') {
    return a.supplierIco === b.supplierIco ? 'yes' : 'no';
  }
  const ka = nameKey(a.supplierName);
  const kb = nameKey(b.supplierName);
  if (ka !== '' && kb !== '') {
    return ka === kb || ka.includes(kb) || kb.includes(ka) ? 'yes' : 'no';
  }
  return 'unknown';
}

function compatible(a: PageItem, b: PageItem): boolean {
  if (a.kind === 'not_document' || b.kind === 'not_document') return false;
  if (sameSupplier(a, b) === 'no') return false;
  const na = numberKey(a.docNumber);
  const nb = numberKey(b.docNumber);
  return na === nb || na === '' || nb === '';
}

export function groupPages(pages: readonly SortPage[]): SortResult {
  const pieces: SortPiece[] = [];
  const skipped: { fileIndex: number; filePage: number }[] = [];
  for (const page of pages) {
    if (page.blank || page.items.length === 0) {
      skipped.push({ fileIndex: page.fileIndex, filePage: page.filePage });
      continue;
    }
    for (const item of page.items) {
      pieces.push({ fileIndex: page.fileIndex, filePage: page.filePage, region: item.where, item });
    }
  }

  const n = pieces.length;
  const itemAt = (i: number): PageItem => (pieces[i] as SortPiece).item;
  const parent: number[] = pieces.map((_, i) => i);
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r] as number;
    return r;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  const membersOf = (r: number): number[] => {
    const out: number[] = [];
    for (let j = 0; j < n; j++) if (find(j) === r) out.push(j);
    return out;
  };
  const canMergeGroups = (ra: number, rb: number): boolean => {
    const ma = membersOf(ra);
    const mb = membersOf(rb);
    return ma.every((i) => mb.every((j) => compatible(itemAt(i), itemAt(j))));
  };

  // Rule A: same number.
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = itemAt(i);
      const b = itemAt(j);
      const ka = numberKey(a.docNumber);
      const kb = numberKey(b.docNumber);
      if (ka === '' || kb === '' || ka !== kb) continue;
      if (sameSupplier(a, b) === 'no') continue;
      if (find(i) === find(j)) continue;
      if (canMergeGroups(find(i), find(j))) union(i, j);
    }
  }

  // Rule B: page labels.
  const held = new Set<number>();
  const questionPairs: [number, number][] = [];
  for (let p = 0; p < n; p++) {
    const ip = itemAt(p);
    const labelN = ip.labelN;
    const labelOf = ip.labelOf;
    if (labelN === null || labelOf === null || labelN <= 1) continue;
    const gp = find(p);
    const groupHas = (r: number, wanted: number): boolean =>
      membersOf(r).some((j) => itemAt(j).labelOf === labelOf && itemAt(j).labelN === wanted);
    if (groupHas(gp, labelN - 1)) continue;

    const candidateRoots = new Set<number>();
    const candidatePieces: number[] = [];
    for (let q = 0; q < n; q++) {
      const iq = itemAt(q);
      if (iq.labelOf !== labelOf || iq.labelN !== labelN - 1) continue;
      const gq = find(q);
      if (gq === gp) continue;
      if (groupHas(gq, labelN)) continue;
      if (!canMergeGroups(gq, gp)) continue;
      candidateRoots.add(gq);
      candidatePieces.push(q);
    }

    if (candidateRoots.size === 1) {
      union(p, candidatePieces[0] as number);
    } else if (candidateRoots.size >= 2) {
      held.add(p);
      const below = candidatePieces.filter((q) => q < p);
      const nearest = below.length > 0 ? Math.max(...below) : (candidatePieces[0] as number);
      questionPairs.push([p, nearest]);
    }
  }

  // Rule C: continuation pages.
  for (let k = 1; k < n; k++) {
    if (held.has(k)) continue;
    const ik = itemAt(k);
    if (membersOf(find(k)).length !== 1) continue;
    if (ik.startsDocument && ik.kind !== 'attachment') continue;
    if (canMergeGroups(find(k - 1), find(k))) union(k - 1, k);
  }

  // Rule D: missing totals.
  for (let k = 1; k < n; k++) {
    if (held.has(k)) continue;
    const ik = itemAt(k);
    if (!ik.hasTotals || membersOf(find(k)).length !== 1) continue;
    const gPrev = find(k - 1);
    if (membersOf(gPrev).some((j) => itemAt(j).hasTotals)) continue;
    if (sameSupplier(itemAt(k - 1), ik) !== 'yes') continue;
    if (canMergeGroups(gPrev, find(k))) union(k - 1, k);
  }

  // Rule E: unsure, ask.
  for (let k = 1; k < n; k++) {
    if (held.has(k)) continue;
    const gPrev = find(k - 1);
    const gk = find(k);
    if (gPrev === gk) continue;
    if (sameSupplier(itemAt(k - 1), itemAt(k)) !== 'yes') continue;
    if (membersOf(gPrev).some((j) => itemAt(j).hasTotals)) continue;
    if (!canMergeGroups(gPrev, gk)) continue;
    questionPairs.push([k - 1, k]);
  }

  // Output: groups by lowest upload index, pieces in reading order when labelled.
  const roots: number[] = [];
  const rootOrder = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!rootOrder.has(r)) {
      rootOrder.set(r, roots.length);
      roots.push(r);
    }
  }
  const groups: SortPiece[][] = roots.map((r) => {
    const idx = membersOf(r);
    const first = itemAt(idx[0] as number);
    const allLabelled = idx.every((i) => {
      const it = itemAt(i);
      return it.labelN !== null && it.labelOf !== null && it.labelOf === first.labelOf;
    });
    const ordered = allLabelled
      ? [...idx].sort((a, b) => (itemAt(a).labelN ?? 0) - (itemAt(b).labelN ?? 0) || a - b)
      : idx;
    return ordered.map((i) => pieces[i] as SortPiece);
  });

  const groupOf = (i: number): number => rootOrder.get(find(i)) as number;
  const seen = new Set<string>();
  const questions: [number, number][] = [];
  for (const [a, b] of questionPairs) {
    const ga = groupOf(a);
    const gb = groupOf(b);
    if (ga === gb) continue;
    const pair: [number, number] = ga < gb ? [ga, gb] : [gb, ga];
    const key = `${pair[0]}:${pair[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    questions.push(pair);
  }

  return { groups, skipped, questions };
}
