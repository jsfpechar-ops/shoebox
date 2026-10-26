import { describe, expect, it, vi } from 'vitest';
import {
  createDriftMonitorsHandler,
  detectDrift,
  memoryDriftState,
  parseEpoVersions,
  sha256Hex,
} from '../src/jobs/ops/drift-monitors';

const ctx = { jobId: 'j', attempt: 1, signal: new AbortController().signal };
const LIST = `<table><tr><td><a href="detail?zkratka=DPHDP3">DPHDP3</a></td><td>Přiznání k DPH</td><td>03.01.05</td><td>11.08.2026</td></tr>
<tr><td>DPHKH1</td><td>Kontrolní hlášení</td><td>03.01.15</td></tr><tr><td>DPHSHV</td><td>Souhrnné hlášení</td><td>02.01.05</td></tr></table>`;
const EXPECTED = { DPHDP3: '03.01.04', DPHKH1: '03.01.15', DPHSHV: '02.01.05' };
const XSD_OLD = '<xs:schema old/>';

describe('parseEpoVersions / detectDrift', () => {
  it('reads the three versions from a recorded-style list page', () => {
    expect(parseEpoVersions(LIST)).toEqual({
      DPHDP3: '03.01.05',
      DPHKH1: '03.01.15',
      DPHSHV: '02.01.05',
    });
    expect(parseEpoVersions('<html>nothing</html>')).toEqual({});
  });
  it('reports a version bump and an XSD hash change, and fetch failures separately', () => {
    const findings = detectDrift({
      expectedVersions: EXPECTED,
      listHtml: LIST,
      manifests: {
        DPHDP3: { version: '03.01.04', sha256: sha256Hex(XSD_OLD), source_url: 'u1' },
        DPHKH1: { version: '03.01.15', sha256: null, source_url: 'u2' },
        DPHSHV: { version: '02.01.05', sha256: sha256Hex(XSD_OLD), source_url: 'u3' },
      },
      xsdBodies: { DPHDP3: '<xs:schema new/>', DPHSHV: null },
    });
    expect(findings.map((f) => [f.kind, f.form, f.expected, f.observed])).toEqual([
      ['version', 'DPHDP3', '03.01.04', '03.01.05'],
      ['xsd', 'DPHDP3', sha256Hex(XSD_OLD), sha256Hex('<xs:schema new/>')],
      ['fetch_failed', 'DPHSHV', sha256Hex(XSD_OLD), null],
    ]);
    expect(
      detectDrift({ expectedVersions: EXPECTED, listHtml: null, manifests: {}, xsdBodies: {} }),
    ).toEqual([
      { kind: 'fetch_failed', form: 'DPHDP3', expected: null, observed: null, key: 'fetch:list' },
    ]);
  });
});

describe('ops.drift_monitors handler', () => {
  it('alerts each change once across runs; fetch failures retry', async () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const state = memoryDriftState();
    const fetchText = vi.fn(async (url: string) =>
      url.includes('popis_struktury_seznam') ? LIST : null,
    );
    const handler = createDriftMonitorsHandler({ fetchText, logger, state });
    await handler({}, ctx);
    const warned = () =>
      logger.warn.mock.calls.map(
        (c) =>
          (c[0] as { kind: string; form: string }).kind + ':' + (c[0] as { form: string }).form,
      );
    expect(warned()).toContain('version:DPHDP3');
    const first = logger.warn.mock.calls.length;
    await handler({}, ctx);
    // the version alert is not repeated; fetch_failed (if any manifest has a sha256) is
    expect(
      warned()
        .slice(first)
        .filter((w) => w.startsWith('version:')),
    ).toEqual([]);
    expect(logger.info).toHaveBeenLastCalledWith(
      expect.objectContaining({ findings: expect.any(Number) }),
      'ops.drift_monitors done',
    );
  });
});
