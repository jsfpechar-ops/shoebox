import { parseLegalDate } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import {
  type ProtoCheckInput,
  type ProtoCheckResult,
  parseProtoOrg,
  renderProtoChecks,
  runProtoChecks,
} from '../src/index';

// Synthetic values only (hard rule 4). 25596641 and 00006947 are valid IČO checksums.
const TODAY = parseLegalDate('2026-10-19');
const ORG: { readonly ico: string | null; readonly dic: string | null } = {
  ico: '00006947',
  dic: 'CZ00006947',
};
const NEW_IDS = ['vat_rate_missing', 'vat_payer', 'paid', 'buyer'];

function input(overrides: Partial<ProtoCheckInput> = {}): ProtoCheckInput {
  return {
    document_class: 'received_invoice',
    supplier: { ico: '25596641', dic: 'CZ25596641', country: 'CZ' },
    buyer: { ico: '00006947', dic: 'CZ00006947' },
    dates: { issue_date: '2026-09-12', duzp: '2026-09-12', due_date: '2026-09-26' },
    currency: 'CZK',
    totals: { gross: '1210.00', vat: '210.00' },
    vat_recap: [{ rate_pct: '21', base: '1000.00', vat: '210.00' }],
    payment: { method: 'bank_transfer' },
    flags: { non_vat_payer_text: false, reverse_charge_text: false, paid_text: false },
    issues: [],
    ...overrides,
  };
}

function only(
  results: readonly ProtoCheckResult[],
  id: ProtoCheckResult['id'],
): { severity: string; key: string; params: unknown }[] {
  return results
    .filter((result) => result.id === id)
    .map((result) => ({ severity: result.severity, key: result.key, params: result.params }));
}

function run(overrides: Partial<ProtoCheckInput> = {}, org = ORG): ProtoCheckResult[] {
  return runProtoChecks(input(overrides), { today: TODAY, org });
}

describe('backward compatibility', () => {
  it('an old-shaped input without the v3 fields gets none of the new checks', () => {
    const legacy: ProtoCheckInput = {
      supplier: { ico: '25596641', dic: null },
      dates: { issue_date: '2026-09-12', duzp: null, due_date: null },
      currency: 'CZK',
      totals: { gross: '1210.00' },
      vat_recap: [{ rate_pct: '21', base: '1000.00', vat: '210.00' }],
    };
    const results = runProtoChecks(legacy, { today: TODAY });
    expect(results.filter((result) => NEW_IDS.includes(result.id))).toEqual([]);
  });

  it('a clean domestic invoice to my firm adds only passes, after the old checks', () => {
    const ids = run().map((result) => [result.id, result.severity]);
    expect(ids.slice(-2)).toEqual([
      ['vat_payer', 'pass'],
      ['buyer', 'pass'],
    ]);
    expect(ids.filter(([, severity]) => severity !== 'pass')).toEqual([]);
  });
});

describe('vat_rate_missing', () => {
  it('never guesses a rate: VAT without a recap is a warning', () => {
    expect(only(run({ vat_recap: [] }), 'vat_rate_missing')).toEqual([
      { severity: 'warn', key: 'proto.check.vat_rate_missing.no_recap', params: { vat: '210.00' } },
    ]);
  });

  it('fails once per recap row that could not be read (1-based, sorted)', () => {
    const results = run({ issues: ['vat_recap[2].vat', 'vat_recap[2]', 'vat_recap[0]'] });
    expect(only(results, 'vat_rate_missing')).toEqual([
      { severity: 'fail', key: 'proto.check.vat_rate_missing.unreadable_row', params: { row: 1 } },
      { severity: 'fail', key: 'proto.check.vat_rate_missing.unreadable_row', params: { row: 3 } },
    ]);
  });

  it('is silent for a full recap, zero VAT, spam and unreadable documents', () => {
    expect(only(run(), 'vat_rate_missing')).toEqual([]);
    const zero = run({ vat_recap: [], totals: { gross: '1000.00', vat: '0.00' } });
    expect(only(zero, 'vat_rate_missing')).toEqual([]);
    expect(
      only(run({ vat_recap: [], document_class: 'non_document' }), 'vat_rate_missing'),
    ).toEqual([]);
    expect(only(run({ vat_recap: [], document_class: 'unreadable' }), 'vat_rate_missing')).toEqual(
      [],
    );
  });
});

describe('vat_payer', () => {
  it('passes when VAT is charged and the DIČ is printed', () => {
    expect(only(run(), 'vat_payer')).toEqual([
      {
        severity: 'pass',
        key: 'proto.check.vat_payer.pass',
        params: { vat: '210.00', dic: 'CZ25596641' },
      },
    ]);
  });

  it('warns when VAT is charged without a supplier DIČ (also from totals when no recap)', () => {
    const supplier = { ico: '25596641', dic: null, country: 'CZ' };
    const expected = [
      { severity: 'warn', key: 'proto.check.vat_payer.no_dic', params: { vat: '210.00' } },
    ];
    expect(only(run({ supplier }), 'vat_payer')).toEqual(expected);
    expect(only(run({ supplier, vat_recap: [] }), 'vat_payer')).toEqual(expected);
  });

  it('fails when a self-declared non-payer charges VAT', () => {
    const flags = { non_vat_payer_text: true, reverse_charge_text: false, paid_text: false };
    expect(only(run({ flags }), 'vat_payer')).toEqual([
      { severity: 'fail', key: 'proto.check.vat_payer.non_payer', params: { vat: '210.00' } },
    ]);
  });

  it('skips foreign suppliers, reverse charge, zero VAT and spam', () => {
    const foreign = { ico: null, dic: null, country: 'DE' };
    expect(only(run({ supplier: foreign }), 'vat_payer')).toEqual([]);
    const reverse = { non_vat_payer_text: false, reverse_charge_text: true, paid_text: false };
    expect(only(run({ flags: reverse }), 'vat_payer')).toEqual([]);
    const zero = run({
      totals: { gross: '1000.00', vat: '0.00' },
      vat_recap: [{ rate_pct: '0', base: '1000.00', vat: '0.00' }],
    });
    expect(only(zero, 'vat_payer')).toEqual([]);
    expect(only(run({ document_class: 'non_document' }), 'vat_payer')).toEqual([]);
  });
});

