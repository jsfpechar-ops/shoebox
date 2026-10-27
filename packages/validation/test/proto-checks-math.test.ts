import { parseLegalDate } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import {
  checkInputFromFields,
  type ProtoCheckInput,
  roundingOf,
  runProtoChecks,
  validationRowsOf,
} from '../src/index';

// Synthetic values only (hard rule 4).
const TODAY = parseLegalDate('2026-10-19');

function input(over: Partial<ProtoCheckInput> = {}): ProtoCheckInput {
  return {
    document_class: 'received_invoice',
    supplier: { ico: '25596641', dic: 'CZ25596641', country: 'CZ' },
    dates: { issue_date: '2026-09-12', duzp: '2026-09-12', due_date: '2026-09-26' },
    currency: 'CZK',
    totals: { net: '1100.00', vat: '222.00', gross: '1322.00' },
    vat_recap: [
      { rate_pct: '21', base: '1000.00', vat: '210.00' },
      { rate_pct: '12', base: '100.00', vat: '12.00' },
    ],
    issues: [],
    ...over,
  };
}

function sev(over: Partial<ProtoCheckInput>, id: string): string[] {
  return runProtoChecks(input(over), { today: TODAY })
    .filter((r) => r.id === id)
    .map((r) => `${r.key}:${r.severity}`);
}

describe('totals_math', () => {
  it('passes, notes rounding within 1.00, fails beyond', () => {
    expect(sev({}, 'totals_math')).toEqual(['proto.check.totals_math.pass:pass']);
    expect(
      sev({ totals: { net: '1100.00', vat: '222.00', gross: '1322.40' } }, 'totals_math'),
    ).toEqual(['proto.check.totals_math.rounded:info']);
    expect(
      sev({ totals: { net: '1100.00', vat: '222.00', gross: '1422.00' } }, 'totals_math'),
    ).toEqual(['proto.check.totals_math.fail:fail']);
  });
  it('LAMOVA: rounding of -0.40 is one quiet info line, no warning, no field marks', () => {
    const results = runProtoChecks(
      input({
        totals: { net: '13654.88', vat: '2867.52', gross: '16522.00' },
        vat_recap: [{ rate_pct: '21', base: '13654.88', vat: '2867.52' }],
      }),
      { today: TODAY },
    );
    const notes = results.filter((r) => r.severity === 'info');
    expect(notes.map((r) => `${r.key}`)).toEqual(['proto.check.totals_math.rounded']);
    expect(notes[0]?.params).toMatchObject({ diff: '-0.40' });
    expect(results.some((r) => r.severity === 'warn' || r.severity === 'fail')).toBe(false);
    const rows = validationRowsOf(results);
    expect(rows.map((r) => r.severity)).toEqual(['info']);
  });
  it('a 1.01 difference still fails', () => {
    expect(
      sev({ totals: { net: '1100.00', vat: '222.00', gross: '1323.01' } }, 'totals_math'),
    ).toEqual(['proto.check.totals_math.fail:fail']);
  });
  it('roundingOf gives gross - (net + vat) within 1.00, else 0.00', () => {
    expect(roundingOf({ net: '13654.88', vat: '2867.52', gross: '16522.00' }, 'CZK')).toBe('-0.40');
    expect(roundingOf({ net: '1100.00', vat: '222.00', gross: '1322.00' }, 'CZK')).toBe('0.00');
    expect(roundingOf({ net: '1100.00', vat: '222.00', gross: '1323.01' }, 'CZK')).toBe('0.00');
    expect(roundingOf({ net: null, vat: '222.00', gross: '1322.00' }, 'CZK')).toBe('0.00');
  });
  it('is skipped when net is missing', () => {
    expect(sev({ totals: { vat: '222.00', gross: '1322.00' } }, 'totals_math')).toEqual([]);
  });
});

describe('recap_vs_totals', () => {
  it('passes when bases and VAT add up', () => {
    expect(sev({}, 'recap_vs_totals')).toEqual([
      'proto.check.recap_net.pass:pass',
      'proto.check.recap_vat.pass:pass',
    ]);
  });
  it('fails a swapped base and VAT (decimal shift)', () => {
    const r = sev(
      { totals: { net: '1100.00', vat: '2220.00', gross: '3320.00' } },
      'recap_vs_totals',
    );
    expect(r).toEqual(['proto.check.recap_net.pass:pass', 'proto.check.recap_vat.fail:fail']);
  });
  it('notes a one-haler difference quietly', () => {
    const r = sev(
      { totals: { net: '1100.01', vat: '222.00', gross: '1322.01' } },
      'recap_vs_totals',
    );
    expect(r[0]).toBe('proto.check.recap_net.rounded:info');
  });
  it('is skipped with an empty recap', () => {
    expect(sev({ vat_recap: [] }, 'recap_vs_totals')).toEqual([]);
  });
});

describe('qr_amount', () => {
  it('passes when equal and blocks when different', () => {
    expect(sev({ qr: { amount: '1322.00' } }, 'qr_amount')).toEqual([
      'proto.check.qr_amount.pass:pass',
    ]);
    expect(sev({ qr: { amount: '1232.00' } }, 'qr_amount')).toEqual([
      'proto.check.qr_amount.fail:fail',
    ]);
    const rows = validationRowsOf(
      runProtoChecks(input({ qr: { amount: '1232.00' } }), { today: TODAY }),
    );
    expect(rows.find((x) => x.ruleId === 'PROTO_QR_AMOUNT')?.severity).toBe('blocking');
  });
  it('is skipped without a QR amount', () => {
    expect(sev({}, 'qr_amount')).toEqual([]);
    expect(sev({ qr: { amount: null } }, 'qr_amount')).toEqual([]);
  });
});

describe('checkInputFromFields', () => {
  it('reads totals.net and qr.amount', () => {
    const x = checkInputFromFields({ 'totals.net': '10.00', 'qr.amount': '12.10' });
    expect(x.totals.net).toBe('10.00');
    expect(x.qr).toEqual({ amount: '12.10' });
    expect(checkInputFromFields({}).qr).toBeUndefined();
  });
});
