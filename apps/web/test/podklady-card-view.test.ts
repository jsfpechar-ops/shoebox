import { describe, expect, it } from 'vitest';
import { podkladyCardModel, reserveText } from '../src/podklady/card-view';
import type { PodkladyFilingView, PodkladyPreviewView, TaxReserveView } from '../src/podklady/view';

function filing(state: string): PodkladyFilingView {
  return {
    id: 'f-1',
    state,
    generatedAt: null,
    markedFiledAt: null,
    pdf: true,
    xlsx: true,
    ledgerHash: null,
    answersVersion: 1,
  };
}

function preview(over: Partial<PodkladyPreviewView> = {}): PodkladyPreviewView {
  return {
    year: 2025,
    empty: false,
    blocked: false,
    watermark: false,
    summary: { generatedOn: '2026-03-02' },
    readiness: [],
    latestFiling: null,
    changedSinceGeneration: false,
    changedSinceHandoff: false,
    diff: [],
    canGenerate: true,
    canDownload: false,
    partialXmlEligible: false,
    downloadUrls: { pdf: null, xlsx: null },
    ...over,
  };
}

describe('podkladyCardModel', () => {
  it('puts blocking warnings first and drops unknown codes', () => {
    const model = podkladyCardModel(
      preview({
        readiness: [
          { code: 'P_YEAR_OPEN', severity: 'info', params: { date: '2026-03-02' } },
          { code: 'P_NOT_A_CODE', severity: 'blocking', params: {} },
          { code: 'P_UNEXPLAINED_TX', severity: 'blocking', params: { count: 2, sum: '1 000' } },
        ],
      }),
    );
    expect(model.warnings).toHaveLength(2);
    expect(model.warnings[0]).toContain('without a document');
    expect(model.warnings[1]).toContain('not over');
  });

  it('allows prepare when there is no filing, and after a change', () => {
    expect(podkladyCardModel(preview()).canPrepare).toBe(true);
    expect(
      podkladyCardModel(
        preview({ latestFiling: filing('generated'), changedSinceGeneration: true }),
      ).canPrepare,
    ).toBe(true);
    expect(
      podkladyCardModel(
        preview({ latestFiling: filing('generated'), changedSinceGeneration: false }),
      ).canPrepare,
    ).toBe(false);
  });

  it('offers mark-filed only for generated or downloaded filings', () => {
    expect(podkladyCardModel(preview({ latestFiling: filing('generated') })).markFiledId).toBe(
      'f-1',
    );
    expect(podkladyCardModel(preview({ latestFiling: filing('downloaded') })).markFiledId).toBe(
      'f-1',
    );
    expect(
      podkladyCardModel(preview({ latestFiling: filing('marked_filed') })).markFiledId,
    ).toBeNull();
  });

  it('shows both amounts in the changed text', () => {
    const model = podkladyCardModel(
      preview({
        changedSinceHandoff: true,
        diff: [{ field: 'income', before: '100000.00', after: '120000.00' }],
      }),
    );
    expect(model.changed).toMatch(/100\s?000/);
    expect(model.changed).toMatch(/120\s?000/);
  });
});

describe('reserveText', () => {
  function reserve(over: Partial<TaxReserveView>): TaxReserveView {
    return {
      kind: 'none',
      asOf: null,
      computedAt: null,
      display: null,
      paid: null,
      due: null,
      labelKey: 'reserve.label',
      badgeKey: 'reserve.badge',
      howKey: 'reserve.how',
      payload: null,
      ...over,
    };
  }

  it('returns null for kind none', () => {
    expect(reserveText(reserve({ kind: 'none' }))).toBeNull();
  });

  it('formats an estimate', () => {
    const text = reserveText(reserve({ kind: 'estimate', display: '151600.00' }));
    expect(text?.main).toMatch(/151\s?600/);
    expect(text?.badge).toBe('estimate');
  });

  it('formats the flat-rate advances', () => {
    const text = reserveText(reserve({ kind: 'pausalni_dan', paid: '12000.00', due: '24000.00' }));
    expect(text?.main).toMatch(/12\s?000/);
    expect(text?.main).toMatch(/24\s?000/);
  });
});
