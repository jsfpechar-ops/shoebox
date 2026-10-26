import type { LegalDate } from '../dates/index';
import { CZK, ceil0, floor0, Money, round0 } from '../money/index';
import type { createCzRules } from '../rules/index';
import { vatIdParts } from './kh';
import type { VatLedgerEntryDraft } from './ledger';

export interface ShvRow {
  readonly cRad: number;
  readonly kStat: string;
  readonly cVat: string;
  readonly kPlnEu: 0 | 1 | 2 | 3;
  readonly plnHodnota: Money;
  readonly plnPocet: number;
  readonly porCStran: 1;
  readonly documentIds: readonly string[];
}

export interface ShvComputation {
  readonly monthStart: LegalDate;
  readonly rows: readonly ShvRow[];
  readonly total: Money;
}

type CzRules = ReturnType<typeof createCzRules>;

export function computeShv(
  entries: readonly VatLedgerEntryDraft[],
  rules: CzRules,
  monthStart: LegalDate,
): ShvComputation {
  const month = monthStart.slice(0, 7);
  const scoped = entries.filter((e) => e.shvCode !== null && e.vatPointDate.slice(0, 7) === month);

  const groups = new Map<
    string,
    { kStat: string; cVat: string; kPlnEu: 0 | 1 | 2 | 3; items: VatLedgerEntryDraft[] }
  >();
  for (const e of scoped) {
    const parts = vatIdParts(e.counterpartyVatId);
    const kStat = parts?.kStat ?? '';
    const cVat = parts?.number ?? '';
    const kPlnEu = e.shvCode as 0 | 1 | 2 | 3;
    const key = `${kStat}\u0000${cVat}\u0000${kPlnEu}`;
    const group = groups.get(key) ?? { kStat, cVat, kPlnEu, items: [] };
    group.items.push(e);
    groups.set(key, group);
  }

  const mode = rules.at(monthStart).get('vat.shv_rounding');
  const roundGroup = mode === 'round' ? round0 : mode === 'floor' ? floor0 : ceil0;

  const sorted = [...groups.values()].sort((a, b) => {
    if (a.kStat !== b.kStat) return a.kStat < b.kStat ? -1 : 1;
    if (a.cVat !== b.cVat) return a.cVat < b.cVat ? -1 : 1;
    return a.kPlnEu - b.kPlnEu;
  });

  const rows: ShvRow[] = sorted.map((g, i) => ({
    cRad: i + 1,
    kStat: g.kStat,
    cVat: g.cVat,
    kPlnEu: g.kPlnEu,
    plnHodnota: roundGroup(
      Money.sum(
        g.items.map((e) => e.baseCzk),
        CZK,
      ),
    ),
    plnPocet: new Set(g.items.map((e) => e.documentId)).size,
    porCStran: 1,
    documentIds: [...new Set(g.items.map((e) => e.documentId))].sort(),
  }));

  return {
    monthStart,
    rows,
    total: Money.sum(
      rows.map((r) => r.plnHodnota),
      CZK,
    ),
  };
}
