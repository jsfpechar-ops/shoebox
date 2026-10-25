// Drizzle mirrors of the 25 Postgres enums created by migrations/0001_enums.sql.
// Values come from @shoebox/domain (04: one TypeScript union per Postgres enum), so the three
// copies (domain, Drizzle, SQL) cannot drift: this file reuses the domain tuples, and
// test/enums-parity.test.ts compares the SQL with the domain.
import {
  DIRECTION_VALUES,
  DOC_LINK_KIND_VALUES,
  DOCUMENT_CLASS_VALUES,
  DOCUMENT_STATUS_VALUES,
  FIELD_SOURCE_VALUES,
  FILING_KIND_VALUES,
  FILING_ORIGIN_VALUES,
  FILING_STATE_VALUES,
  FILING_TYPE_VALUES,
  LINE_TYPE_VALUES,
  LINK_TYPE_VALUES,
  MATCH_METHOD_VALUES,
  MEMBER_ROLE_VALUES,
  MONEY_ACCOUNT_TYPE_VALUES,
  PACKAGE_STATE_VALUES,
  SEVERITY_VALUES,
  TAX_DOC_STATUS_VALUES,
  TAX_EFFECT_VALUES,
  TAX_REGIME_VALUES,
  TX_SOURCE_VALUES,
  VALIDATION_STATE_VALUES,
  VAT_PERIOD_VALUES,
  VAT_RATE_TYPE_VALUES,
  VAT_STATUS_VALUES,
  VAT_TREATMENT_VALUES,
} from '@shoebox/domain';
import { pgEnum } from 'drizzle-orm/pg-core';

export const vatStatusEnum = pgEnum('vat_status', VAT_STATUS_VALUES);
export const vatPeriodEnum = pgEnum('vat_period', VAT_PERIOD_VALUES);
export const taxRegimeEnum = pgEnum('tax_regime', TAX_REGIME_VALUES);
export const memberRoleEnum = pgEnum('member_role', MEMBER_ROLE_VALUES);
export const documentClassEnum = pgEnum('document_class', DOCUMENT_CLASS_VALUES);
export const documentStatusEnum = pgEnum('document_status', DOCUMENT_STATUS_VALUES);
export const taxDocStatusEnum = pgEnum('tax_doc_status', TAX_DOC_STATUS_VALUES);
export const directionEnum = pgEnum('direction', DIRECTION_VALUES);
export const lineTypeEnum = pgEnum('line_type', LINE_TYPE_VALUES);
export const vatRateTypeEnum = pgEnum('vat_rate_type', VAT_RATE_TYPE_VALUES);
export const vatTreatmentEnum = pgEnum('vat_treatment', VAT_TREATMENT_VALUES);
export const taxEffectEnum = pgEnum('tax_effect', TAX_EFFECT_VALUES);
export const fieldSourceEnum = pgEnum('field_source', FIELD_SOURCE_VALUES);
export const severityEnum = pgEnum('severity', SEVERITY_VALUES);
export const validationStateEnum = pgEnum('validation_state', VALIDATION_STATE_VALUES);
export const moneyAccountTypeEnum = pgEnum('money_account_type', MONEY_ACCOUNT_TYPE_VALUES);
export const txSourceEnum = pgEnum('tx_source', TX_SOURCE_VALUES);
export const linkTypeEnum = pgEnum('link_type', LINK_TYPE_VALUES);
export const matchMethodEnum = pgEnum('match_method', MATCH_METHOD_VALUES);
export const docLinkKindEnum = pgEnum('doc_link_kind', DOC_LINK_KIND_VALUES);
export const filingTypeEnum = pgEnum('filing_type', FILING_TYPE_VALUES);
export const filingKindEnum = pgEnum('filing_kind', FILING_KIND_VALUES);
export const filingStateEnum = pgEnum('filing_state', FILING_STATE_VALUES);
export const filingOriginEnum = pgEnum('filing_origin', FILING_ORIGIN_VALUES);
export const packageStateEnum = pgEnum('package_state', PACKAGE_STATE_VALUES);
