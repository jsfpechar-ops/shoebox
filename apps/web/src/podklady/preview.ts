// Podklady preview builders (0365): pure, no I/O.

import type { FilingRow } from '@shoebox/db';
import type { LegalDate, MemberRole, PodkladySummary } from '@shoebox/domain';
import {
  type PodkladyCardView,
  type PodkladyFilingView,
  type PodkladyPreviewView,
  serializeMoney,
  type TotalsDiff,
} from './view';

export const PODKLADY_READ_ROLES: readonly MemberRole[] = [
  'owner',
  'member',
  'accountant',
  'viewer',
];
export const PODKLADY_WRITE_ROLES: readonly MemberRole[] = ['owner', 'member'];
export const PODKLADY_DOWNLOAD_ROLES: readonly MemberRole[] = ['owner', 'member', 'accountant'];

const GENERATED_STATES: readonly string[] = ['generated', 'downloaded', 'marked_filed'];
const FIELDS = ['income', 'expenses', 'base'] as const;

interface Headline {
  readonly income: string;
  readonly expenses: string;
  readonly base: string;
}

/** The fields whose total differs between the generated filing and the live ledger. */
export function diffTotals(before: Headline | null, after: Headline): TotalsDiff[] {
  if (before === null) return [];
  return FIELDS.filter((f) => before[f] !== after[f]).map((field) => ({
    field,
    before: before[field],
    after: after[field],
  }));
}

interface StoredTotals {
  readonly ledgerHash?: unknown;
  readonly answersVersion?: unknown;
  readonly headline?: Partial<Headline>;
}

function headlineOf(totals: StoredTotals): Headline | null {
  const h = totals.headline;
  if (h === undefined || h === null) return null;
  if (typeof h.income !== 'string' || typeof h.expenses !== 'string' || typeof h.base !== 'string')
    return null;
  return { income: h.income, expenses: h.expenses, base: h.base };
}

function filingViewOf(f: FilingRow): PodkladyFilingView {
  const totals = (f.totals ?? {}) as StoredTotals;
  return {
    id: f.id,
    state: f.state,
    generatedAt: f.generatedAt,
    markedFiledAt: f.markedFiledAt,
    pdf: f.pdfPath !== null,
    xlsx: f.xlsxPath !== null,
    ledgerHash: typeof totals.ledgerHash === 'string' ? totals.ledgerHash : null,
    answersVersion: typeof totals.answersVersion === 'number' ? totals.answersVersion : null,
  };
}

export function buildPodkladyPreview(
  summary: PodkladySummary,
  latest: FilingRow | null,
  role: MemberRole,
  ledgerHash: string,
): PodkladyPreviewView {
  const totals = (latest?.totals ?? {}) as StoredTotals;
  const hasFile = latest !== null && GENERATED_STATES.includes(latest.state);
  const changedSinceGeneration = hasFile && totals.ledgerHash !== ledgerHash;
  const changedSinceHandoff = changedSinceGeneration && latest?.state === 'marked_filed';
  const live: Headline = {
    income: summary.headline.income.toFixed2(),
    expenses: summary.headline.expenses.toFixed2(),
    base: summary.headline.base.toFixed2(),
  };
  const diff = changedSinceGeneration ? diffTotals(headlineOf(totals), live) : [];
  const canGenerate = PODKLADY_WRITE_ROLES.includes(role) && !summary.blocked && !summary.empty;
  const canDownload = PODKLADY_DOWNLOAD_ROLES.includes(role) && hasFile;
  const url = (format: 'pdf' | 'xlsx', present: boolean): string | null =>
    canDownload && latest !== null && present
      ? `/api/v1/filings/${latest.id}/download?format=${format}`
      : null;
  return {
    year: summary.year,
    empty: summary.empty,
    blocked: summary.blocked,
    watermark: summary.watermark,
    summary: serializeMoney(summary),
    readiness: summary.readiness.map((c) => ({
      code: c.code,
      severity: c.severity,
      params: c.params as Record<string, string | number>,
    })),
    latestFiling: latest === null ? null : filingViewOf(latest),
    changedSinceGeneration,
    changedSinceHandoff,
    diff,
    canGenerate,
    canDownload,
    partialXmlEligible: summary.partialXmlEligible,
    downloadUrls: {
      pdf: url('pdf', latest?.pdfPath != null),
      xlsx: url('xlsx', latest?.xlsxPath != null),
    },
  };
}

const yearOf = (d: LegalDate): number => Number.parseInt(d.slice(0, 4), 10);

/** The Přehled card shows itself January to June for the previous year; otherwise it is opened on demand (M06 §7). */
export function shouldShowPodkladyCard(
  today: LegalDate,
  year: number,
  hasData: boolean,
): PodkladyCardView {
  if (!hasData) return { year, show: false, reason: 'no_data' };
  const month = Number.parseInt(today.slice(5, 7), 10);
  if (month <= 6 && year === yearOf(today) - 1) return { year, show: true, reason: 'season' };
  return { year, show: false, reason: 'on_demand' };
}

/** Years to offer, newest first. */
export function podkladyYearsFor(today: LegalDate, firstYearWithData: number | null): number[] {
  if (firstYearWithData === null) return [];
  const years: number[] = [];
  for (let y = yearOf(today); y >= firstYearWithData; y -= 1) years.push(y);
  return years;
}

/** Route param to a year in 2024..today.year, else null. */
export function parseYearParam(raw: string, today: LegalDate): number | null {
  if (!/^\d{4}$/.test(raw)) return null;
  const year = Number.parseInt(raw, 10);
  return year >= 2024 && year <= yearOf(today) ? year : null;
}
