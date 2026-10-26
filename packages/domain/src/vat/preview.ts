import type { LegalDate } from '../dates/index';
import type { Money } from '../money/index';
import type { Dphdp3Computation } from './dphdp3';
import type { KhComputation } from './kh';
import type { VatLedgerEntryDraft } from './ledger';
import type { ShvComputation } from './shv';

export interface PreviewEntry {
  readonly documentId: string;
  readonly partnerName: string | null;
  readonly documentNumber: string | null;
  readonly vatPointDate: LegalDate;
  readonly currency: string;
  readonly amountForeign: string | null;
  readonly fxRate: string | null;
  readonly fxRateDate: LegalDate | null;
  readonly baseCzk: string;
  readonly vatCzk: string;
} // Money as toFixed2()

export interface PreviewRow {
  readonly row: string;
  readonly labelKey: `vat.row.${string}.label`;
  readonly raw: { base: string; tax: string } | null;
  readonly rounded: { base: string; tax: string };
  readonly entries: readonly PreviewEntry[];
}

export interface PreviewDocumentMeta {
  readonly partnerName: string | null;
  readonly documentNumber: string | null;
}

export type PreviewKhSection = 'A2' | 'A4' | 'A5' | 'B2' | 'B3';

export interface PreviewKhRow {
  readonly key: string;
  readonly counterparty: string | null;
  readonly evidenceNumber: string | null;
  readonly dppd: LegalDate | null;
  readonly zaklDane1: string;
  readonly dan1: string;
  readonly zaklDane2: string;
  readonly dan2: string;
  readonly entries: readonly PreviewEntry[];
}

export interface PreviewShvRow {
  readonly kStat: string;
  readonly cVat: string;
  readonly code: number;
  readonly labelKey: string;
  readonly plnHodnota: string;
  readonly plnPocet: number;
  readonly entries: readonly PreviewEntry[];
}

export interface PeriodPreview {
  readonly form: 'DPHDP3' | 'DPHKH1' | 'DPHSHV';
  readonly periodStart: LegalDate;
  readonly rows: readonly PreviewRow[];
  readonly result: { row62: string; row63: string; row64: string; row65: string } | null;
  readonly khSections: ReadonlyArray<{
    section: PreviewKhSection;
    labelKey: string;
    rows: readonly PreviewKhRow[];
  }> | null;
  readonly shvRows: readonly PreviewShvRow[] | null;
}

const KH_SECTIONS: readonly PreviewKhSection[] = ['A2', 'A4', 'A5', 'B2', 'B3'];

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function documentNumberOf(meta: ReadonlyMap<string, PreviewDocumentMeta>, documentId: string): string {
  return meta.get(documentId)?.documentNumber ?? '';
}

function sortEntries(
  list: readonly VatLedgerEntryDraft[],
  meta: ReadonlyMap<string, PreviewDocumentMeta>,
): VatLedgerEntryDraft[] {
  return [...list].sort(
    (a, b) =>
      compareText(a.vatPointDate, b.vatPointDate) ||
      compareText(documentNumberOf(meta, a.documentId), documentNumberOf(meta, b.documentId)) ||
      compareText(a.documentId, b.documentId),
  );
}

function toEntry(e: VatLedgerEntryDraft, meta: ReadonlyMap<string, PreviewDocumentMeta>): PreviewEntry {
  const m = meta.get(e.documentId);
  return {
    documentId: e.documentId,
    partnerName: m?.partnerName ?? null,
    documentNumber: m?.documentNumber ?? null,
    vatPointDate: e.vatPointDate,
    currency: e.currency,
    amountForeign: e.baseForeign ? e.baseForeign.toFixed2() : null,
    fxRate: e.fxRate,
    fxRateDate: e.fxRateDate,
    baseCzk: e.baseCzk.toFixed2(),
    vatCzk: e.vatCzk.toFixed2(),
  };
}

function entriesFor(
  entries: readonly VatLedgerEntryDraft[],
  meta: ReadonlyMap<string, PreviewDocumentMeta>,
  pick: (e: VatLedgerEntryDraft) => boolean,
): PreviewEntry[] {
  return sortEntries(entries.filter(pick), meta).map((e) => toEntry(e, meta));
}

function moneyPair(base: Money, tax: Money): { base: string; tax: string } {
  return { base: base.toFixed2(), tax: tax.toFixed2() };
}

function khAmounts(r: {
  zaklDane1: Money;
  dan1: Money;
  zaklDane2: Money;
  dan2: Money;
}): Pick<PreviewKhRow, 'zaklDane1' | 'dan1' | 'zaklDane2' | 'dan2'> {
  return {
    zaklDane1: r.zaklDane1.toFixed2(),
    dan1: r.dan1.toFixed2(),
    zaklDane2: r.zaklDane2.toFixed2(),
    dan2: r.dan2.toFixed2(),
  };
}

