// Shared values for `calendar.cz_public_holidays` and `deadlines.generators` (M09 §4.7), seeded by
// 2025.ts and 2026.ts. Verified 2026-10-25 against research/czech-tax-filings.md §3.3 [O].

import type { RuleSet } from '../keys';

/** Zákon č. 245/2000 Sb., o státních svátcích a ostatních svátcích. */
export const HOLIDAYS_ACT = 'https://www.zakonyprolidi.cz/cs/2000-245';
/** Zákon č. 280/2009 Sb., daňový řád, § 136 (DAP) and § 33 (a deadline on a non-working day moves on). */
export const TAX_PROCEDURE_ACT = 'https://www.zakonyprolidi.cz/cs/2009-280#p136';
export const DEADLINES_VERIFIED_AT = '2026-10-25';

/** 1. 1., 1. 5., 8. 5., 5. 7., 6. 7., 28. 9., 28. 10., 17. 11., 24.–26. 12. */
export const CZ_FIXED_HOLIDAYS: RuleSet['calendar.cz_public_holidays']['fixed'] = [
  '01-01',
  '05-01',
  '05-08',
  '07-05',
  '07-06',
  '09-28',
  '10-28',
  '11-17',
  '12-24',
  '12-25',
  '12-26',
];

/** Good Friday and Easter Monday. */
export const CZ_MOVABLE_HOLIDAYS: RuleSet['calendar.cz_public_holidays']['movable'] = {
  '2025': ['04-18', '04-21'],
  '2026': ['04-03', '04-06'],
  '2027': ['03-26', '03-29'],
  '2028': ['04-14', '04-17'],
  '2029': ['03-30', '04-02'],
  '2030': ['04-19', '04-22'],
};

const ZDPH = 'https://www.zakonyprolidi.cz/cs/2004-235';
const ZDP = 'https://www.zakonyprolidi.cz/cs/1992-586';

export const CZ_DEADLINE_GENERATORS: RuleSet['deadlines.generators'] = [
  // ZDPH § 101 odst. 1: the return within 25 days after the period; § 101e: the control statement too.
  {
    kind: 'vat_return',
    applies_if: { vat_status: ['platce'] },
    period: 'vat_period',
    due: { type: 'day_of_month_after_period', day: 25 },
    shift: 'next_working_day',
    amount: 'none',
    source: `${ZDPH}#p101`,
  },
  {
    kind: 'kh',
    applies_if: { vat_status: ['platce'] },
    period: 'vat_period',
    due: { type: 'day_of_month_after_period', day: 25 },
    shift: 'next_working_day',
    amount: 'none',
    source: `${ZDPH}#p101e`,
  },
  // ZDP § 38lk: the paušální daň advance by the 20th of the month it is for.
  {
    kind: 'pausalni_dan_advance',
    applies_if: { tax_regime: ['pausalni_dan'] },
    period: 'month',
    due: { type: 'day_of_month_in_period', day: 20 },
    shift: 'next_working_day',
    amount: 'pausalni_dan_band_monthly',
    source: `${ZDP}#p38lk`,
  },
  // Zákon č. 589/1992 Sb. § 14a: social advance by the end of the month it is for. TODO(verify) shift.
  {
    kind: 'social_advance',
    applies_if: {
      tax_regime: ['danova_evidence', 'pausalni_vydaje'],
      requires: ['insurance_self_paid'],
    },
    period: 'month',
    due: { type: 'day_of_month_in_period', day: 'last' },
    shift: 'previous_working_day',
    amount: 'insurance_min_social',
    source: 'https://www.zakonyprolidi.cz/cs/1992-589#p14a',
  },
  // Zákon č. 592/1992 Sb. § 7: health advance by the 8th of the next month. TODO(verify) shift.
  {
    kind: 'health_advance',
    applies_if: {
      tax_regime: ['danova_evidence', 'pausalni_vydaje'],
      requires: ['insurance_self_paid'],
    },
    period: 'month',
    due: { type: 'day_of_month_after_period', day: 8 },
    shift: 'previous_working_day',
    amount: 'insurance_min_health',
    source: 'https://www.zakonyprolidi.cz/cs/1992-592#p7',
  },
  // Daňový řád § 136 odst. 2: DAP filed electronically by 1 May (paper 1 April is info only).
  {
    kind: 'dap',
    applies_if: { tax_regime: ['danova_evidence', 'pausalni_vydaje'] },
    period: 'year',
    due: { type: 'fixed_date', month: 5, day: 1, year_offset: 1 },
    shift: 'next_working_day',
    amount: 'none',
    source: TAX_PROCEDURE_ACT,
  },
];
