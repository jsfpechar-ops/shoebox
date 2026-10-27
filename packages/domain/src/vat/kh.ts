import type { LegalDate } from '../dates/index';
import { CZK, Money, round2 } from '../money/index';
import { type Dphdp3Computation, dphdp3Row } from './dphdp3';
import { dicDigits } from './header';
import type { VatLedgerEntryDraft } from './ledger';

export interface KhAmounts {
  readonly zaklDane1: Money;
  readonly dan1: Money;
  readonly zaklDane2: Money;
  readonly dan2: Money;
}

export interface KhA1Row {
  readonly cRadku: number;
  readonly dicOdb: string;
  readonly cEvidDd: string;
  readonly duzp: LegalDate;
  readonly zaklDane1: Money;
  readonly kodPredPl: string;
  readonly documentId: string;
}

export interface KhB1Row extends KhAmounts {
  readonly cRadku: number;
  readonly dicDod: string;
  readonly cEvidDd: string;
  readonly duzp: LegalDate;
  readonly kodPredPl: string;
  readonly documentId: string;
}

export interface KhA2Row extends KhAmounts {
  readonly cRadku: number;
  readonly kStat: string;
  readonly vatidDod: string;
  readonly cEvidDd: string;
  readonly dppd: LegalDate;
  readonly documentId: string;
}

export interface KhA4Row extends KhAmounts {
  readonly cRadku: number;
  readonly dicOdb: string;
  readonly cEvidDd: string;
  readonly dppd: LegalDate;
  readonly kodRezimPl: '0';
  readonly zdph44: 'N';
  readonly documentId: string;
}

export interface KhB2Row extends KhAmounts {
  readonly cRadku: number;
  readonly dicDod: string;
  readonly cEvidDd: string;
  readonly dppd: LegalDate;
  readonly pomer: 'A' | 'N';
  readonly zdph44: 'N';
  readonly documentId: string;
}

export interface KhAggregate extends KhAmounts {
  readonly documentIds: readonly string[];
}

export interface KhVetaC {
  readonly obrat23: Money;
  readonly obrat5: Money;
  readonly pln23: Money;
  readonly pln5: Money;
  readonly plnRezPren: Money;
  readonly rezPren23: Money;
  readonly rezPren5: Money;
  readonly celkZdA2: Money;
}

export interface KhComputation {
  readonly periodStart: LegalDate;
  readonly a1: readonly KhA1Row[];
  readonly a2: readonly KhA2Row[];
  readonly a4: readonly KhA4Row[];
  readonly a5: KhAggregate | null;
  readonly b1: readonly KhB1Row[];
  readonly b2: readonly KhB2Row[];
  readonly b3: KhAggregate | null;
  readonly c: KhVetaC;
  readonly entryCount: number;
}

export interface KhDocumentInfo {
  readonly duzp: LegalDate | null;
  readonly partnerCountry: string | null;
  /** Distinct non-null § 92a commodity codes of the document's lines; [] when none. */
  readonly rcCommodityCodes: readonly string[];
}

export type KhDocumentLookup = (documentId: string) => KhDocumentInfo | undefined;

/** Splits a VAT ID into its 2-letter prefix and the rest; spaces are dropped. Null when empty. */
export function vatIdParts(vatId: string | null): { kStat: string; number: string } | null {
  const compact = (vatId ?? '').replace(/\s+/g, '');
  if (compact === '') return null;
  const match = /^([A-Za-z]{2})(.+)$/.exec(compact);
  if (match === null || match[1] === undefined || match[2] === undefined) {
    return { kStat: '', number: compact };
  }
  return { kStat: match[1], number: match[2] };
}

interface Buckets {
  readonly zaklDane1: Money;
  readonly dan1: Money;
  readonly zaklDane2: Money;
  readonly dan2: Money;
}

/** Standard, zero and none go to bucket 1; zero and none carry no tax. Reduced goes to bucket 2. */
function bucketsOf(entries: readonly VatLedgerEntryDraft[], proportional: boolean): Buckets {
  const share = (m: Money, e: VatLedgerEntryDraft): Money =>
    proportional ? round2(m.multiply(e.deductionPct).divide('100')) : m;
  const std = entries.filter(
    (e) => e.vatRateType === 'standard' || e.vatRateType === 'zero' || e.vatRateType === 'none',
  );
  const red = entries.filter((e) => e.vatRateType === 'reduced');
  return {
    zaklDane1: Money.sum(
      std.map((e) => share(e.baseCzk, e)),
      CZK,
    ),
    dan1: Money.sum(
      std.map((e) => (e.vatRateType === 'standard' ? share(e.vatCzk, e) : Money.zero(CZK))),
      CZK,
    ),
    zaklDane2: Money.sum(
      red.map((e) => share(e.baseCzk, e)),
      CZK,
    ),
    dan2: Money.sum(
      red.map((e) => share(e.vatCzk, e)),
      CZK,
    ),
  };
}

