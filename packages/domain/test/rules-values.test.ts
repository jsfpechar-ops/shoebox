import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import {
  CZ_RULE_ENTRIES,
  createCzRules,
  RULES_CZ_2025,
  RULES_CZ_2026,
  RULES_CZ_PRODUCT,
  type RuleKey,
  RuleMissingError,
  RuleSetSchema,
} from '../src/index';
import { parseDphdp3RowMap, parseKhRouting } from '../src/rules/cz/epo';
import type { CZ_EPO_FORMS, CZ_SIMPLE_PERIOD_POLICY } from '../src/rules/cz/vat-phase3';

// Real law values (P0-DOM-05, 06 §2.1): every key is asserted on a known date and on the day
// before a change. Sources are in the comments of src/rules/cz/2025.ts and 2026.ts.
const rules = createCzRules();

/** The keys P0-DOM-05 seeds; the other law keys are seeded by the module ticket that reads them. */
const SEEDED_KEYS: readonly RuleKey[] = [
  'asset.capitalization_threshold',
  'calendar.cz_public_holidays',
  'cash.payment_limit',
  'deadlines.generators',
  'epo.dphdp3_row_map',
  'epo.forms',
  'epo.kh_routing',
  'income_tax.credits',
  'income_tax.rates',
  'insurance.min_advances',
  'insurance.rates',
  'pausalni_dan.bands',
  'pausalni_dan.deadlines',
  'pausalni_dan.eligibility',
  'pausalni_vydaje.rates_caps',
  'vat.amendment_windows',
  'vat.cnb_rate_rule',
  'vat.deadline_day',
  'vat.deduction_deferral_years',
  'vat.eu_member_states',
  'vat.io_eu_goods_threshold',
  'vat.kh_document_limit',
  'vat.out_of_scope_categories',
  'vat.rates',
  'vat.reduced_rate_categories',
  'vat.registration_thresholds',
  'vat.return_rounding',
  'vat.ruceni_cash_threshold',
  'vat.shv_rounding',
  'vat.simple_period_policy',
  'vat.simplified_document_limit',
];

/** Primary sources only (06 §2): the law, the ministry, ČSSZ, VZP or the EU Official Journal. */
const PRIMARY_HOSTS = [
  'www.zakonyprolidi.cz',
  'financnisprava.gov.cz',
  'www.cssz.gov.cz',
  'www.vzp.cz',
  'eur-lex.europa.eu',
  'adisspr.mfcr.cz',
  // product keys (06 §2.2) are product decisions: their source is the spec in this repository
  'github.com',
];

const PAUSALNI_DAN_CEILINGS = {
  1: [
    { max_income: 1_000_000 },
    { max_income: 1_500_000, requires_dominant_rate_in: [80, 60] },
    { max_income: 2_000_000, requires_dominant_rate_in: [80] },
  ],
  2: [{ max_income: 1_500_000 }, { max_income: 2_000_000, requires_dominant_rate_in: [80, 60] }],
  3: [{ max_income: 2_000_000 }],
};

describe('seed files (06 §2)', () => {
  it('every entry is a valid RuleSetSchema item in the base layer', () => {
    const parsed = RuleSetSchema.safeParse(CZ_RULE_ENTRIES);
    expect(parsed.success).toBe(true);
    expect(CZ_RULE_ENTRIES.every((entry) => entry.layer === 'base')).toBe(true);
    expect(CZ_RULE_ENTRIES).toHaveLength(
      RULES_CZ_2025.length + RULES_CZ_2026.length + RULES_CZ_PRODUCT.length,
    );
  });

  it('every entry names a primary source and a verification date', () => {
    for (const entry of CZ_RULE_ENTRIES) {
      expect(PRIMARY_HOSTS, entry.source).toContain(new URL(entry.source).hostname);
      expect(['2026-10-18', '2026-10-25', '2026-10-26']).toContain(entry.verified_at);
    }
  });

  it('seeds exactly the P0-DOM-05 keys in both years', () => {
    expect([...new Set(RULES_CZ_2025.map((e) => e.key))].sort()).toEqual(SEEDED_KEYS);
    expect([...new Set(RULES_CZ_2026.map((e) => e.key))].sort()).toEqual(SEEDED_KEYS);
    expect(RULES_CZ_2025).toHaveLength(31);
    expect(RULES_CZ_2026).toHaveLength(32);
  });

  it('2025 segments span the calendar year; 2026 segments start on 2026-01-01', () => {
    for (const entry of RULES_CZ_2025) {
      expect(entry.valid_from).toBe('2025-01-01');
      expect(entry.valid_to).toBe('2025-12-31');
    }
    expect(RULES_CZ_2026.every((entry) => entry.valid_from >= '2026-01-01')).toBe(true);
    expect(RULES_CZ_2026.filter((entry) => entry.valid_from === '2026-01-01')).toHaveLength(31);
  });

  it('every seeded key resolves on every day of 2025 and 2026 and not before', () => {
    for (const key of SEEDED_KEYS) {
      for (const date of ['2025-01-01', '2025-12-31', '2026-01-01', '2026-12-31']) {
        expect(rules.at(date).has(key), `${key} on ${date}`).toBe(true);
      }
      expect(rules.at('2024-12-31').has(key)).toBe(false);
    }
    expect(() => rules.at('2024-12-31').get('vat.rates')).toThrow(RuleMissingError);
  });
});

