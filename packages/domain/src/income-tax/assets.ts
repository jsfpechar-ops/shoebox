import type { LegalDate } from '../dates/index';
import { CZK, Money } from '../money/index';
import type { CzRules } from '../vat/period';

export interface AssetLineInput {
  readonly documentId: string;
  readonly lineId: string;
  readonly documentNumber: string | null;
  readonly partnerName: string | null;
  readonly description: string | null;
  readonly issueDate: LegalDate | null;
  readonly paidAt: LegalDate | null;
  readonly categoryCode: string;
  readonly net: Money | null;
  readonly gross: Money | null;
  readonly businessSharePct: string;
  readonly vatDeducted: boolean;
  readonly carFlag: boolean;
  readonly paidInYear: Money;
}
export interface AssetRow {
  readonly documentId: string;
  readonly lineId: string;
  readonly date: LegalDate | null;
  readonly partnerName: string | null;
  readonly description: string | null;
  readonly documentNumber: string | null;
  readonly price: Money;
  readonly paidInYear: Money;
  readonly businessSharePct: string;
  readonly carFlag: boolean;
}
export interface AssetWarning {
  readonly code: 'asset.maybe_misclassified' | 'asset.below_threshold';
  readonly documentId: string;
  readonly lineId: string;
  readonly params: { readonly price: string; readonly threshold: string };
}
export interface AssetLists {
  readonly assets: readonly AssetRow[];
  readonly smallAssets: readonly AssetRow[];
  readonly warnings: readonly AssetWarning[];
  readonly threshold: Money;
}

function priceOf(line: AssetLineInput): Money {
  if (line.vatDeducted) return line.net ?? line.gross ?? Money.zero(CZK);
  return line.gross ?? line.net ?? Money.zero(CZK);
}

function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function toRow(line: AssetLineInput): AssetRow {
  return {
    documentId: line.documentId,
    lineId: line.lineId,
    date: line.paidAt ?? line.issueDate,
    partnerName: line.partnerName,
    description: line.description,
    documentNumber: line.documentNumber,
    price: priceOf(line),
    paidInYear: line.paidInYear,
    businessSharePct: line.businessSharePct,
    carFlag: line.carFlag,
  };
}

function sortRows(rows: AssetRow[]): AssetRow[] {
  return rows.sort(
    (a, b) => compareText(a.date ?? '', b.date ?? '') || compareText(a.lineId, b.lineId),
  );
}

/** M06 §4.5: asset list for one year, with the two consistency warnings. */
export function listAssets(
  lines: readonly AssetLineInput[],
  rules: CzRules,
  year: number,
): AssetLists {
  const threshold = Money.parse(
    String(rules.at(`${year}-12-31`).get('asset.capitalization_threshold')),
    CZK,
  );
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  const inYear = (date: LegalDate | null): boolean => date !== null && date >= start && date <= end;

  const seen = new Set<string>();
  const current: AssetLineInput[] = [];
  for (const line of lines) {
    if (!(inYear(line.paidAt) || inYear(line.issueDate))) continue;
    if (seen.has(line.lineId)) continue;
    seen.add(line.lineId);
    current.push(line);
  }

  const warnings: AssetWarning[] = [];
  for (const line of current) {
    const price = priceOf(line);
    const above = price.toDecimal().gt(threshold.toDecimal());
    const isAsset = line.categoryCode === 'asset_long_term';
    if ((!isAsset && above) || (isAsset && !above)) {
      warnings.push({
        code: isAsset ? 'asset.below_threshold' : 'asset.maybe_misclassified',
        documentId: line.documentId,
        lineId: line.lineId,
        params: { price: price.toFixed2(), threshold: threshold.toFixed2() },
      });
    }
  }

  const assets = sortRows(current.filter((l) => l.categoryCode === 'asset_long_term').map(toRow));
  const smallAssets = sortRows(
    current.filter((l) => l.categoryCode === 'exp_small_assets').map(toRow),
  );
  return { assets, smallAssets, warnings, threshold };
}