function groupByDocument(
  entries: readonly VatLedgerEntryDraft[],
): Map<string, VatLedgerEntryDraft[]> {
  const groups = new Map<string, VatLedgerEntryDraft[]>();
  for (const e of [...entries].sort((a, b) =>
    a.documentId < b.documentId ? -1 : a.documentId > b.documentId ? 1 : 0,
  )) {
    const list = groups.get(e.documentId) ?? [];
    list.push(e);
    groups.set(e.documentId, list);
  }
  return groups;
}

function aggregate(
  entries: readonly VatLedgerEntryDraft[],
  proportional: boolean,
): KhAggregate | null {
  if (entries.length === 0) return null;
  const ids = [...new Set(entries.map((e) => e.documentId))].sort();
  return { ...bucketsOf(entries, proportional), documentIds: ids };
}

function compareKeys(a: readonly string[], b: readonly string[]): number {
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? '';
    const y = b[i] ?? '';
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

export function computeKh(
  entries: readonly VatLedgerEntryDraft[],
  dp3: Dphdp3Computation,
  lookup: KhDocumentLookup,
): KhComputation {
  const inSection = (section: string) => entries.filter((e) => e.khSection === section);
  const scoped = entries.filter(
    (e) => e.khSection !== null && ['A1', 'A2', 'A4', 'A5', 'B1', 'B2', 'B3'].includes(e.khSection),
  );

  const a2Rows = [...groupByDocument(inSection('A2')).entries()].map(([documentId, docEntries]) => {
    const first = docEntries[0];
    if (first === undefined) throw new Error('empty document group');
    const parts = vatIdParts(first.counterpartyVatId);
    const kStat = parts?.kStat || lookup(documentId)?.partnerCountry || '';
    return {
      documentId,
      kStat,
      vatidDod: parts?.number ?? '',
      cEvidDd: first.evidenceNumber ?? '',
      dppd: first.vatPointDate,
      ...bucketsOf(docEntries, false),
    };
  });

  const docDate = (documentId: string, fallback: LegalDate): LegalDate =>
    lookup(documentId)?.duzp ?? fallback;

  const kodPredPl = (documentId: string): string => {
    const codes = lookup(documentId)?.rcCommodityCodes ?? [];
    const code = codes[0];
    if (codes.length !== 1 || code === undefined) {
      throw new Error(`kh: document ${documentId} needs exactly one kod_pred_pl`);
    }
    return code;
  };

  const a1Rows = [...groupByDocument(inSection('A1')).entries()].map(([documentId, docEntries]) => {
    const first = docEntries[0];
    if (first === undefined) throw new Error('empty document group');
    return {
      documentId,
      dicOdb: dicDigits(first.counterpartyVatId) ?? '',
      cEvidDd: first.evidenceNumber ?? '',
      duzp: docDate(documentId, first.vatPointDate),
      zaklDane1: Money.sum(
        docEntries.map((x) => x.baseCzk),
        CZK,
      ),
      kodPredPl: kodPredPl(documentId),
    };
  });

  const b1Rows = [...groupByDocument(inSection('B1')).entries()].map(([documentId, docEntries]) => {
    const first = docEntries[0];
    if (first === undefined) throw new Error('empty document group');
    return {
      documentId,
      dicDod: dicDigits(first.counterpartyVatId) ?? '',
      cEvidDd: first.evidenceNumber ?? '',
      duzp: docDate(documentId, first.vatPointDate),
      ...bucketsOf(docEntries, true),
      kodPredPl: kodPredPl(documentId),
    };
  });

  const a4Rows = [...groupByDocument(inSection('A4')).entries()].map(([documentId, docEntries]) => {
    const first = docEntries[0];
    if (first === undefined) throw new Error('empty document group');
    return {
      documentId,
      dicOdb: dicDigits(first.counterpartyVatId) ?? '',
      cEvidDd: first.evidenceNumber ?? '',
      dppd: docDate(documentId, first.vatPointDate),
      ...bucketsOf(docEntries, false),
    };
  });

  const b2Rows = [...groupByDocument(inSection('B2')).entries()].map(([documentId, docEntries]) => {
    const first = docEntries[0];
    if (first === undefined) throw new Error('empty document group');
    return {
      documentId,
      dicDod: dicDigits(first.counterpartyVatId) ?? '',
      cEvidDd: first.evidenceNumber ?? '',
      dppd: docDate(documentId, first.vatPointDate),
      ...bucketsOf(docEntries, true),
      pomer: docEntries.some(
        (x) => Money.parse(x.deductionPct, CZK).compare(Money.parse('100', CZK)) < 0,
      )
        ? ('A' as const)
        : ('N' as const),
    };
  });

  const sortedA1 = a1Rows.sort((a, b) =>
    compareKeys([a.duzp, a.cEvidDd, a.dicOdb], [b.duzp, b.cEvidDd, b.dicOdb]),
  );
  const sortedB1 = b1Rows.sort((a, b) =>
    compareKeys([a.duzp, a.cEvidDd, a.dicDod], [b.duzp, b.cEvidDd, b.dicDod]),
  );
  const sortedA2 = a2Rows.sort((a, b) =>
    compareKeys([a.dppd, a.cEvidDd, a.vatidDod], [b.dppd, b.cEvidDd, b.vatidDod]),
  );
  const sortedA4 = a4Rows.sort((a, b) =>
    compareKeys([a.dppd, a.cEvidDd, a.dicOdb], [b.dppd, b.cEvidDd, b.dicOdb]),
  );
  const sortedB2 = b2Rows.sort((a, b) =>
    compareKeys([a.dppd, a.cEvidDd, a.dicDod], [b.dppd, b.cEvidDd, b.dicDod]),
  );

  const row = (code: string): Money => dphdp3Row(dp3, code).base;

  return {
    periodStart: dp3.periodStart,
    a1: sortedA1.map((r, i) => ({
      cRadku: i + 1,
      dicOdb: r.dicOdb,
      cEvidDd: r.cEvidDd,
      duzp: r.duzp,
      zaklDane1: r.zaklDane1,
      kodPredPl: r.kodPredPl,
      documentId: r.documentId,
    })),
    b1: sortedB1.map((r, i) => ({
      cRadku: i + 1,
      dicDod: r.dicDod,
      cEvidDd: r.cEvidDd,
      duzp: r.duzp,
      zaklDane1: r.zaklDane1,
      dan1: r.dan1,
      zaklDane2: r.zaklDane2,
      dan2: r.dan2,
      kodPredPl: r.kodPredPl,
      documentId: r.documentId,
    })),
    a2: sortedA2.map((r, i) => ({
      cRadku: i + 1,
      kStat: r.kStat,
      vatidDod: r.vatidDod,
      cEvidDd: r.cEvidDd,
      dppd: r.dppd,
      zaklDane1: r.zaklDane1,
      dan1: r.dan1,
      zaklDane2: r.zaklDane2,
      dan2: r.dan2,
      documentId: r.documentId,
    })),
    a4: sortedA4.map((r, i) => ({
      cRadku: i + 1,
      dicOdb: r.dicOdb,
      cEvidDd: r.cEvidDd,
      dppd: r.dppd,
      zaklDane1: r.zaklDane1,
      dan1: r.dan1,
      zaklDane2: r.zaklDane2,
      dan2: r.dan2,
      kodRezimPl: '0',
      zdph44: 'N',
      documentId: r.documentId,
    })),
    a5: aggregate(inSection('A5'), false),
    b2: sortedB2.map((r, i) => ({
      cRadku: i + 1,
      dicDod: r.dicDod,
      cEvidDd: r.cEvidDd,
      dppd: r.dppd,
      zaklDane1: r.zaklDane1,
      dan1: r.dan1,
      zaklDane2: r.zaklDane2,
      dan2: r.dan2,
      pomer: r.pomer,
      zdph44: 'N',
      documentId: r.documentId,
    })),
    b3: aggregate(inSection('B3'), true),
    c: {
      obrat23: row('1'),
      obrat5: row('2'),
      pln23: row('40'),
      pln5: row('41'),
      plnRezPren: row('25'),
      rezPren23: row('10'),
      rezPren5: row('11'),
      celkZdA2: Money.sum(['3', '4', '5', '6', '12', '13'].map(row), CZK),
    },
    entryCount: scoped.length,
  };
}
