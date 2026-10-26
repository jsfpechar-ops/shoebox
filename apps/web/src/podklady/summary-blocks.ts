import { Money, type Money as MoneyType } from '@shoebox/domain';
import { catalogs, type MessageKey, t } from '@shoebox/i18n';
import { wholeCzk } from './card-view';

type Rec = Record<string, unknown>;

function rec(value: unknown): Rec | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Rec)
    : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function crowns(value: unknown): string | null {
  const s = str(value);
  if (s === null) return null;
  try {
    return wholeCzk(s);
  } catch {
    return null;
  }
}

/** Whole number with no currency sign, from an exact money string. */
function plain(value: unknown): string | null {
  const s = str(value);
  if (s === null) return null;
  try {
    const m = Money.parse(s, 'CZK') as MoneyType;
    return new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 }).format(
      m.toFixed2() as unknown as number,
    );
  } catch {
    return null;
  }
}

function dateText(value: unknown): string | null {
  const s = str(value);
  if (s === null || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y = '', m = '', d = ''] = s.split('-');
  return `${Number(d)}. ${Number(m)}. ${y}`;
}

function hasKey(key: string): key is MessageKey {
  return key in catalogs.en;
}

export interface CategoryEntry {
  key: string;
  documentId: string;
  date: string | null;
  amount: string | null;
}
export interface CategoryRow {
  label: string;
  amount: string;
  count: number;
  entries: CategoryEntry[];
}
export interface CategoryGroup {
  title: string;
  rows: CategoryRow[];
}

function groupOf(
  title: string,
  source: unknown,
  field: 'amount' | 'businessAmount',
  entryField: 'amountCzk' | 'businessAmountCzk',
  labels: ReadonlyMap<string, string>,
): CategoryGroup {
  const rows: CategoryRow[] = [];
  for (const raw of list(source)) {
    const item = rec(raw);
    if (item === null) continue;
    const code = str(item.categoryCode);
    const amount = crowns(item[field]);
    if (code === null || amount === null) continue;
    const entries: CategoryEntry[] = [];
    for (const e of list(item.entries)) {
      const entry = rec(e);
      const documentId = entry === null ? null : str(entry.documentId);
      if (entry === null || documentId === null) continue;
      entries.push({
        key: `${documentId}-${entries.length}`,
        documentId,
        date: dateText(entry.entryDate),
        amount: crowns(entry[entryField]),
      });
    }
    const count = typeof item.entryCount === 'number' ? item.entryCount : entries.length;
    rows.push({ label: labels.get(code) ?? code, amount, count, entries });
  }
  return { title, rows };
}

export function categoryBlocks(
  summary: unknown,
  labels: ReadonlyMap<string, string>,
): CategoryGroup[] {
  const totals = rec(rec(summary)?.totals);
  if (totals === null) return [];
  return [
    groupOf(t('podklady.group.income'), totals.income, 'amount', 'amountCzk', labels),
    groupOf(
      t('podklady.group.expenses'),
      totals.deductible,
      'businessAmount',
      'businessAmountCzk',
      labels,
    ),
    groupOf(
      t('podklady.group.not_deductible'),
      totals.nonDeductible,
      'amount',
      'amountCzk',
      labels,
    ),
  ].filter((g) => g.rows.length > 0);
}

export interface ComparisonModel {
  text: string;
  cap: string | null;
  caveats: string[];
}

export function comparisonBlock(summary: unknown): ComparisonModel | null {
  const flat = rec(rec(summary)?.flatRate);
  if (flat === null) return null;
  const difference = plain(flat.difference);
  let main: string;
  if (flat.better === 'equal') {
    main = t('podklady.flat.equal');
  } else {
    const rate =
      typeof flat.rate === 'number' || typeof flat.rate === 'string' ? String(flat.rate) : null;
    if (rate === null || difference === null) return null;
    main = t('podklady.flat.result', {
      rate,
      difference,
      direction: flat.better === 'flat' ? t('podklady.flat.lower') : t('podklady.flat.higher'),
    });
  }
  const capKc = plain(flat.capKc);
  const cap =
    flat.capReached === true && capKc !== null ? t('podklady.flat.cap', { cap: capKc }) : null;
  const caveats = list(flat.caveatKeys)
    .filter((k): k is string => typeof k === 'string' && hasKey(k))
    .map((k) => t(k as MessageKey));
  return { text: main, cap, caveats };
}

