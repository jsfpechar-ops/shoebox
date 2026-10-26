// Czech law values in force in 2025 (06 §2.1), base layer, one segment per key for the calendar
// year. Every value names the law or official page it was read from; `verified_at` is the day a
// person last checked it. Amounts are whole CZK integers (ADR-007); percentages are factors.
// Keys not listed here (income tax, insurance rates, holidays, EPO forms, …) are seeded by the
// module ticket that first reads them (P0-DOM-05 scope).
import type { LawRuleKey } from '../law';
import type { RuleEntryInput } from '../segment';
import {
  CZ_DEADLINE_GENERATORS,
  CZ_FIXED_HOLIDAYS,
  DEADLINES_VERIFIED_AT,
  HOLIDAYS_ACT,
  TAX_PROCEDURE_ACT,
} from './deadlines';
import { CZ_DPHDP3_ROW_MAP, CZ_KH_ROUTING } from './epo';

const VALID_FROM = '2025-01-01';
const VALID_TO = '2025-12-31';
const VERIFIED_AT = '2026-10-18';

/** Zákon č. 235/2004 Sb., o dani z přidané hodnoty (ZDPH). */
const ZDPH = 'https://www.zakonyprolidi.cz/cs/2004-235';
/** Zákon č. 586/1992 Sb., o daních z příjmů (ZDP). */
const ZDP = 'https://www.zakonyprolidi.cz/cs/1992-586';
/** Zákon č. 254/2004 Sb., o omezení plateb v hotovosti, § 4 odst. 1 (limit 270 000 Kč). */
const CASH_ACT = 'https://www.zakonyprolidi.cz/cs/2004-254#p4';
/** GFŘ methodology for the control statement (A.4/B.2 vs A.5/B.3 split at 10 000 Kč incl. VAT). */
const KH_METHODOLOGY =
  'https://financnisprava.gov.cz/assets/cs/prilohy/d-seznam-dani/Metodicka_informace_k_vyplneni_KH_20240101.pdf';
/** EPO: published structure of the DPHDP3 form (přiznání k DPH), rows and XML attributes. [verify] */
const DPHDP3_STRUCTURE =
  'https://adisspr.mfcr.cz/dpr/adis/idpr_pub/epo2_info/popis_struktury_detail.faces?zkratka=DPHDP3';
/** Finanční správa: paušální daň for 2025 (bands, monthly advances, income ceilings). */
const PAUSALNI_DAN_2025 =
  'https://financnisprava.gov.cz/cs/dane/dane/dan-z-prijmu/pausalni-dan/informace-k-institutu-pausalni-dane-pro-rok-2025';
/** ČSSZ: key social-security figures for 2025 (minimum base 16 295 Kč → advance 4 759 Kč). */
const CSSZ_2025 =
  'https://www.cssz.gov.cz/-/prehled-nejdulezitejsich-udaju-pro-socialni-zabezpeceni-v-roce-2025';

/** Finanční správa: bank accounts of the tax offices (prefix = tax kind, bank code 0710). TODO(verify): URL not re-read on 2026-10-26. */
const FU_ACCOUNTS =
  'https://financnisprava.gov.cz/cs/dane/placeni-dani/bankovni-ucty-financnich-uradu';

function base(key: LawRuleKey, source: string, value: unknown): RuleEntryInput {
  return {
    key,
    layer: 'base',
    valid_from: VALID_FROM,
    valid_to: VALID_TO,
    source,
    verified_at: VERIFIED_AT,
    value,
  };
}

