import { CZK, Money } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import { payToIban } from '../src/pay/account';
import { type PrePaymentInput, prePaymentChecks, toRegistryLookup } from '../src/pay/checks';

const czk = (s: string) => Money.parse(s, CZK);
const FIO = 'CZ8720100000002400123455';
const CS = 'CZ4608000010031234567899';
const codes = (r: ReturnType<typeof prePaymentChecks>) =>
  r.checks.map((c) => `${c.code}:${c.severity}`);

function input(over: Partial<PrePaymentInput> = {}): PrePaymentInput {
  return {
    paidAt: null,
    openAmount: czk('1210.00'),
    totalGross: czk('1210.00'),
    payTo: { account: '2400123455', bank_code: '2010', iban: null, bic: null },
    orgVatStatus: 'platce',
    registry: {
      status: 'ok',
      fetchedAt: '2026-03-01T10:42:00Z',
      subject: { unreliable: false, vatPayer: true, publishedIbans: [FIO] },
    },
    earlierIbans: [],
    thresholdCzk: 270_000,
    toleranceCzk: '1.00',
    ...over,
  };
}

describe('payToIban', () => {
  it('prefers a valid printed IBAN, else builds one, else invalid or none', () => {
    expect(payToIban({ iban: 'cz87 2010 0000 0024 0012 3455' })).toEqual({
      kind: 'ok',
      iban: FIO,
      bankCode: '2010',
    });
    expect(payToIban({ account: '1003-1234567899', bank_code: '0800' })).toEqual({
      kind: 'ok',
      iban: CS,
      bankCode: '0800',
    });
    expect(payToIban({ account: '705-1234567890', bank_code: '0710' })).toEqual({
      kind: 'invalid',
    });
    expect(payToIban({ iban: 'CZ0000000000000000000000' })).toEqual({ kind: 'invalid' });
    expect(payToIban(null)).toEqual({ kind: 'none' });
    expect(payToIban({ account: '', bank_code: null })).toEqual({ kind: 'none' });
  });
});

describe('prePaymentChecks (A15)', () => {
  it('all good: one ok row, QR allowed, BIC from the table', () => {
    const r = prePaymentChecks(input());
    expect(codes(r)).toEqual(['REGISTRY_OK:ok']);
    expect(r).toMatchObject({ blocking: false, iban: FIO, bic: 'FIOBCZPP', qrAllowed: true });
  });
  it('unreliable payer: blocking for platce, warning for neplatce', () => {
    const reg = {
      status: 'ok' as const,
      fetchedAt: 'x',
      subject: { unreliable: true, vatPayer: true, publishedIbans: [FIO] },
    };
    const a = prePaymentChecks(input({ registry: reg }));
    expect(codes(a)).toEqual(['UNRELIABLE_PAYER:blocking']);
    expect(a.qrAllowed).toBe(false);
    const b = prePaymentChecks(input({ registry: reg, orgVatStatus: 'neplatce' }));
    expect(codes(b)).toEqual(['UNRELIABLE_PAYER:warning']);
    expect(b.qrAllowed).toBe(true);
  });
  it('unpublished account: blocking above the §109 threshold, warning below', () => {
    const reg = {
      status: 'ok' as const,
      fetchedAt: 'x',
      subject: { unreliable: false, vatPayer: true, publishedIbans: [CS] },
    };
    expect(
      codes(
        prePaymentChecks(
          input({ registry: reg, totalGross: czk('300000.00'), openAmount: czk('300000.00') }),
        ),
      ),
    ).toEqual(['ACCOUNT_NOT_PUBLISHED:blocking']);
    expect(codes(prePaymentChecks(input({ registry: reg })))).toEqual([
      'ACCOUNT_NOT_PUBLISHED:warning',
    ]);
    expect(codes(prePaymentChecks(input({ registry: reg, orgVatStatus: 'neplatce' })))).toEqual([]);
  });
  it('registry outage is a warning only', () => {
    const r = prePaymentChecks(input({ registry: { status: 'unavailable' } }));
    expect(codes(r)).toEqual(['REGISTRY_UNAVAILABLE:warning']);
    expect(r.qrAllowed).toBe(true);
  });
  it('paid or nothing open blocks', () => {
    expect(codes(prePaymentChecks(input({ paidAt: '2026-03-02' })))).toEqual([
      'ALREADY_PAID:blocking',
      'REGISTRY_OK:ok',
    ]);
    expect(codes(prePaymentChecks(input({ openAmount: czk('0.50') })))).toEqual([
      'ALREADY_PAID:blocking',
      'REGISTRY_OK:ok',
    ]);
  });
  it('no account or an invalid one blocks', () => {
    expect(codes(prePaymentChecks(input({ payTo: null })))).toEqual(['NO_ACCOUNT:blocking']);
    const r = prePaymentChecks(input({ payTo: { account: '705-1234567890', bank_code: '0710' } }));
    expect(codes(r)).toEqual(['ACCOUNT_INVALID:blocking']);
    expect(r.iban).toBeNull();
  });
  it('foreign currency: info, no QR, not blocking', () => {
    const r = prePaymentChecks(
      input({ openAmount: Money.parse('10.00', 'EUR'), totalGross: Money.parse('10.00', 'EUR') }),
    );
    expect(codes(r)).toEqual(['FOREIGN_CURRENCY:info', 'REGISTRY_OK:ok']);
    expect(r).toMatchObject({ blocking: false, qrAllowed: false });
  });
  it('account differs from earlier payments to this partner', () => {
    expect(codes(prePaymentChecks(input({ earlierIbans: [CS] })))).toEqual([
      'REGISTRY_OK:ok',
      'ACCOUNT_CHANGED:warning',
    ]);
    expect(codes(prePaymentChecks(input({ earlierIbans: [CS, FIO] })))).toEqual(['REGISTRY_OK:ok']);
  });
});

describe('toRegistryLookup', () => {
  it('maps a CRPDPH subject, active accounts only', () => {
    const r = toRegistryLookup(
      {
        nespolehlivyPlatce: 'NE',
        typSubjektu: 'PLATCE_DPH',
        zverejneneUcty: [
          {
            datumZverejneniUkonceni: null,
            ucet: { kind: 'standard', predcisli: null, cislo: '2400123455', kodBanky: '2010' },
          },
          {
            datumZverejneniUkonceni: '2025-01-01',
            ucet: { kind: 'standard', predcisli: '1003', cislo: '1234567899', kodBanky: '0800' },
          },
          {
            datumZverejneniUkonceni: null,
            ucet: { kind: 'nonstandard', cislo: 'de89 3704 0044 0532 0130 00' },
          },
        ],
      },
      '2026-03-01T10:42:00Z',
    );
    expect(r).toEqual({
      status: 'ok',
      fetchedAt: '2026-03-01T10:42:00Z',
      subject: {
        unreliable: false,
        vatPayer: true,
        publishedIbans: [FIO, 'DE89370400440532013000'],
      },
    });
    expect(toRegistryLookup(undefined, 'x')).toEqual({
      status: 'ok',
      fetchedAt: 'x',
      subject: null,
    });
  });
});