describe('VAT (zákon č. 235/2004 Sb.)', () => {
  it('vat.rates: 21 % / 12 % in both years', () => {
    for (const date of ['2025-01-01', '2025-12-31', '2026-01-01', '2026-05-01']) {
      expect(rules.at(date).get('vat.rates')).toEqual({ standard: 21, reduced: 12 });
    }
  });

  it('vat.registration_thresholds: 2 000 000 / 2 536 500 Kč in both years', () => {
    for (const date of ['2025-01-01', '2025-12-31', '2026-01-01', '2026-05-01']) {
      expect(rules.at(date).get('vat.registration_thresholds')).toEqual({
        calendar_year: 2_000_000,
        immediate: 2_536_500,
      });
    }
  });

  it('document limits: KH 10 000 Kč, simplified document 10 000 Kč, EU goods 326 000 Kč', () => {
    for (const date of ['2025-12-31', '2026-01-01']) {
      expect(rules.at(date).get('vat.kh_document_limit')).toBe(10_000);
      expect(rules.at(date).get('vat.simplified_document_limit')).toBe(10_000);
      expect(rules.at(date).get('vat.io_eu_goods_threshold')).toBe(326_000);
    }
  });

  it('deduction deferral 2 years, ručení cash threshold 270 000 Kč', () => {
    for (const date of ['2025-12-31', '2026-01-01']) {
      expect(rules.at(date).get('vat.deduction_deferral_years')).toBe(2);
      expect(rules.at(date).get('vat.ruceni_cash_threshold')).toBe(270_000);
    }
  });

  it('ČNB rate rule and the 25th as the deadline day', () => {
    for (const date of ['2025-12-31', '2026-01-01']) {
      expect(rules.at(date).get('vat.cnb_rate_rule')).toBe(
        'rate_valid_on_date_else_last_published',
      );
      expect(rules.at(date).get('vat.deadline_day')).toBe(25);
    }
  });
});

describe('income tax and paušální daň (zákon č. 586/1992 Sb.)', () => {
  it('pausalni_vydaje.rates_caps: 1.6 M / 1.2 M / 0.8 M / 0.6 M Kč in both years', () => {
    for (const date of ['2025-12-31', '2026-01-01']) {
      expect(rules.at(date).get('pausalni_vydaje.rates_caps')).toEqual({
        '80': 1_600_000,
        '60': 1_200_000,
        '40': 800_000,
        '30': 600_000,
      });
    }
  });

  it('pausalni_dan.bands 2025: 8 716 / 16 745 / 27 139 Kč with the income ceilings', () => {
    for (const date of ['2025-01-01', '2025-12-31']) {
      expect(rules.at(date).get('pausalni_dan.bands')).toEqual([
        { band: 1, monthly: 8_716, ceilings: PAUSALNI_DAN_CEILINGS[1] },
        { band: 2, monthly: 16_745, ceilings: PAUSALNI_DAN_CEILINGS[2] },
        { band: 3, monthly: 27_139, ceilings: PAUSALNI_DAN_CEILINGS[3] },
      ]);
    }
  });

  it('Phase 0 exit: rules.at(2026-05-01) band I = 9 162 Kč', () => {
    expect(rules.at('2026-05-01').get('pausalni_dan.bands')[0]?.monthly).toBe(9_162);
  });

  it('pausalni_dan.bands 2026: 9 162 Kč from 2026-01-01 (retroactive), 8 716 Kč the day before', () => {
    expect(rules.at('2025-12-31').get('pausalni_dan.bands')[0]?.monthly).toBe(8_716);
    for (const date of ['2026-01-01', '2026-06-30', '2026-07-01', '2026-12-31']) {
      expect(rules.at(date).get('pausalni_dan.bands')).toEqual([
        { band: 1, monthly: 9_162, ceilings: PAUSALNI_DAN_CEILINGS[1] },
        { band: 2, monthly: 16_745, ceilings: PAUSALNI_DAN_CEILINGS[2] },
        { band: 3, monthly: 27_139, ceilings: PAUSALNI_DAN_CEILINGS[3] },
      ]);
    }
  });

  it('pausalni_dan.eligibility and deadlines are unchanged across the year boundary', () => {
    for (const date of ['2025-12-31', '2026-01-01']) {
      expect(rules.at(date).get('pausalni_dan.eligibility')).toEqual({
        max_income: 2_000_000,
        max_other_income: 50_000,
      });
      expect(rules.at(date).get('pausalni_dan.deadlines')).toEqual({
        entry: '01-10',
        exit: '01-10',
        advance_day: 20,
      });
    }
  });
});

