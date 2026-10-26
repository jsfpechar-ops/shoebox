import { describe, expect, it } from 'vitest';
import { decideDownload, decideMarkFiled, type FilingView, xmlFileName } from '../src/vat/filings';

const f = (o: Partial<FilingView> = {}): FilingView => ({
  id: 'f1',
  type: 'DPHDP3',
  kind: 'radne',
  origin: 'generated',
  periodStart: '2026-08-01',
  periodEnd: '2026-08-31',
  state: 'generated',
  bundleId: 'b1',
  xsdValid: true,
  totals: { ledgerHash: 'h1' },
  simpleCheck: {},
  xmlPath: 'org/o/filings/b1/DPHDP3.xml',
  filedOn: null,
  submissionRef: null,
  generatedAt: '2026-09-20T10:00:00Z',
  ...o,
});

describe('decideDownload (M05 §9 #13)', () => {
  it('xml of a generated, valid, unchanged filing; marks downloaded once', () => {
    expect(decideDownload(f(), [f()], 'h1', 'xml')).toEqual({
      ok: true,
      paths: [{ path: 'org/o/filings/b1/DPHDP3.xml', name: 'DPHDP3-2026-08-radne.xml' }],
      markDownloaded: true,
    });
    expect(decideDownload(f({ state: 'downloaded' }), [f()], 'h1', 'xml')).toMatchObject({
      ok: true,
      markDownloaded: false,
    });
  });
  it('stale ledger → 409 period_changed; a filed one still downloads', () => {
    expect(decideDownload(f(), [f()], 'h2', 'xml')).toEqual({
      ok: false,
      status: 409,
      error: 'period_changed',
    });
    expect(decideDownload(f({ state: 'marked_filed' }), [f()], 'h2', 'xml')).toMatchObject({
      ok: true,
    });
  });
  it('draft / invalid / bad format / missing', () => {
    expect(decideDownload(f({ state: 'draft', xsdValid: null }), [], 'h1', 'xml')).toMatchObject({
      ok: false,
      status: 409,
      error: 'not_generated',
    });
    expect(decideDownload(f({ xsdValid: false }), [], 'h1', 'xml')).toMatchObject({
      ok: false,
      status: 403,
      error: 'xsd_invalid',
    });
    expect(decideDownload(f({ xsdValid: null }), [], 'h1', 'xml')).toMatchObject({
      ok: false,
      status: 403,
      error: 'xsd_invalid',
    });
    expect(decideDownload(f(), [], 'h1', 'pdf')).toMatchObject({ ok: false, status: 400 });
    expect(decideDownload(null, [], 'h1', 'xml')).toMatchObject({ ok: false, status: 404 });
  });
  it('VAT_WORKBOOK: xlsx ok, changed hash, wrong format', () => {
    const w = f({ type: 'VAT_WORKBOOK', xsdValid: null, xmlPath: null, xlsxPath: 'org/o/w.xlsx' });
    expect(decideDownload(w, [w], 'h1', 'xlsx')).toMatchObject({
      ok: true,
      markDownloaded: true,
      paths: [{ path: 'org/o/w.xlsx', name: 'DPH-2026-08-workbook.xlsx' }],
    });
    expect(decideDownload(w, [w], 'h2', 'xlsx')).toEqual({
      ok: false,
      status: 409,
      error: 'period_changed',
    });
    expect(decideDownload(w, [w], 'h1', 'xml')).toMatchObject({ ok: false, status: 400 });
  });
  it('zip bundles DP3, KH, SH in order and skips drafts', () => {
    const kh = f({ id: 'f2', type: 'DPHKH1', xmlPath: 'org/o/filings/b1/DPHKH1.xml' });
    const sh = f({
      id: 'f3',
      type: 'DPHSHV',
      xmlPath: 'org/o/filings/b1/DPHSHV.xml',
      state: 'draft',
    });
    const d = decideDownload(kh, [sh, kh, f()], 'h1', 'zip');
    expect(d.ok && d.paths.map((p) => p.name)).toEqual([
      'DPHDP3-2026-08-radne.xml',
      'DPHKH1-2026-08-radne.xml',
    ]);
  });
});

describe('decideMarkFiled', () => {
  it('valid body from generated; opravne supersedes the amended filing', () => {
    expect(
      decideMarkFiled(
        f(),
        { filedOn: '2026-09-20', submissionRef: ' 1234567/26 ' },
        '2026-09-21',
        null,
      ),
    ).toEqual({
      ok: true,
      filedOn: '2026-09-20',
      submissionRef: '1234567/26',
      supersedeFilingId: null,
    });
    expect(
      decideMarkFiled(
        f({ kind: 'opravne', state: 'downloaded' }),
        { filedOn: '2026-09-21' },
        '2026-09-21',
        'f0',
      ),
    ).toMatchObject({ ok: true, supersedeFilingId: 'f0' });
  });
  it('rejects future dates, dates before the period end, long refs, wrong states', () => {
    expect(decideMarkFiled(f(), { filedOn: '2026-09-22' }, '2026-09-21', null)).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(decideMarkFiled(f(), { filedOn: '2026-08-15' }, '2026-09-21', null)).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(
      decideMarkFiled(
        f(),
        { filedOn: '2026-09-20', submissionRef: 'x'.repeat(61) },
        '2026-09-21',
        null,
      ),
    ).toMatchObject({ ok: false, status: 400 });
    expect(
      decideMarkFiled(f({ state: 'draft' }), { filedOn: '2026-09-20' }, '2026-09-21', null),
    ).toMatchObject({ ok: false, status: 409, error: 'wrong_state' });
    expect(
      decideMarkFiled(f({ state: 'marked_filed' }), { filedOn: '2026-09-20' }, '2026-09-21', null),
    ).toMatchObject({ ok: false, status: 409 });
    expect(decideMarkFiled(null, {}, '2026-09-21', null)).toMatchObject({ ok: false, status: 404 });
  });
  it('xmlFileName', () =>
    expect(xmlFileName({ type: 'DPHKH1', periodStart: '2026-07-01', kind: 'nasledne' })).toBe(
      'DPHKH1-2026-07-nasledne.xml',
    ));
});
