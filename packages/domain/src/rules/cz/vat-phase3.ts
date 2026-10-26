/**
 * Phase 3 VAT rule values (brief 0328). Data only: no code reads them in this brief.
 * Rates, limits and form versions live only in `packages/domain/rules` (AGENTS rule 1).
 */

import type { VatTreatment } from '../../enums/index';

/**
 * M05 §4.3 default simple-period policy (version 2026.1). Sources: research/czech-tax-filings.md §1.1
 * (versions dated 11. 8. 2026), 22 D-11 default.
 */
export const CZ_SIMPLE_PERIOD_POLICY = {
  version: '2026.1',
  allowed_treatments: {
    identifikovana_osoba: [
      'rcv_eu_service_reverse_charge',
      'rcv_non_eu_service_reverse_charge',
      'rcv_domestic_vat',
      'rcv_domestic_no_vat',
      'rcv_foreign_vat_charged',
      'rcv_out_of_scope',
      'iss_no_vat',
    ],
    platce: [
      'iss_domestic_vat',
      'iss_eu_service',
      'iss_eu_goods',
      'iss_non_eu_service',
      'iss_no_vat',
      'rcv_domestic_vat',
      'rcv_domestic_no_vat',
      'rcv_eu_service_reverse_charge',
      'rcv_non_eu_service_reverse_charge',
      'rcv_eu_goods_acquisition',
      'rcv_foreign_vat_charged',
      'rcv_out_of_scope',
    ],
  },
  forbid_document_classes: ['received_advance_tax_doc'],
  forbid_line_types: ['advance_deduction'],
  max_docs: 150,
  max_rates_per_eu_goods_document: 1,
  allow_partial_business_share_on_deduction: false,
  allow_prior_period_credit_notes: false,
} as const satisfies {
  readonly allowed_treatments: Record<string, readonly VatTreatment[]>;
  readonly [key: string]: unknown;
};

/**
 * EPO form versions valid from 2026-01-01 (research/czech-tax-filings.md §1.1, dated 11. 8. 2026).
 * `verze_pis` = first two groups of the popis version: an inference, [verify] (T-02, brief 0328).
 */
export const CZ_EPO_FORMS = {
  DPHDP3: {
    version: '03.01.04',
    verze_pis: '03.01',
    xsd: 'dphdp3_epo2.xsd',
    source_url: 'https://adisspr.mfcr.cz/adis/jepo/schema/dphdp3_epo2.xsd',
    valid_for_periods_from: '2026-01-01',
  },
  DPHKH1: {
    version: '03.01.15',
    verze_pis: '03.01',
    xsd: 'dphkh1_epo2.xsd',
    source_url: 'https://adisspr.mfcr.cz/adis/jepo/schema/dphkh1_epo2.xsd',
    valid_for_periods_from: '2026-01-01',
  },
  DPHSHV: {
    version: '02.01.05',
    verze_pis: '02.01',
    xsd: 'dphshv_epo2.xsd',
    source_url: 'https://adisspr.mfcr.cz/adis/jepo/schema/dphshv_epo2.xsd',
    valid_for_periods_from: '2026-01-01',
  },
  // [verify] version and verze_pis are placeholders until the owner downloads the XSD (22 T-03).
  // tax_years lists the years whose XSD is vendored; empty means the partial XML stays hidden.
  DPFDP7: {
    version: '00.00.00',
    verze_pis: '00.00',
    xsd: 'dpfdp7_epo2.xsd',
    source_url: 'https://adisspr.mfcr.cz/adis/jepo/schema/dpfdp7_epo2.xsd',
    valid_for_periods_from: '2026-01-01',
    tax_years: [] as readonly number[],
  },
} as const;

export type SimplePeriodPolicy = typeof CZ_SIMPLE_PERIOD_POLICY;
export type EpoForms = typeof CZ_EPO_FORMS;