describe('insurance minimum advances (ČSSZ, VZP)', () => {
  it('2025: social 4 759 Kč, health 3 143 Kč; 2026: social 5 005 Kč, health 3 306 Kč', () => {
    for (const date of ['2025-01-01', '2025-12-31']) {
      expect(rules.at(date).get('insurance.min_advances')).toEqual({
        social: 4_759,
        health: 3_143,
      });
    }
    for (const date of ['2026-01-01', '2026-06-30', '2026-07-01']) {
      expect(rules.at(date).get('insurance.min_advances')).toEqual({
        social: 5_005,
        health: 3_306,
      });
    }
  });
});

describe('assets and cash', () => {
  it('asset.capitalization_threshold: 80 000 Kč in both years', () => {
    for (const date of ['2025-12-31', '2026-01-01']) {
      expect(rules.at(date).get('asset.capitalization_threshold')).toBe(80_000);
    }
  });

  it('cash.payment_limit: 270 000 Kč until 2027-07-09, EUR 10 000 from 2027-07-10', () => {
    for (const date of ['2025-01-01', '2025-12-31', '2026-01-01', '2027-07-09']) {
      expect(rules.at(date).get('cash.payment_limit')).toEqual({
        amount: 270_000,
        currency: 'CZK',
      });
    }
    for (const date of ['2027-07-10', '2028-01-01']) {
      expect(rules.at(date).get('cash.payment_limit')).toEqual({ amount: 10_000, currency: 'EUR' });
    }
  });

  it('resolve() carries the source of the winning segment', () => {
    const czk = rules.at('2026-01-01').resolve('cash.payment_limit');
    expect(czk.source).toBe('https://www.zakonyprolidi.cz/cs/2004-254#p4');
    expect(czk.valid_to).toBe('2027-07-09');
    const eur = rules.at('2027-07-10').resolve('cash.payment_limit');
    expect(eur.source).toBe('https://eur-lex.europa.eu/eli/reg/2024/1624/oj');
  });

  it('an override row beats the seeded base value', () => {
    const patched = createCzRules([
      {
        key: 'vat.kh_document_limit',
        layer: 'override',
        valid_from: '2026-03-01',
        valid_to: null,
        source: 'https://financnisprava.gov.cz/',
        verified_at: '2026-03-01',
        value: 20_000,
      },
    ]);
    expect(patched.at('2026-02-28').get('vat.kh_document_limit')).toBe(10_000);
    expect(patched.at('2026-03-01').get('vat.kh_document_limit')).toBe(20_000);
  });
});

describe('VAT lists (brief 0302)', () => {
  it('vat.eu_member_states: EU-27 incl. CZ, no XI, in both years', () => {
    for (const date of ['2025-12-31', '2026-01-01']) {
      const states = rules.at(date).get('vat.eu_member_states');
      expect(states).toHaveLength(27);
      expect(states).toContain('CZ');
      expect(states).toContain('IE');
      expect(states).not.toContain('XI');
      expect(states).not.toContain('GB');
      expect(states).not.toContain('US');
    }
  });

  it('vat.out_of_scope_categories and vat.reduced_rate_categories', () => {
    for (const date of ['2025-12-31', '2026-01-01']) {
      expect(rules.at(date).get('vat.out_of_scope_categories')).toEqual([
        'pt_tourist_fee',
        'pt_deposit',
        'pt_customs_vat',
      ]);
      expect(rules.at(date).get('vat.reduced_rate_categories')).toEqual([]);
    }
  });
});

