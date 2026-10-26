import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import {
  buildSummary,
  monthLabel,
  periodLabel,
  SUMMARY_MAX_LENGTH,
  type SummaryInput,
} from '../src/taxonomy/summary';

const d = parseLegalDate;
const ASOF = d('2026-10-26');

function input(over: Partial<SummaryInput> = {}): SummaryInput {
  return {
    asOf: ASOF,
    subject: { user: null, llm: 'Apartment cleaning', vendorHint: null },
    dominant: {
      categoryCode: 'exp_cleaning',
      taxEffect: 'deductible_expense',
      deductibility: 'deductible',
      businessSharePct: '100',
      vatTreatment: 'rcv_domestic_no_vat',
      vatRatePct: null,
    },
    otherTaxEffects: [],
    servicePeriodFrom: d('2026-09-01'),
    servicePeriodTo: d('2026-09-30'),
    duzp: null,
    issueDate: d('2026-10-02'),
    recurringCategories: ['exp_cleaning', 'exp_property_management', 'exp_platform_commission'],
    vatStatus: 'identifikovana_osoba',
    deductionAllowed: false,
    vatPeriod: null,
    ...over,
  };
}

describe('buildSummary', () => {
  it('cleaning September (golden b)', () => {
    expect(buildSummary(input())).toBe(
      'Apartment cleaning for September – tax-deductible expense, no VAT',
    );
  });
  it('manager August: domestic VAT as cost for an identified person (golden a), month from DUZP', () => {
    const s = buildSummary(
      input({
        subject: { user: null, llm: 'Apartment management', vendorHint: null },
        dominant: {
          categoryCode: 'exp_property_management',
          taxEffect: 'deductible_expense',
          deductibility: 'deductible',
          businessSharePct: '100',
          vatTreatment: 'rcv_domestic_vat',
          vatRatePct: '21',
        },
        servicePeriodFrom: null,
        servicePeriodTo: null,
        duzp: d('2026-08-31'),
      }),
    );
    expect(s).toBe(
      'Apartment management for August – tax-deductible expense, VAT 21 % is part of the cost',
    );
  });
  it('Booking July: self-assessed VAT names the return period (golden c, policy issue_date)', () => {
    const s = buildSummary(
      input({
        subject: { user: null, llm: 'Booking.com commission', vendorHint: null },
        dominant: {
          categoryCode: 'exp_platform_commission',
          taxEffect: 'deductible_expense',
          deductibility: 'deductible',
          businessSharePct: '100',
          vatTreatment: 'rcv_eu_service_reverse_charge',
          vatRatePct: '21',
        },
        servicePeriodFrom: d('2026-07-01'),
        servicePeriodTo: d('2026-07-31'),
        issueDate: d('2026-08-03'),
        vatPeriod: { start: d('2026-08-01'), end: d('2026-08-31'), kind: 'month' },
      }),
    );
    expect(s).toBe(
      'Booking.com commission for July – tax-deductible expense, you pay VAT 21 % yourself in the return for August',
    );
  });
  it('Decathlon after the answer: private, no VAT sentence (golden h)', () => {
    const s = buildSummary(
      input({
        subject: { user: null, llm: 'Backpack', vendorHint: null },
        dominant: {
          categoryCode: 'private_expense',
          taxEffect: 'private',
          deductibility: 'not_applicable',
          businessSharePct: '0',
          vatTreatment: 'rcv_domestic_vat',
          vatRatePct: '21',
        },
        servicePeriodFrom: null,
        servicePeriodTo: null,
        recurringCategories: [],
      }),
    );
    expect(s).toBe('Backpack – personal expense, not counted for the business');
  });
  it('MacBook 80 %: partially deductible', () => {
    const s = buildSummary(
      input({
        subject: { user: null, llm: 'MacBook Air laptop', vendorHint: null },
        dominant: {
          categoryCode: 'exp_small_assets',
          taxEffect: 'deductible_expense',
          deductibility: 'partially_deductible',
          businessSharePct: '80',
          vatTreatment: 'rcv_domestic_vat',
          vatRatePct: '21',
        },
        servicePeriodFrom: null,
        servicePeriodTo: null,
        recurringCategories: [],
      }),
    );
    expect(s).toBe('MacBook Air laptop – 80 % tax-deductible, VAT 21 % is part of the cost');
  });
  it('payer with deduction, quarterly period label, year suffix when not the asOf year', () => {
    const s = buildSummary(
      input({
        vatStatus: 'platce',
        deductionAllowed: true,
        dominant: {
          categoryCode: 'exp_software_saas',
          taxEffect: 'deductible_expense',
          deductibility: 'deductible',
          businessSharePct: '100',
          vatTreatment: 'rcv_eu_service_reverse_charge',
          vatRatePct: '21',
        },
        subject: { user: 'AI tool subscription', llm: 'x', vendorHint: null },
        servicePeriodFrom: d('2025-11-01'),
        servicePeriodTo: d('2025-12-31'),
        vatPeriod: { start: d('2025-10-01'), end: d('2025-12-31'), kind: 'quarter' },
      }),
    );
    expect(s).toBe(
      'AI tool subscription for November–December 2025 – tax-deductible expense, you declare and deduct VAT 21 % in the return for Q4 2025',
    );
  });
  it('subject precedence: user > llm > vendor hint > category label', () => {
    expect(
      buildSummary(input({ subject: { user: null, llm: null, vendorHint: 'Weekly cleaning' } })),
    ).toMatch(/^Weekly cleaning for September/);
    expect(buildSummary(input({ subject: { user: null, llm: null, vendorHint: null } }))).toMatch(
      /^Cleaning/,
    );
  });
  it('appends the count of other tax effects and never exceeds 120 characters', () => {
    const s = buildSummary(input({ otherTaxEffects: ['private', 'deductible_expense', 'asset'] }));
    expect(s.endsWith(' (+ 2 more items)')).toBe(true);
    const long = buildSummary(
      input({ subject: { user: 'x'.repeat(200), llm: null, vendorHint: null } }),
    );
    expect(long.length).toBeLessThanOrEqual(SUMMARY_MAX_LENGTH);
    expect(long).toContain('…');
    expect(long).toContain('– tax-deductible expense, no VAT');
  });
  it('labels', () => {
    expect(monthLabel(d('2026-09-15'), ASOF)).toBe('September');
    expect(monthLabel(d('2025-09-15'), ASOF)).toBe('September 2025');
    expect(
      periodLabel({ start: d('2026-07-01'), end: d('2026-09-30'), kind: 'quarter' }, ASOF),
    ).toBe('Q3 2026');
  });
});