export interface PausalniModel {
  lines: string[];
  warnings: string[];
}

export function pausalniBlock(summary: unknown): PausalniModel | null {
  const s = rec(summary);
  const pd = rec(s?.pausalniDan);
  if (pd === null) return null;
  const lines: string[] = [];
  const income = plain(rec(s?.flatRate)?.incomeKc) ?? plain(rec(s?.headline)?.income);
  const limit = plain(pd.limit);
  if (typeof pd.fitBand === 'number' && income !== null && limit !== null) {
    lines.push(t('pd.band_ok', { income, band: String(pd.fitBand), limit }));
  }
  const paid = plain(pd.paid);
  const expected = plain(pd.expected);
  const delta = plain(pd.delta);
  if (pd.advancesState === 'ok' && paid !== null && expected !== null) {
    lines.push(t('pd.advances_ok', { paid, expected }));
  } else if (pd.advancesState === 'missing' && delta !== null) {
    lines.push(t('pd.advances_missing', { delta }));
  } else if (pd.advancesState === 'overpaid' && delta !== null) {
    lines.push(t('pd.advances_overpaid', { delta }));
  }
  const due = dateText(pd.noticeDue);
  if (due !== null) lines.push(t('pd.notice', { date: due }));
  const warnings: string[] = [];
  for (const raw of list(pd.warnings)) {
    const w = rec(raw);
    const code = w === null ? null : str(w.code);
    if (w === null || code === null || !hasKey(code)) continue;
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(rec(w.params) ?? {})) {
      if (typeof v === 'number') params[k] = String(v);
      else if (typeof v === 'string') params[k] = /^-?\d+\.\d{2}$/.test(v) ? (plain(v) ?? v) : v;
    }
    warnings.push(t(code, params));
  }
  return { lines, warnings };
}

export interface AssetRowModel {
  key: string;
  title: string;
  date: string | null;
  price: string;
}
export interface AssetsModel {
  assets: AssetRowModel[];
  small: AssetRowModel[];
  note: string;
  personal: string | null;
  shares: { key: string; description: string; total: string; pct: string }[];
}

function assetRows(source: unknown): AssetRowModel[] {
  const rows: AssetRowModel[] = [];
  for (const raw of list(source)) {
    const r = rec(raw);
    const price = r === null ? null : crowns(r.price);
    if (r === null || price === null) continue;
    const title = str(r.description) ?? str(r.partnerName) ?? str(r.documentNumber) ?? '';
    rows.push({ key: `${rows.length}`, title, date: dateText(r.date), price });
  }
  return rows;
}

export function assetsBlock(summary: unknown): AssetsModel {
  const s = rec(summary);
  const assets = assetRows(rec(s?.assets)?.assets);
  const small = assetRows(rec(s?.assets)?.smallAssets);
  const pu = rec(s?.privateUse);
  const count = typeof pu?.personalCount === 'number' ? pu.personalCount : 0;
  const sum = plain(pu?.personalSum);
  const personal =
    count > 0 && sum !== null ? t('podklady.private.personal', { count, sum }) : null;
  const shares: AssetsModel['shares'] = [];
  for (const raw of list(pu?.partialShares)) {
    const r = rec(raw);
    const total = r === null ? null : crowns(r.totalCzk);
    const pct = r === null ? null : str(r.businessSharePct);
    if (r === null || total === null || pct === null) continue;
    shares.push({ key: `${shares.length}`, description: str(r.description) ?? '', total, pct });
  }
  return { assets, small, note: t('podklady.assets.note'), personal, shares };
}

export function vatNoteText(summary: unknown): string | null {
  const note = rec(rec(summary)?.vatNote);
  const kind = note === null ? null : str(note.kind);
  if (kind === null) return null;
  const key = `podklady.vat.${kind}`;
  return hasKey(key) ? t(key) : null;
}

export function regimeOf(summary: unknown): string | null {
  return str(rec(summary)?.regime);
}
