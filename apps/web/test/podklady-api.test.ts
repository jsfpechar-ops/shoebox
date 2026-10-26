import type { FilingRow } from '@shoebox/db';
import { CZK, type LegalDate, type MemberRole, Money, type PodkladySummary } from '@shoebox/domain';
import { XLSX_MIME } from '@shoebox/exports';
import { describe, expect, it } from 'vitest';
import { decideGenerate } from '../src/podklady/generate';
import {
  buildPodkladyPreview,
  podkladyYearsFor,
  shouldShowPodkladyCard,
} from '../src/podklady/preview';
import { serializeMoney } from '../src/podklady/view';
import { decideDownload, type FilingView } from '../src/vat/filings';

const money = (v: string): Money => Money.parse(v, CZK);
const day = (v: string): LegalDate => v as LegalDate;

function summary(over: Partial<PodkladySummary> = {}): PodkladySummary {
  return {
    year: 2026,
    empty: false,
    blocked: false,
    watermark: false,
    readiness: [{ code: 'P_YEAR_OPEN', severity: 'warn', params: { n: 2 } }],
    headline: {
      income: money('1000'),
      expenses: money('400'),
      base: money('600'),
      label: 'actual',
    },
    partialXmlEligible: false,
    ...over,
  } as unknown as PodkladySummary;
}

function filing(state: string, hash: string): FilingRow {
  return {
    id: 'f1',
    state,
    totals: {
      ledgerHash: hash,
      headline: { income: '900.00', expenses: '400.00', base: '500.00' },
    },
    pdfPath: 'a.pdf',
    xlsxPath: 'a.xlsx',
    generatedAt: '2027-02-01T10:00:00Z',
    markedFiledAt: state === 'marked_filed' ? '2027-02-02T10:00:00Z' : null,
  } as unknown as FilingRow;
}

describe('buildPodkladyPreview', () => {
  it('no filing: canGenerate for owner/member only, canDownload false, no diff', () => {
    const roles: MemberRole[] = ['owner', 'member', 'accountant', 'viewer'];
    const can = roles.map((r) => buildPodkladyPreview(summary(), null, r, 'h').canGenerate);
    expect(can).toEqual([true, true, false, false]);
    const v = buildPodkladyPreview(summary(), null, 'owner', 'h');
    expect(v.canDownload).toBe(false);
    expect(v.diff).toEqual([]);
    expect(v.latestFiling).toBeNull();
    expect(v.readiness[0]).toEqual({ code: 'P_YEAR_OPEN', severity: 'warn', params: { n: 2 } });
  });

  it('generated filing with the same hash: canDownload for accountant, urls pdf/xlsx, changedSinceGeneration false', () => {
    const v = buildPodkladyPreview(summary(), filing('generated', 'h'), 'accountant', 'h');
    expect(v.canDownload).toBe(true);
    expect(v.downloadUrls).toEqual({
      pdf: '/api/v1/filings/f1/download?format=pdf',
      xlsx: '/api/v1/filings/f1/download?format=xlsx',
    });
    expect(v.changedSinceGeneration).toBe(false);
    expect(v.latestFiling?.pdf).toBe(true);
  });

  it('marked_filed filing with another hash: changedSinceHandoff true, diff lists income/expenses/base before→after', () => {
    const v = buildPodkladyPreview(summary(), filing('marked_filed', 'old'), 'owner', 'h');
    expect(v.changedSinceGeneration).toBe(true);
    expect(v.changedSinceHandoff).toBe(true);
    expect(v.diff).toEqual([
      { field: 'income', before: '900.00', after: '1000.00' },
      { field: 'base', before: '500.00', after: '600.00' },
    ]);
    const g = buildPodkladyPreview(summary(), filing('generated', 'old'), 'owner', 'h');
    expect(g.changedSinceGeneration).toBe(true);
    expect(g.changedSinceHandoff).toBe(false);
  });

  it('viewer: canGenerate false, canDownload false; blocked summary: canGenerate false', () => {
    const v = buildPodkladyPreview(summary(), filing('generated', 'h'), 'viewer', 'h');
    expect(v.canGenerate).toBe(false);
    expect(v.canDownload).toBe(false);
    expect(v.downloadUrls).toEqual({ pdf: null, xlsx: null });
    expect(buildPodkladyPreview(summary({ blocked: true }), null, 'owner', 'h').canGenerate).toBe(
      false,
    );
  });
});