export const RULES_CZ_2025: readonly RuleEntryInput[] = [
  // ZDPH § 47 odst. 1: 21 % standard, 12 % reduced (since 2024-01-01, zákon č. 349/2023 Sb.).
  base('vat.rates', `${ZDPH}#p47`, { standard: 21, reduced: 12 }),
  // ZDPH § 6 (since 2025-01-01, zákon č. 461/2024 Sb.): calendar-year turnover over 2 000 000 Kč →
  // payer from 1 January of the next year; over 2 536 500 Kč → payer from the next day.
  base('vat.registration_thresholds', `${ZDPH}#p6`, {
    calendar_year: 2_000_000,
    immediate: 2_536_500,
  }),
  // KH: documents up to 10 000 Kč incl. VAT are reported in aggregate (A.5/B.3), above per document.
  base('vat.kh_document_limit', KH_METHODOLOGY, 10_000),
  // ZDPH § 30 odst. 1: a simplified tax document up to 10 000 Kč total.
  base('vat.simplified_document_limit', `${ZDPH}#p30`, 10_000),
  // ZDPH § 2a odst. 2: EU goods acquisitions above 326 000 Kč per calendar year are taxable.
  base('vat.io_eu_goods_threshold', `${ZDPH}#p2a`, 326_000),
  // ZDPH § 73 odst. 3 (since 2025-01-01): deduction by the end of the 2nd calendar year after it arose.
  base('vat.deduction_deferral_years', `${ZDPH}#p73`, 2),
  // ZDPH § 109 odst. 2 písm. c) bod 4: ručení when the cash part of the payment exceeds the limit of
  // zákon č. 254/2004 Sb. (270 000 Kč). The unpublished-account case (bod 2) has no amount since 2025.
  base('vat.ruceni_cash_threshold', `${ZDPH}#p109`, 270_000),
  // ZDPH § 4 odst. 8: ČNB rate valid on the date the tax point arises, else the last published rate.
  // TODO(verify): § number not re-read on 2026-10-18; the enum admits only this value.
  base('vat.cnb_rate_rule', `${ZDPH}#p4`, 'rate_valid_on_date_else_last_published'),
  // ZDPH § 101 odst. 1: the return is due within 25 days after the end of the period.
  base('vat.deadline_day', `${ZDPH}#p101`, 25),
  // Treaty on European Union, Art. 52: the 27 member states (CZ included; VAT consumers that need
  // "other member states" exclude CZ themselves). 'XI' (Northern Ireland, goods only) is not listed:
  // TODO(verify): add 'XI' once the goods-only rule has a place in the schema.
  {
    ...base('vat.eu_member_states', 'https://eur-lex.europa.eu/eli/treaty/teu_2016/oj', [
      'AT',
      'BE',
      'BG',
      'HR',
      'CY',
      'CZ',
      'DK',
      'EE',
      'FI',
      'FR',
      'DE',
      'GR',
      'HU',
      'IE',
      'IT',
      'LV',
      'LT',
      'LU',
      'MT',
      'NL',
      'PL',
      'PT',
      'RO',
      'SK',
      'SI',
      'ES',
      'SE',
    ]),
    verified_at: '2026-10-26',
  },
  // ZDPH § 2: pass-through amounts (tourist fee, deposits, customs VAT) are not a supply of the
  // taxpayer. TODO(verify): bank fees (06 §2.1 "[verify bank fees]").
  {
    ...base('vat.out_of_scope_categories', `${ZDPH}#p2`, [
      'pt_tourist_fee',
      'pt_deposit',
      'pt_customs_vat',
    ]),
    verified_at: '2026-10-26',
  },
  // ZDPH § 47 and příloha č. 2: none of the seeded categories is a reduced-rate service by default
  // (06 §2.1: `[]`, "[verify per service]" in M04 §4.2).
  { ...base('vat.reduced_rate_categories', `${ZDPH}#p47`, []), verified_at: '2026-10-26' },
  // DPHDP3 row map (M05 §4.2 step 8, research/czech-tax-filings.md §2). Rows 40/41/42/50 carry
  // `confirmed: false` until Phase 3 checks their attrs against the XSD; see cz/epo.ts.
  { ...base('epo.dphdp3_row_map', DPHDP3_STRUCTURE, CZ_DPHDP3_ROW_MAP), verified_at: '2026-10-26' },
  // KH sections per treatment (research/czech-tax-filings.md §1.3.1); the 10 000 Kč split is
  // `vat.kh_document_limit`.
  { ...base('epo.kh_routing', KH_METHODOLOGY, CZ_KH_ROUTING), verified_at: '2026-10-26' },
  // ZDP § 7 odst. 7: flat-rate expense percentages and their caps (income cap 2 000 000 Kč).
  base('pausalni_vydaje.rates_caps', `${ZDP}#p7`, {
    '80': 1_600_000,
    '60': 1_200_000,
    '40': 800_000,
    '30': 600_000,
  }),
  // Paušální daň 2025: band I 8 716 Kč (100 + 5 473 + 3 143), band II 16 745 Kč, band III 27 139 Kč.
  base('pausalni_dan.bands', PAUSALNI_DAN_2025, [
    {
      band: 1,
      monthly: 8_716,
      ceilings: [
        { max_income: 1_000_000 },
        { max_income: 1_500_000, requires_dominant_rate_in: [80, 60] },
        { max_income: 2_000_000, requires_dominant_rate_in: [80] },
      ],
    },
    {
      band: 2,
      monthly: 16_745,
      ceilings: [
        { max_income: 1_500_000 },
        { max_income: 2_000_000, requires_dominant_rate_in: [80, 60] },
      ],
    },
    { band: 3, monthly: 27_139, ceilings: [{ max_income: 2_000_000 }] },
  ]),
  // ZDP § 2a odst. 1: income from self-employment up to 2 000 000 Kč, other §§ 8–10 income up to 50 000 Kč.
  base('pausalni_dan.eligibility', `${ZDP}#p2a`, {
    max_income: 2_000_000,
    max_other_income: 50_000,
  }),
  // ZDP § 38lc (entry and exit notice by 10 January) and § 38lk (advance due by the 20th of the month).
  base('pausalni_dan.deadlines', `${ZDP}#p38lc`, {
    entry: '01-10',
    exit: '01-10',
    advance_day: 20,
  }),
  // Social: ČSSZ 2025 (29.2 % of the minimum base 16 295 Kč = 4 759 Kč). Health: VZP, minimum base
  // 23 278,50 Kč → 3 143 Kč (https://www.vzp.cz/platci/informace/osvc/osvc-minimalni-vyse-zaloh).
  base('insurance.min_advances', CSSZ_2025, { social: 4_759, health: 3_143 }),
  // ZDP § 26 odst. 2 písm. a): tangible movable assets with an entry price above 80 000 Kč (since 2021).
  base('asset.capitalization_threshold', `${ZDP}#p26`, 80_000),
  // Zákon č. 254/2004 Sb. § 4 odst. 1: payments above 270 000 Kč per day and counterparty are cashless.
  base('cash.payment_limit', CASH_ACT, { amount: 270_000, currency: 'CZK' }),
  // M09 §4.7 (brief 0072): holidays and deadline generators, verified on a later day.
  {
    ...base('calendar.cz_public_holidays', HOLIDAYS_ACT, {
      fixed: CZ_FIXED_HOLIDAYS,
      movable: { '2025': ['04-18', '04-21'] },
    }),
    verified_at: DEADLINES_VERIFIED_AT,
  },
  {
    ...base('deadlines.generators', TAX_PROCEDURE_ACT, CZ_DEADLINE_GENERATORS),
    verified_at: DEADLINES_VERIFIED_AT,
  },
  // M07 §4.7.4 (brief 0117): which payee account means which tax or insurance payment. Only the
  // two prefixes with an [O] source are seeded. TODO(verify): income-tax prefix 721, the ČSSZ/OSSZ,
  // insurer and municipal account lists (fill `accounts` from the official pages, A12).
  base('bank.authority_accounts', FU_ACCOUNTS, {
    fu: {
      bank_code: '0710',
      prefix_map: { '705': 'tax_vat_payment', '2866': 'tax_pausal_advance' },
      vat_refund_category: 'income_vat_refund',
    },
    cssz: { category: 'ins_social_own', accounts: [] },
    insurers: { category: 'ins_health_own', accounts: [] },
    municipalities: { category: 'pt_tourist_fee', accounts: [] },
    name_hints: {
      'FINANCNI URAD': 'tax_other_fees',
      CSSZ: 'ins_social_own',
      OSSZ: 'ins_social_own',
      PSSZ: 'ins_social_own',
      MSSZ: 'ins_social_own',
      'SPRAVA SOCIALNIHO ZABEZPECENI': 'ins_social_own',
      'ZDRAVOTNI POJISTOVNA': 'ins_health_own',
      VZP: 'ins_health_own',
      VOZP: 'ins_health_own',
      CPZP: 'ins_health_own',
      OZP: 'ins_health_own',
      ZPMV: 'ins_health_own',
      RBP: 'ins_health_own',
      'ZP SKODA': 'ins_health_own',
    },
  }),
];