describe('paid', () => {
  it('marks card, cash and a printed paid stamp as paid; card wins over the stamp', () => {
    expect(only(run({ payment: { method: 'card' } }), 'paid')).toEqual([
      { severity: 'pass', key: 'proto.check.paid.card', params: {} },
    ]);
    expect(only(run({ payment: { method: 'cash' } }), 'paid')).toEqual([
      { severity: 'pass', key: 'proto.check.paid.cash', params: {} },
    ]);
    const stamp = { non_vat_payer_text: false, reverse_charge_text: false, paid_text: true };
    expect(only(run({ flags: stamp }), 'paid')).toEqual([
      { severity: 'pass', key: 'proto.check.paid.stamp', params: {} },
    ]);
    expect(only(run({ flags: stamp, payment: { method: 'card' } }), 'paid')).toHaveLength(1);
  });

  it('says nothing for a bank transfer, a missing method or spam', () => {
    expect(only(run(), 'paid')).toEqual([]);
    expect(only(run({ payment: { method: null } }), 'paid')).toEqual([]);
    expect(
      only(run({ payment: { method: 'card' }, document_class: 'non_document' }), 'paid'),
    ).toEqual([]);
  });
});

describe('buyer', () => {
  it('needs the firm: no org, no buyer check', () => {
    expect(only(runProtoChecks(input(), { today: TODAY }), 'buyer')).toEqual([]);
  });

  it('passes for my IČO, fails for another firm, compares DIČ when IČO is missing', () => {
    expect(only(run(), 'buyer')).toEqual([
      { severity: 'pass', key: 'proto.check.buyer.pass', params: { id: '00006947' } },
    ]);
    expect(only(run({ buyer: { ico: '25596641', dic: null } }), 'buyer')).toEqual([
      { severity: 'fail', key: 'proto.check.buyer.other_firm', params: { id: '25596641' } },
    ]);
    expect(only(run({ buyer: { ico: null, dic: 'CZ12345678' } }), 'buyer')).toEqual([
      { severity: 'fail', key: 'proto.check.buyer.other_firm', params: { id: 'CZ12345678' } },
    ]);
    expect(only(run({ buyer: { ico: null, dic: 'CZ00006947' } }), 'buyer')).toEqual([
      { severity: 'pass', key: 'proto.check.buyer.pass', params: { id: 'CZ00006947' } },
    ]);
  });

  it('fails when the supplier is my own firm', () => {
    const supplier = { ico: '00006947', dic: 'CZ00006947', country: 'CZ' };
    expect(only(run({ supplier, buyer: { ico: '25596641', dic: null } }), 'buyer')).toEqual([
      { severity: 'fail', key: 'proto.check.buyer.supplier_is_me', params: { id: '00006947' } },
    ]);
  });

  it('warns on an invoice without a buyer, but not on a receipt or spam', () => {
    const none = { ico: null, dic: null };
    expect(only(run({ buyer: none }), 'buyer')).toEqual([
      { severity: 'warn', key: 'proto.check.buyer.missing', params: {} },
    ]);
    expect(only(run({ buyer: none, document_class: 'received_receipt' }), 'buyer')).toEqual([]);
    expect(only(run({ buyer: none, document_class: 'non_document' }), 'buyer')).toEqual([]);
  });

  it('an org with only an IČO compares IČO only (M03 §8)', () => {
    const icoOnly = { ico: '00006947', dic: null };
    expect(only(run({ buyer: { ico: null, dic: 'CZ12345678' } }, icoOnly), 'buyer')).toEqual([]);
  });
});

describe('parseProtoOrg', () => {
  it('normalizes the environment values and returns undefined when both are empty', () => {
    expect(parseProtoOrg(' 000 069 47 ', ' cz00006947 ')).toEqual({
      ico: '00006947',
      dic: 'CZ00006947',
    });
    expect(parseProtoOrg(undefined, 'CZ00006947')).toEqual({ ico: null, dic: 'CZ00006947' });
    expect(parseProtoOrg('', undefined)).toBeUndefined();
    expect(parseProtoOrg(undefined, '  ')).toBeUndefined();
  });
});

describe('messages', () => {
  it('renders the new checks in Czech and English', () => {
    const other = run({ buyer: { ico: '25596641', dic: null } });
    const cs = renderProtoChecks(other).find((check) => check.id === 'buyer');
    expect(cs?.message).toContain('25596641');
    const noRecap = run({ vat_recap: [] });
    const en = renderProtoChecks(noRecap, 'en').find((check) => check.id === 'vat_rate_missing');
    expect(en?.message).toContain('210.00');
  });
});
