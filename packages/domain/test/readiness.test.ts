import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import { EMPTY_ANSWERS, podkladyAnswersSchema } from '../src/income-tax/answers';
import {
  checkPodkladyReadiness,
  isBlocked,
  type ProfileSegment,
  type ReadinessInput,
  segmentsInYear,
} from '../src/income-tax/readiness';
import { CZK, Money } from '../src/money/index';

const d = parseLegalDate;
const seg = (o: Partial<ProfileSegment> = {}): ProfileSegment => ({
  validFrom: d('2025-01-01'),
  validTo: null,
  entityType: 'osvc',
  taxRegime: 'danova_evidence',
  vatStatus: 'neplatce',
  pausalRate: null,
  pausalDanBand: null,
  hasAccountant: false,
  ...o,
});
const base = (o: Partial<ReadinessInput> = {}): ReadinessInput => ({
  year: 2026,
  profiles: [seg()],
  ledger: { staleEntries: 0, documentsFinalizedAfterBuild: 0 },
  pendingDocuments: 0,
  unpaidIssued: 0,
  unexplainedTransactions: { count: 0, sum: Money.zero(CZK) },
  businessFlagUnknown: { count: 0, sum: Money.zero(CZK) },
  ...o,
});
const codes = (input: ReadinessInput, today = d('2027-02-15')) =>
  checkPodkladyReadiness(input, today).map((c) => c.code);

describe('checkPodkladyReadiness (M06 §4.1)', () => {
  it('clean closed year → no checks; open year → P_YEAR_OPEN info with the date', () => {
    expect(codes(base())).toEqual([]);
    const open = checkPodkladyReadiness(base(), d('2026-10-26'));
    expect(open).toEqual([
      { code: 'P_YEAR_OPEN', severity: 'info', params: { date: '2026-10-26' } },
    ]);
    expect(isBlocked(open)).toBe(false);
  });
  it('ucetnictvi or a non-OSVČ entity in the year blocks', () => {
    const r = checkPodkladyReadiness(
      base({ profiles: [seg({ taxRegime: 'ucetnictvi' })] }),
      d('2027-02-15'),
    );
    expect(r).toEqual([
      {
        code: 'P_REGIME_UNSUPPORTED',
        severity: 'blocking',
        params: { regime: 'ucetnictvi', entityType: 'osvc' },
      },
    ]);
    expect(isBlocked(r)).toBe(true);
    expect(codes(base({ profiles: [seg({ entityType: 'sro' })] }))).toEqual([
      'P_REGIME_UNSUPPORTED',
    ]);
  });
  it('a segment that ended before the year or starts after it is ignored', () => {
    const profiles = [
      seg({ validFrom: d('2024-01-01'), validTo: d('2025-12-31'), taxRegime: 'ucetnictvi' }),
      seg({ validFrom: d('2026-01-01') }),
      seg({ validFrom: d('2027-01-01'), taxRegime: 'ucetnictvi' }),
    ];
    expect(segmentsInYear(profiles, 2026).map((s) => s.validFrom)).toEqual(['2026-01-01']);
    expect(codes(base({ profiles }))).toEqual([]);
  });
  it('regime change inside the year → warning with both regimes in order', () => {
    const profiles = [
      seg({ validTo: d('2026-06-30') }),
      seg({ validFrom: d('2026-07-01'), taxRegime: 'pausalni_vydaje', pausalRate: 60 }),
    ];
    const r = checkPodkladyReadiness(base({ profiles }), d('2027-02-15'));
    expect(r).toEqual([
      {
        code: 'P_REGIME_CHANGED',
        severity: 'warning',
        params: { regimes: 'danova_evidence,pausalni_vydaje' },
      },
    ]);
  });
  it('every other code with its params, in table order', () => {
    const r = checkPodkladyReadiness(
      base({
        ledger: { staleEntries: 3, documentsFinalizedAfterBuild: 1 },
        pendingDocuments: 3,
        unpaidIssued: 2,
        unexplainedTransactions: { count: 2, sum: Money.parse('4500.50', CZK) },
        businessFlagUnknown: { count: 1, sum: Money.parse('249.00', CZK) },
      }),
      d('2026-10-26'),
    );
    expect(r.map((c) => c.code)).toEqual([
      'P_YEAR_OPEN',
      'P_LEDGER_STALE',
      'P_PENDING_DOCUMENTS',
      'P_UNPAID_ISSUED',
      'P_UNEXPLAINED_TX',
      'P_BUSINESS_FLAG_UNKNOWN',
    ]);
    expect(r[1]?.params).toEqual({ staleEntries: 3, documentsFinalizedAfterBuild: 1 });
    expect(r[4]).toEqual({
      code: 'P_UNEXPLAINED_TX',
      severity: 'warning',
      params: { count: 2, sum: '4500.50' },
    });
    expect(r[5]?.params).toEqual({ count: 1, sum: '249.00' });
    expect(r.every((c) => c.severity !== 'blocking')).toBe(true);
  });
});

describe('podkladyAnswersSchema (M06 §4.8, 05 §8 no RČ)', () => {
  it('empty object → defaults; EMPTY_ANSWERS equals them', () => {
    expect(podkladyAnswersSchema.parse({})).toEqual({
      otherIncome: 'unknown',
      otherIncomeApprox: null,
      employmentBeyondLimits: 'unknown',
      insolvencyOrPartner: 'unknown',
      comparisonRate: null,
      activityClass: null,
      includePartialXml: false,
    });
    expect(EMPTY_ANSWERS).toEqual(podkladyAnswersSchema.parse({}));
  });
  it('rejects rodneCislo and any unknown key; rejects a rate outside 80/60/40/30', () => {
    expect(podkladyAnswersSchema.safeParse({ rodneCislo: '7801011229' }).success).toBe(false);
    expect(podkladyAnswersSchema.safeParse({ rod_c: '7801011229' }).success).toBe(false);
    expect(podkladyAnswersSchema.safeParse({ comparisonRate: 50 }).success).toBe(false);
    expect(
      podkladyAnswersSchema.safeParse({
        otherIncome: 'yes',
        otherIncomeApprox: 60000,
        comparisonRate: 80,
      }).success,
    ).toBe(true);
  });
});
