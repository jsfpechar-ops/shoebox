// One zod schema per product key (06 §2.2): hotfixable through `rules_overrides`, not law.
// Shapes only; values are seeded by P0-DOM-05. Keys whose shape is seed data owned by a module
// (M03/M04 rule tables) stay loose until that module's ticket tightens them.
import { z } from 'zod';
import {
  CountryCode,
  CzkWhole,
  DecimalString,
  Identifier,
  ModuleOwnedRecord,
  MoneyString,
  NonNegInt,
  PositiveInt,
  Ratio,
} from './atoms';

export const PRODUCT_RULE_SCHEMAS = {
  'validation.tol.line_qty_price': z.strictObject({ abs: MoneyString, rel: Ratio }),
  'validation.tol.line_vat': z.strictObject({ abs: MoneyString }),
  'validation.tol.vat_row_per_line': z.strictObject({ per_line: DecimalString, cap: MoneyString }),
  'validation.tol.sum': z.strictObject({ abs: MoneyString }),
  'validation.rounding.max_czk': MoneyString,
  'validation.rounding.max_foreign': MoneyString,
  'validation.discount_patterns': z.array(z.string().min(1)).min(1),
  'validation.confidence_review_threshold': Ratio,
  'validation.name_match_min': Ratio,
  'validation.future_date_grace_days': NonNegInt,
  'validation.max_document_age_years': PositiveInt,
  'validation.duzp_issue_gap_days': NonNegInt,
  'validation.dup_fuzzy_days': NonNegInt,
  'validation.dup_fuzzy_amount_tol': MoneyString,
  'validation.personal_purchase': z.looseObject({
    threshold: Ratio,
    max_amount_czk: CzkWhole,
    merchants: z.array(z.string().min(1)),
  }),
  'validation.vat_id_patterns': z.record(CountryCode, z.string().min(1)),
  'registry.timeout_ms': PositiveInt,
  'registry.cache_ttl_hours': z.strictObject({
    ares: PositiveInt,
    crpdph: PositiveInt,
    vies: PositiveInt,
  }),
  'registry.stale_ok_hours': PositiveInt,
  'registry.retry_schedule_minutes': z.array(PositiveInt).min(1),
  'fx.max_lookback_days': PositiveInt,
  'classification.vendor_memory_min_confirmations': PositiveInt,
  'classification.auto_accept_confidence': Ratio,
  'classification.low_value_skip_czk': CzkWhole,
  'classification.max_questions_per_document': NonNegInt,
  'classification.max_service_period_days_for_end': PositiveInt,
  'classification.recurring_categories': z.array(Identifier),
  // module-owned seed data (M04): one record per rule or platform.
  'classification.hard_rules': z.array(ModuleOwnedRecord),
  'classification.soft_rules': z.array(ModuleOwnedRecord),
  'classification.keyword_rules': z.array(ModuleOwnedRecord),
  'classification.platforms': z.array(ModuleOwnedRecord),
  'classification.nace_category_map': z.record(z.string().min(1), Identifier),
  'classification.global_prior_min_support': PositiveInt,
  'classification.global_prior_min_agreement': Ratio,
  'classification.natural_person_legal_forms': z.array(z.string().min(1)),
  'feature.dpfdp7_partial': z.boolean(),
  'feature.bank_fio_api': z.boolean(),
  'feature.vat_filings': z.boolean(),
  'feature.bank': z.boolean(),
} as const;

export type ProductRuleKey = keyof typeof PRODUCT_RULE_SCHEMAS;
export const PRODUCT_RULE_KEYS = Object.keys(PRODUCT_RULE_SCHEMAS) as readonly ProductRuleKey[];