function buildKhSections(
  entries: readonly VatLedgerEntryDraft[],
  meta: ReadonlyMap<string, PreviewDocumentMeta>,
  kh: KhComputation,
): PeriodPreview['khSections'] {
  const sections: Array<{ section: PreviewKhSection; labelKey: string; rows: PreviewKhRow[] }> = [];
  for (const section of KH_SECTIONS) {
    const rows: PreviewKhRow[] = [];
    if (section === 'A2') {
      for (const r of kh.a2) {
        rows.push({
          key: `A2-${r.cRadku}`,
          counterparty: `${r.kStat}${r.vatidDod}`,
          evidenceNumber: r.cEvidDd,
          dppd: r.dppd,
          ...khAmounts(r),
          entries: entriesFor(entries, meta, (e) => e.khSection === 'A2' && e.documentId === r.documentId),
        });
      }
    } else if (section === 'A4') {
      for (const r of kh.a4) {
        rows.push({
          key: `A4-${r.cRadku}`,
          counterparty: r.dicOdb,
          evidenceNumber: r.cEvidDd,
          dppd: r.dppd,
          ...khAmounts(r),
          entries: entriesFor(entries, meta, (e) => e.khSection === 'A4' && e.documentId === r.documentId),
        });
      }
    } else if (section === 'B2') {
      for (const r of kh.b2) {
        rows.push({
          key: `B2-${r.cRadku}`,
          counterparty: r.dicDod,
          evidenceNumber: r.cEvidDd,
          dppd: r.dppd,
          ...khAmounts(r),
          entries: entriesFor(entries, meta, (e) => e.khSection === 'B2' && e.documentId === r.documentId),
        });
      }
    } else {
      const agg = section === 'A5' ? kh.a5 : kh.b3;
      if (agg) {
        const ids = new Set(agg.documentIds);
        rows.push({
          key: section,
          counterparty: null,
          evidenceNumber: null,
          dppd: null,
          ...khAmounts(agg),
          entries: entriesFor(entries, meta, (e) => e.khSection === section && ids.has(e.documentId)),
        });
      }
    }
    if (rows.length > 0) sections.push({ section, labelKey: `vat.kh.section.${section}`, rows });
  }
  return sections;
}

function buildShvRows(
  entries: readonly VatLedgerEntryDraft[],
  meta: ReadonlyMap<string, PreviewDocumentMeta>,
  shv: ShvComputation,
): PreviewShvRow[] {
  return shv.rows.map((r) => {
    const ids = new Set(r.documentIds);
    return {
      kStat: r.kStat,
      cVat: r.cVat,
      code: r.kPlnEu,
      labelKey: `vat.shv.code.${r.kPlnEu}`,
      plnHodnota: r.plnHodnota.toFixed2(),
      plnPocet: r.plnPocet,
      entries: entriesFor(entries, meta, (e) => e.shvCode === r.kPlnEu && ids.has(e.documentId)),
    };
  });
}

/**
 * Pure preview data for the human check before download. Derived DPHDP3 rows (43, 44, 46)
 * have `raw: null` and no entries. Labels are i18n keys, not text.
 */
export function buildPeriodPreview(
  form: PeriodPreview['form'],
  entries: readonly VatLedgerEntryDraft[],
  meta: ReadonlyMap<string, PreviewDocumentMeta>,
  dp3: Dphdp3Computation,
  kh: KhComputation | null,
  shv: ShvComputation | null,
): PeriodPreview {
  const rowKeys = Object.keys(dp3.rows).sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
  const rows: PreviewRow[] = [];
  for (const row of rowKeys) {
    const rounded = dp3.rows[row];
    if (rounded === undefined) continue;
    const rawValue = dp3.raw[row];
    const raw = rawValue ? moneyPair(rawValue.base, rawValue.tax) : null;
    rows.push({
      row,
      labelKey: `vat.row.${row}.label`,
      raw,
      rounded: moneyPair(rounded.base, rounded.tax),
      entries: raw === null ? [] : entriesFor(entries, meta, (e) => e.dphdp3Rows.includes(row)),
    });
  }

  return {
    form,
    periodStart: dp3.periodStart,
    rows,
    result: {
      row62: dp3.row62.toFixed2(),
      row63: dp3.row63.toFixed2(),
      row64: dp3.row64.toFixed2(),
      row65: dp3.row65.toFixed2(),
    },
    khSections: kh ? buildKhSections(entries, meta, kh) : null,
    shvRows: shv ? buildShvRows(entries, meta, shv) : null,
  };
}