describe('product keys of lane C (06 §2.2, brief 0302)', () => {
  it('one open-ended base segment per key from 2025-01-01', () => {
    expect(RULES_CZ_PRODUCT).toHaveLength(12);
    for (const entry of RULES_CZ_PRODUCT) {
      expect(entry.layer).toBe('base');
      expect(entry.valid_from).toBe('2025-01-01');
      expect(entry.valid_to).toBeNull();
      expect(new URL(entry.source).hostname).toBe('github.com');
    }
    expect(new Set(RULES_CZ_PRODUCT.map((e) => e.key)).size).toBe(12);
  });

  it('the numeric thresholds', () => {
    const at = rules.at('2026-10-26');
    expect(at.get('fx.max_lookback_days')).toBe(7);
    expect(at.get('classification.vendor_memory_min_confirmations')).toBe(2);
    expect(at.get('classification.auto_accept_confidence')).toBe(0.8);
    expect(at.get('classification.low_value_skip_czk')).toBe(100);
    expect(at.get('classification.max_questions_per_document')).toBe(2);
    expect(at.get('classification.max_service_period_days_for_end')).toBe(62);
    expect(rules.at('2024-12-31').has('fx.max_lookback_days')).toBe(false);
  });
});

describe('EPO row map and KH routing (brief 0310)', () => {
  it('resolve in both years and parse with the strict schemas', () => {
    for (const date of ['2025-01-01', '2025-12-31', '2026-01-01', '2026-10-26']) {
      const at = rules.at(date);
      const rows = parseDphdp3RowMap(at.get('epo.dphdp3_row_map'));
      expect(rows).toHaveLength(19);
      expect(rows.map((r) => r.row)).toContain('5');
      const kh = parseKhRouting(at.get('epo.kh_routing'));
      expect(kh.version).toBe(1);
      expect(kh.rules.length).toBeGreaterThan(0);
    }
    expect(rules.at('2024-12-31').has('epo.dphdp3_row_map')).toBe(false);
  });

  it('the seeded entries carry a primary-source URL and the 2026-10-26 verification', () => {
    for (const entry of CZ_RULE_ENTRIES.filter(
      (e) => e.key === 'epo.dphdp3_row_map' || e.key === 'epo.kh_routing',
    )) {
      expect(entry.layer).toBe('base');
      expect(entry.verified_at).toBe('2026-10-26');
      expect(['adisspr.mfcr.cz', 'financnisprava.gov.cz']).toContain(
        new URL(entry.source).hostname,
      );
    }
  });
});

describe('Phase 3 VAT seeds (0328)', () => {
  const at = rules.at(parseLegalDate('2026-09-15'));
  it('simple-period policy 2026.1 forbids EU goods for an IO and allows them for a payer', () => {
    const p = at.get('vat.simple_period_policy') as typeof CZ_SIMPLE_PERIOD_POLICY;
    expect(p.version).toBe('2026.1');
    expect(p.allowed_treatments.identifikovana_osoba).not.toContain('rcv_eu_goods_acquisition');
    expect(p.allowed_treatments.platce).toContain('rcv_eu_goods_acquisition');
    expect(p.max_docs).toBe(150);
  });
  it('rounding and windows', () => {
    expect(at.get('vat.return_rounding')).toBe('sum_entries_then_round');
    expect(at.get('vat.shv_rounding')).toBe('ceil');
    expect(at.get('vat.amendment_windows')).toEqual({
      dp3_dodatecne_due: 'end_of_month_after_discovery',
      kh_nasledne_working_days: 5,
    });
  });
  it('epo.forms carries the 11. 8. 2026 versions', () => {
    const f = at.get('epo.forms') as typeof CZ_EPO_FORMS;
    expect(f.DPHDP3.version).toBe('03.01.04');
    expect(f.DPHKH1.version).toBe('03.01.15');
    expect(f.DPHSHV.version).toBe('02.01.05');
    expect(rules.at(parseLegalDate('2025-06-01')).get('vat.return_rounding')).toBe(
      'sum_entries_then_round',
    );
  });
});

describe('income tax and insurance rates (M06, 06 §2.1)', () => {
  it('income_tax.rates: 15 % / 23 %, threshold 1 676 052 (2025) and 1 762 812 (2026)', () => {
    expect(rules.at('2025-12-31').get('income_tax.rates')).toEqual({
      r1: 15,
      r2: 23,
      threshold_annual: 1_676_052,
    });
    expect(rules.at('2026-01-01').get('income_tax.rates')).toEqual({
      r1: 15,
      r2: 23,
      threshold_annual: 1_762_812,
    });
  });
  it('income_tax.credits.taxpayer: 30 840 Kč in both years', () => {
    for (const date of ['2025-06-30', '2026-06-30']) {
      expect(rules.at(date).get('income_tax.credits')).toEqual({ taxpayer: 30_840 });
    }
  });
  it('insurance.rates: social 29,2 % of 55 %, health 13,5 % of 50 %', () => {
    for (const date of ['2025-01-01', '2026-12-31']) {
      expect(rules.at(date).get('insurance.rates')).toEqual({
        social_pct: 29.2,
        social_base_pct: 55,
        health_pct: 13.5,
        health_base_pct: 50,
      });
    }
  });
});
