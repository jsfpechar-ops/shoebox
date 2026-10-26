import { parseLegalDate } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import {
  checkInputFromFields,
  type ProtoCheckInput,
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
  it('passes, warns within 1.00, fails beyond', () => {
    expect(sev({}, 'totals_math')).toEqual(['proto.check.totals_math.pass:pass']);
    expect(sev({ totals: { net: '1100.00', vat: '222.00', gross: '1322.40' } }, 'totals_math')).toEqual([
      'proto.check.totals_math.warn:warn',
    ]);
    expect(sev({ totals: { net: '1100.00', vat: '222.00', gross: '1422.00' } }, 'totals_math')).toEqual([
      'proto.check.totals_math.fail:fail',
    ]);
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
    const r = sev({ totals: { net: '1100.00', vat: '2220.00', gross: '3320.00' } }, 'recap_vs_totals');
    expect(r).toEqual(['proto.check.recap_net.pass:pass', 'proto.check.recap_vat.fail:fail']);
  });
  it('warns on a one-haler difference', () => {
    const r = sev({ totals: { net: '1100.01', vat: '222.00', gross: '1322.01' } }, 'recap_vs_totals');
    expect(r[0]).toBe('proto.check.recap_net.warn:warn');
  });
  it('is skipped with an empty recap', () => {
    expect(sev({ vat_recap: [] }, 'recap_vs_totals')).toEqual([]);
  });
});

describe('qr_amount', () => {
  it('passes when equal and blocks when different', () => {
    expect(sev({ qr: { amount: '1322.00' } }, 'qr_amount')).toEqual(['proto.check.qr_amount.pass:pass']);
    expect(sev({ qr: { amount: '1232.00' } }, 'qr_amount')).toEqual(['proto.check.qr_amount.fail:fail']);
    const rows = validationRowsOf(runProtoChecks(input({ qr: { amount: '1232.00' } }), { today: TODAY }));
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
