import { Money, type Money as MoneyType } from '@shoebox/domain';
import { catalogs, type MessageKey, t } from '@shoebox/i18n';
import { formatCzkWhole } from '../overview/format';
import type { PodkladyPreviewView, TaxReserveView } from './view';

export interface PodkladyCardModel {
  readonly year: number;
  readonly title: string;
  readonly warnings: readonly string[];
  readonly changed: string | null;
  readonly watermark: string | null;
  readonly viewHref: string;
  readonly pdfHref: string | null;
  readonly xlsxHref: string | null;
  readonly canPrepare: boolean;
  readonly markFiledId: string | null;
}

/** Whole crowns from a toFixed2() money string. Money is parsed by Money.parse, never by Number. */
export function wholeCzk(amount: string): string {
  return formatCzkWhole(Money.parse(amount, 'CZK') as MoneyType);
}

function wholeNumber(amount: string): string {
  return new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 }).format(
    amount as unknown as number,
  );
}

function dateText(date: string): string {
  const [y = '', m = '', d = ''] = date.split('-');
  return `${Number(d)}. ${Number(m)}. ${y}`;
}

function generatedOnOf(summary: unknown): string | null {
  return typeof summary === 'object' &&
    summary !== null &&
    'generatedOn' in summary &&
    typeof summary.generatedOn === 'string'
    ? summary.generatedOn
    : null;
}

export function readinessText(c: {
  code: string;
  params: Record<string, string | number>;
}): string | null {
  const key = `podklady.readiness.${c.code.toLowerCase()}`;
  return key in catalogs.en ? t(key as MessageKey, c.params) : null;
}

function diffText(p: PodkladyPreviewView): string {
  return p.diff
    .map(
      (d) =>
        `${t(`podklady.headline.${d.field}` as MessageKey)}: ${wholeCzk(d.before)} → ${wholeCzk(d.after)}`,
    )
    .join('; ');
}

export function podkladyCardModel(p: PodkladyPreviewView): PodkladyCardModel {
  const generatedOn = generatedOnOf(p.summary);
  const f = p.latestFiling;
  const warnings = p.readiness
    .map((r, index) => ({ r, index, rank: r.severity === 'blocking' ? 0 : 1 }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ r }) => readinessText(r))
    .filter((text): text is string => text !== null);
  return {
    year: p.year,
    title: t('podklady.title', { year: String(p.year) }),
    warnings,
    changed: p.changedSinceHandoff
      ? t('podklady.changed_after_handoff', { diff: diffText(p) })
      : null,
    watermark:
      p.watermark && generatedOn !== null
        ? t('podklady.watermark', { date: dateText(generatedOn) })
        : null,
    viewHref: `/prehled/podklady/${p.year}`,
    pdfHref: p.downloadUrls.pdf,
    xlsxHref: p.downloadUrls.xlsx,
    canPrepare: p.canGenerate && (f === null || p.changedSinceGeneration),
    markFiledId:
      f !== null && (f.state === 'generated' || f.state === 'downloaded') && p.canGenerate
        ? f.id
        : null,
  };
}

export function reserveText(r: TaxReserveView): { main: string; badge: string } | null {
  if (r.kind === 'estimate' && r.display !== null) {
    return { main: `≈ ${wholeCzk(r.display)}`, badge: t('reserve.badge') };
  }
  if (r.kind === 'pausalni_dan' && r.paid !== null && r.due !== null) {
    return {
      main: t('reserve.pausalni_dan', { paid: wholeNumber(r.paid), due: wholeNumber(r.due) }),
      badge: t('reserve.badge'),
    };
  }
  return null;
}