describe('shouldShowPodkladyCard and years', () => {
  it('15 March 2027 for 2026 with data → season; 15 August → on_demand; no data → no_data', () => {
    expect(shouldShowPodkladyCard(day('2027-03-15'), 2026, true)).toEqual({
      year: 2026,
      show: true,
      reason: 'season',
    });
    expect(shouldShowPodkladyCard(day('2027-08-15'), 2026, true)).toEqual({
      year: 2026,
      show: false,
      reason: 'on_demand',
    });
    expect(shouldShowPodkladyCard(day('2027-03-15'), 2026, false)).toEqual({
      year: 2026,
      show: false,
      reason: 'no_data',
    });
  });

  it('podkladyYearsFor(2027-02-10, 2025) → [2027, 2026, 2025]; null → []', () => {
    expect(podkladyYearsFor(day('2027-02-10'), 2025)).toEqual([2027, 2026, 2025]);
    expect(podkladyYearsFor(day('2027-02-10'), null)).toEqual([]);
  });
});

describe('decideGenerate', () => {
  it('viewer → 403; body with rodneCislo → 400 bad_answers; valid answers parse with defaults', () => {
    expect(decideGenerate('viewer', {})).toEqual({ ok: false, status: 403, code: 'forbidden' });
    expect(decideGenerate('accountant', {})).toMatchObject({ status: 403 });
    expect(decideGenerate('owner', { answers: { rodneCislo: '000000/0000' } })).toEqual({
      ok: false,
      status: 400,
      code: 'bad_answers',
    });
    const ok = decideGenerate('member', { answers: { otherIncome: 'no' } });
    expect(ok).toMatchObject({ ok: true });
    if (ok.ok) {
      expect(ok.answers.otherIncome).toBe('no');
      expect(ok.answers.includePartialXml).toBe(false);
    }
    expect(decideGenerate('owner', null)).toMatchObject({ ok: true });
  });
});

describe('decideDownload for PODKLADY_DPFO (0345 extension)', () => {
  const view = (state: string): FilingView => ({
    id: 'f1',
    type: 'PODKLADY_DPFO',
    kind: 'radne',
    origin: 'generated',
    periodStart: '2026-01-01',
    periodEnd: '2026-12-31',
    state,
    bundleId: null,
    xsdValid: null,
    totals: { ledgerHash: 'old' },
    simpleCheck: {},
    xmlPath: null,
    filedOn: null,
    submissionRef: null,
    generatedAt: null,
    pdfPath: 'org/p.pdf',
    xlsxPath: 'org/p.xlsx',
  });

  it('pdf and xlsx allowed with the filing paths and names; xml → 400 bad_format; a changed hash does not 409; first download marks downloaded', () => {
    const f = view('generated');
    expect(decideDownload(f, [f], 'new', 'pdf')).toEqual({
      ok: true,
      paths: [{ path: 'org/p.pdf', name: 'podklady-2026.pdf' }],
      markDownloaded: true,
      contentType: 'application/pdf',
    });
    expect(decideDownload(f, [f], 'new', 'xlsx')).toMatchObject({
      paths: [{ path: 'org/p.xlsx', name: 'podklady-2026.xlsx' }],
      contentType: XLSX_MIME,
    });
    expect(decideDownload(f, [f], 'new', 'xml')).toEqual({
      ok: false,
      status: 400,
      error: 'bad_format',
    });
    expect(decideDownload(f, [f], 'new', 'zip')).toMatchObject({ status: 400 });
    const d = view('downloaded');
    expect(decideDownload(d, [d], 'new', 'pdf')).toMatchObject({ ok: true, markDownloaded: false });
    const draft = view('draft');
    expect(decideDownload(draft, [draft], 'new', 'pdf')).toMatchObject({ status: 409 });
  });
});

describe('serializeMoney', () => {
  it('Money becomes toFixed2 strings, nested; other values untouched', () => {
    const out = serializeMoney({
      a: money('1.5'),
      n: { list: [money('2')], s: 'x', k: 3, z: null },
    });
    expect(out).toEqual({ a: '1.50', n: { list: ['2.00'], s: 'x', k: 3, z: null } });
  });
});
