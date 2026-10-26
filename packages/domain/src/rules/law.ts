// One zod schema per law key (06 §2.1). This file holds shapes only; the values (the numbers in
// the law) are seeded by P0-DOM-05 under `packages/domain/src/rules/cz/`. A key whose shape is
// defined by a module spec that is not implemented yet is marked "module-owned" and kept loose;
// the module's ticket tightens it in the same PR that reads it.
import { z } from 'zod';
import {
  CountryCode,
  CzkWhole,
  DayOfMonth,
  Digits,
  Identifier,
  ModuleOwnedRecord,
  MonthDay,
  NonNegInt,
  Pct,
  PositiveInt,
  YearKey,
} from './atoms';

const PausalniDanCeiling = z.strictObject({
  max_income: CzkWhole,
  requires_dominant_rate_in: z.array(Pct).min(1).optional(),
});

const PausalniDanBand = z.strictObject({
  band: z.number().int().min(1).max(3),
  monthly: CzkWhole,
  ceilings: z.array(PausalniDanCeiling).min(1),
});

/** `cash.payment_limit`: one segment per currency regime (CZK until 2027-07-09, EUR after); the window is the envelope's. */
const CashPaymentLimit = z.strictObject({
  amount: z.number().int().min(0),
  currency: z.enum(['CZK', 'EUR']),
});

// The strict row shape (rate, statuses, deduction_row, confirmed) is `Dphdp3RowSchema` in cz/epo.ts;
// `attrs` is optional here because rows whose XML attribute names are unverified carry none yet.
const Dphdp3Row = z.looseObject({
  row: z.string().min(1),
  attrs: z.array(z.string().min(1)).min(1).optional(),
  treatment: Identifier,
  side: z.enum(['input', 'output']),
});

const FuPaymentAccount = z.strictObject({
  prefix: Digits,
  number: Digits,
  bank_code: z.string().regex(/^\d{4}$/),
});

export const LAW_RULE_SCHEMAS = {
  'vat.rates': z.strictObject({ standard: Pct, reduced: Pct }),
  'vat.registration_thresholds': z.strictObject({ calendar_year: CzkWhole, immediate: CzkWhole }),
  'vat.registration_turnover_policy': z.strictObject({
    exclude_treatments: z.array(Identifier),
    always_include_categories: z.array(Identifier),
  }),
  'vat.kh_document_limit': CzkWhole,
  'vat.simplified_document_limit': CzkWhole,
  'vat.io_eu_goods_threshold': CzkWhole,
  'vat.deduction_deferral_years': NonNegInt,
  'vat.ruceni_cash_threshold': CzkWhole,
  'vat.cnb_rate_rule': z.enum(['rate_valid_on_date_else_last_published']),
  'vat.deadline_day': DayOfMonth,
  // module-owned: M05 §4.3 defines the policy fields; `version` is the only required one.
  'vat.simple_period_policy': z.looseObject({ version: z.string().min(1) }),
  'vat.return_rounding': z.enum(['sum_entries_then_round', 'round_base_then_multiply']),
  'vat.shv_rounding': z.enum(['ceil', 'round', 'floor']),
  'vat.amendment_windows': z.strictObject({
    dp3_dodatecne_due: z.enum(['end_of_month_after_discovery']),
    kh_nasledne_working_days: PositiveInt,
  }),
  'vat.eu_member_states': z.array(CountryCode).min(1),
  'vat.out_of_scope_categories': z.array(Identifier),
  'vat.reduced_rate_categories': z.array(Identifier),
  // keyed by the flat-rate percentage as text ('80', '60', '40', '30'), value = the cap in CZK.
  'pausalni_vydaje.rates_caps': z.partialRecord(z.enum(['80', '60', '40', '30']), CzkWhole),
  'pausalni_dan.bands': z.array(PausalniDanBand).min(1),
  'pausalni_dan.eligibility': z.strictObject({ max_income: CzkWhole, max_other_income: CzkWhole }),
  'pausalni_dan.deadlines': z.strictObject({
    entry: MonthDay,
    exit: MonthDay,
    advance_day: DayOfMonth,
  }),
  'income_tax.rates': z.strictObject({ r1: Pct, r2: Pct, threshold_annual: CzkWhole }),
  'income_tax.credits': z.strictObject({ taxpayer: CzkWhole }),
  'insurance.min_advances': z.strictObject({ social: CzkWhole, health: CzkWhole }),
  'insurance.rates': z.strictObject({
    social_pct: Pct,
    social_base_pct: Pct,
    health_pct: Pct,
    health_base_pct: Pct,
  }),
  'asset.capitalization_threshold': CzkWhole,
  'cash.payment_limit': CashPaymentLimit,
  'calendar.cz_public_holidays': z.strictObject({
    fixed: z.array(MonthDay).min(1),
    movable: z.record(YearKey, z.array(MonthDay)),
  }),
  // module-owned: M05 §4.12, M06 §4.12, M09 §4.7 define the generator fields; `kind` is required.
  'deadlines.generators': z.array(z.looseObject({ kind: Identifier })),
  'municipal.tourist_fee': z.record(
    Identifier,
    z.looseObject({ report_deadline_days_after_month: PositiveInt, rate_per_bed_night: CzkWhole }),
  ),
  // module-owned: M07 (authority account patterns per payee).
  'bank.authority_accounts': z.record(Identifier, ModuleOwnedRecord),
  // module-owned: M05/M06 (EPO form versions, XSD URLs, tax years), keyed by form id.
  'epo.forms': z.record(z.string().regex(/^[A-Z0-9]+$/), ModuleOwnedRecord),
  'epo.dphdp3_row_map': z.array(Dphdp3Row),
  // module-owned: M05 §4.2 step 8 (KH routing table).
  'epo.kh_routing': ModuleOwnedRecord,
  'epo.fu_payment_accounts': z.record(Identifier, FuPaymentAccount),
  'privacy.retention_years_after_year': PositiveInt,
} as const;

export type LawRuleKey = keyof typeof LAW_RULE_SCHEMAS;
export const LAW_RULE_KEYS = Object.keys(LAW_RULE_SCHEMAS) as readonly LawRuleKey[];
