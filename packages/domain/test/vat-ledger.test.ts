import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import type { FxRateRow } from '../src/fx';
import { Money } from '../src/money/index';
import { createCzRules } from '../src/rules/index';
import {
  buildVatLedgerEntries,
  type VatLedgerDocument,
  type VatLedgerEntryDraft,
  type VatLedgerInput,
  type VatLedgerLine,
  type VatLedgerPartner,
} from '../src/vat/ledger';
import type { VatProfileSlice } from '../src/vat/point-date';

const rules = createCzRules();
const d = parseLegalDate;
const czk = (s: string) => Money.parse(s, 'CZK');

const IO: VatProfileSlice = {
  vatStatus: 'identifikovana_osoba',
  vatPeriod: null,
  foreignServiceDppdPolicy: 'issue_date',
};
const IO_SPE: VatProfileSlice = { ...IO, foreignServiceDppdPolicy: 'service_period_end' };
const PAYER_M: VatProfileSlice = {
  vatStatus: 'platce',
  vatPeriod: 'monthly',
  foreignServiceDppdPolicy: 'service_period_end',
};
const PAYER_Q: VatProfileSlice = { ...PAYER_M, vatPeriod: 'quarterly' };
const NONPAYER: VatProfileSlice = {
  vatStatus: 'neplatce',
  vatPeriod: null,
  foreignServiceDppdPolicy: 'issue_date',
};
const at = (profile: VatProfileSlice) => () => profile;

// Synthetic ČNB fixture (not real values). 2026-10-03/04 is a weekend.
const RATES: FxRateRow[] = [
  { rateDate: d('2026-10-01'), currency: 'USD', amount: 1, rate: '23.400000' },
  { rateDate: d('2026-10-02'), currency: 'USD', amount: 1, rate: '23.456000' },
  { rateDate: d('2026-10-05'), currency: 'USD', amount: 1, rate: '23.500000' },
  { rateDate: d('2026-10-15'), currency: 'EUR', amount: 1, rate: '24.580000' },
];

const BOOKING: VatLedgerPartner = {
  country: 'NL',
  dic: null,
  vatId: 'NL805734958B01',
  vatIdValid: true,
};
const CLOUDFLARE: VatLedgerPartner = { country: 'US', dic: null, vatId: null, vatIdValid: null };
const ANTHROPIC: VatLedgerPartner = {
  country: 'IE',
  dic: null,
  vatId: 'IE3797893MH',
  vatIdValid: true,
};
const MANAGER: VatLedgerPartner = {
  country: 'CZ',
  dic: 'CZ12345678',
  vatId: null,
  vatIdValid: null,
};
const CZ_NO_DIC: VatLedgerPartner = { country: 'CZ', dic: null, vatId: null, vatIdValid: null };

let seq = 0;
function line(over: Partial<VatLedgerLine>): VatLedgerLine {
  seq += 1;
  return {
    lineId: `line-${seq}`,
    position: seq,
    lineType: 'item',
    net: czk('0'),
    vat: czk('0'),
    gross: czk('0'),
    vatTreatment: 'rcv_eu_service_reverse_charge',
    vatRateType: 'standard',
    categoryCode: 'exp_platform_commission',
    businessSharePct: '100',
    ...over,
  };
}

/** Booking July invoice (AC-9c): issued 3 Aug 2026 for 1–31 July, 13 699,77 CZK, no VAT printed. */
function booking(over: Partial<VatLedgerDocument> = {}): VatLedgerDocument {
  return {
    documentId: 'doc-booking-jul',
    class: 'received_invoice',
    direction: 'in',
    status: 'ready',
    deleted: false,
    businessFlag: 'business',
    taxDocStatus: 'full_tax_document',
    currency: 'CZK',
    documentNumber: ' 1234567890 ',
    issueDate: d('2026-08-03'),
    duzp: null,
    receivedDate: null,
    servicePeriodFrom: d('2026-07-01'),
    servicePeriodTo: d('2026-07-31'),
    paidAt: null,
    userVatPointDate: null,
    totalGross: czk('13699.77'),
    lines: [
      line({
        net: czk('12345.67'),
        gross: czk('12345.67'),
        categoryCode: 'exp_platform_commission',
      }),
      line({ net: czk('1354.10'), gross: czk('1354.10'), categoryCode: 'exp_payment_fees' }),
    ],
    recap: [],
    ...over,
  };
}

/** Property-manager invoice (AC-9b): CZ payer, 21 % printed, 12 960,84 incl. VAT. */
function manager(over: Partial<VatLedgerDocument> = {}): VatLedgerDocument {
  return {
    ...booking({
      documentId: 'doc-manager',
      documentNumber: '2026090001',
      issueDate: d('2026-09-02'),
      duzp: d('2026-09-02'),
      receivedDate: d('2026-09-02'),
      servicePeriodFrom: null,
      servicePeriodTo: null,
      totalGross: czk('12960.84'),
    }),
    lines: [
      line({
        net: czk('10711.44'),
        vat: czk('2249.40'),
        gross: czk('12960.84'),
        vatTreatment: 'rcv_domestic_vat',
        categoryCode: 'exp_property_management',
      }),
    ],
    recap: [
      { vatRateType: 'standard', vatRatePct: 21, base: czk('10711.44'), vat: czk('2249.40') },
    ],
    ...over,
  };
}

function build(
  doc: VatLedgerDocument,
  partner: VatLedgerPartner,
  profile: VatProfileSlice,
  over: Partial<VatLedgerInput> = {},
) {
  return buildVatLedgerEntries({
    doc,
    partner,
    profileAt: at(profile),
    payments: [],
    fxRates: RATES,
    deductionAllowed: true,
    rules,
    ...over,
  });
}

const view = (e: VatLedgerEntryDraft) => ({
  ...e,
  baseCzk: e.baseCzk.toFixed2(),
  vatCzk: e.vatCzk.toFixed2(),
  baseForeign: e.baseForeign?.toFixed2() ?? null,
  khDocumentTotalCzk: e.khDocumentTotalCzk?.toFixed2() ?? null,
});

describe('buildVatLedgerEntries: Booking (AC-9c, AC-9d, AC-11)', () => {
  it('IO, policy issue_date: one grouped entry in 2026-08, row 5, no KH', () => {
    const { entries, issues } = build(booking(), BOOKING, IO);
    expect(issues).toEqual([]);
    expect(entries).toHaveLength(1);
    expect(view(entries[0] as VatLedgerEntryDraft)).toEqual({
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      vatPointDate: '2026-08-03',
      vatPointRule: 'issue_date',
      documentId: 'doc-booking-jul',
      lineId: null,
      vatTreatment: 'rcv_eu_service_reverse_charge',
      vatRateType: 'standard',
      vatRatePct: 21,
      baseCzk: '13699.77',
      vatCzk: '2876.95',
      deductionPct: '100',
      currency: 'CZK',
      baseForeign: null,
      fxRate: null,
      fxAmount: null,
      fxRateDate: null,
      dphdp3Rows: ['5'],
      khSection: null,
      khDocumentTotalCzk: null,
      shvCode: null,
      counterpartyVatId: 'NL805734958B01',
      evidenceNumber: '1234567890',
    });
  });

  it('IO, policy service_period_end: 2026-07', () => {
    const { entries } = build(booking(), BOOKING, IO_SPE);
    expect(
      entries.map((e) => [e.periodStart, e.periodEnd, e.vatPointDate, e.vatPointRule]),
    ).toEqual([['2026-07-01', '2026-07-31', '2026-07-31', 'service_period_end']]);
  });

  it('payer monthly: rows 5+43, KH A2 on the document total; quarterly: Q3 period', () => {
    const m = build(booking(), BOOKING, PAYER_M).entries;
    expect(m).toHaveLength(1);
    expect(view(m[0] as VatLedgerEntryDraft)).toMatchObject({
      periodStart: '2026-07-01',
      periodEnd: '2026-07-31',
      dphdp3Rows: ['5', '43'],
      khSection: 'A2',
      khDocumentTotalCzk: '13699.77',
      baseCzk: '13699.77',
      vatCzk: '2876.95',
    });
    const q = build(booking(), BOOKING, PAYER_Q).entries;
    expect(q.map((e) => [e.periodStart, e.periodEnd])).toEqual([['2026-07-01', '2026-09-30']]);
  });

  it('Booking August: 11 549,94 → 2 425,49; period 2026-09 (issue_date) or 2026-08 (service_period_end)', () => {
    const aug = booking({
      documentId: 'doc-booking-aug',
      issueDate: d('2026-09-03'),
      servicePeriodFrom: d('2026-08-01'),
      servicePeriodTo: d('2026-08-31'),
      totalGross: czk('11549.94'),
      lines: [line({ net: czk('11549.94'), gross: czk('11549.94') })],
    });
    const io = build(aug, BOOKING, IO).entries;
    expect(io.map((e) => [e.periodStart, e.baseCzk.toFixed2(), e.vatCzk.toFixed2()])).toEqual([
      ['2026-09-01', '11549.94', '2425.49'],
    ]);
    expect(build(aug, BOOKING, IO_SPE).entries.map((e) => e.periodStart)).toEqual(['2026-08-01']);
  });

  it('text lines and share-0 lines are skipped; the group total is unchanged', () => {
    const doc = booking();
    const noisy = booking({
      lines: [
        ...doc.lines,
        line({ lineType: 'text', net: null, vat: null, gross: null }),
        line({ net: czk('500.00'), gross: czk('500.00'), businessSharePct: '0' }),
      ],
    });
    const { entries } = build(noisy, BOOKING, IO);
    expect(entries.map((e) => e.baseCzk.toFixed2())).toEqual(['13699.77']);
  });

  it('credit note: negative entry, KH tested on the absolute value', () => {
    const cn = booking({
      documentId: 'doc-cn',
      class: 'received_credit_note',
      totalGross: czk('-1000.00'),
      lines: [line({ net: czk('-1000.00'), gross: czk('-1000.00') })],
    });
    expect(view(build(cn, BOOKING, PAYER_M).entries[0] as VatLedgerEntryDraft)).toMatchObject({
      baseCzk: '-1000.00',
      vatCzk: '-210.00',
      khSection: 'A2',
      khDocumentTotalCzk: '1000.00',
      dphdp3Rows: ['5', '43'],
    });
    expect(view(build(cn, BOOKING, IO).entries[0] as VatLedgerEntryDraft)).toMatchObject({
      baseCzk: '-1000.00',
      vatCzk: '-210.00',
      khSection: null,
      khDocumentTotalCzk: null,
    });
  });
});

describe('foreign currency (AC-9e, AC-9f)', () => {
  const cloudflare = booking({
    documentId: 'doc-cloudflare',
    currency: 'USD',
    documentNumber: 'CF-1',
    issueDate: d('2026-10-03'),
    servicePeriodFrom: null,
    servicePeriodTo: null,
    totalGross: Money.parse('10.46', 'USD'),
    lines: [
      line({
        net: Money.parse('10.46', 'USD'),
        gross: Money.parse('10.46', 'USD'),
        vatTreatment: 'rcv_non_eu_service_reverse_charge',
        categoryCode: 'exp_hosting_domains',
      }),
    ],
  });
  const anthropic = booking({
    documentId: 'doc-anthropic',
    currency: 'EUR',
    documentNumber: 'INV-90',
    issueDate: d('2026-10-15'),
    servicePeriodFrom: null,
    servicePeriodTo: null,
    totalGross: Money.parse('90.00', 'EUR'),
    lines: [
      line({
        net: Money.parse('90.00', 'EUR'),
        gross: Money.parse('90.00', 'EUR'),
        categoryCode: 'exp_software_saas',
      }),
    ],
  });

  it('Cloudflare $10.46 on a Saturday uses Friday’s rate: 245,35 / 51,52, row 12', () => {
    const { entries, issues } = build(cloudflare, CLOUDFLARE, IO);
    expect(issues).toEqual([]);
    expect(view(entries[0] as VatLedgerEntryDraft)).toMatchObject({
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      vatPointDate: '2026-10-03',
      vatPointRule: 'issue_date',
      vatTreatment: 'rcv_non_eu_service_reverse_charge',
      baseCzk: '245.35',
      vatCzk: '51.52',
      currency: 'USD',
      baseForeign: '10.46',
      fxRate: '23.456000',
      fxAmount: 1,
      fxRateDate: '2026-10-02',
      dphdp3Rows: ['12'],
      khSection: null,
      shvCode: null,
      counterpartyVatId: null,
      evidenceNumber: 'CF-1',
    });
  });

  it('Anthropic €90: 2 212,20 / 464,56, row 5, period 2026-10; payer adds row 43 and A2', () => {
    expect(view(build(anthropic, ANTHROPIC, IO).entries[0] as VatLedgerEntryDraft)).toMatchObject({
      periodStart: '2026-10-01',
      baseCzk: '2212.20',
      vatCzk: '464.56',
      baseForeign: '90.00',
      fxRate: '24.580000',
      fxRateDate: '2026-10-15',
      dphdp3Rows: ['5'],
      counterpartyVatId: 'IE3797893MH',
    });
    expect(
      view(build(anthropic, ANTHROPIC, PAYER_M).entries[0] as VatLedgerEntryDraft),
    ).toMatchObject({ dphdp3Rows: ['5', '43'], khSection: 'A2', khDocumentTotalCzk: '2212.20' });
  });

  it('no ČNB rate within the look-back → S_FX_MISSING and no entry', () => {
    const { entries, issues } = build(anthropic, ANTHROPIC, IO, {
      fxRates: RATES.filter((r) => r.currency !== 'EUR'),
    });
    expect(entries).toEqual([]);
    expect(issues).toEqual([
      {
        code: 'S_FX_MISSING',
        vatTreatment: 'rcv_eu_service_reverse_charge',
        vatRateType: 'standard',
      },
    ]);
  });
});

describe('domestic purchases (AC-9b, AC-11)', () => {
  it('IO: a CZ invoice with VAT produces nothing', () => {
    expect(build(manager(), MANAGER, IO)).toEqual({ entries: [], issues: [] });
  });

  it('payer with deduction: row 40, B2 (12 960,84 > 10 000), base/VAT from the recap', () => {
    const { entries, issues } = build(manager(), MANAGER, PAYER_M);
    expect(issues).toEqual([]);
    expect(view(entries[0] as VatLedgerEntryDraft)).toMatchObject({
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
      vatPointDate: '2026-09-02',
      vatPointRule: 'max_duzp_received',
      vatTreatment: 'rcv_domestic_vat',
      vatRatePct: 21,
      baseCzk: '10711.44',
      vatCzk: '2249.40',
      dphdp3Rows: ['40'],
      khSection: 'B2',
      khDocumentTotalCzk: '12960.84',
      counterpartyVatId: 'CZ12345678',
      evidenceNumber: '2026090001',
    });
  });

  it('payer without deduction: nothing; ≤ 10 000 → B3; simplified document → B3; share 50 → deduction_pct 50', () => {
    expect(build(manager(), MANAGER, PAYER_M, { deductionAllowed: false }).entries).toEqual([]);
    const small = manager({
      totalGross: czk('9680.00'),
      lines: [
        line({
          net: czk('8000.00'),
          vat: czk('1680.00'),
          gross: czk('9680.00'),
          vatTreatment: 'rcv_domestic_vat',
          categoryCode: 'exp_property_management',
        }),
      ],
      recap: [
        { vatRateType: 'standard', vatRatePct: 21, base: czk('8000.00'), vat: czk('1680.00') },
      ],
    });
    expect(view(build(small, MANAGER, PAYER_M).entries[0] as VatLedgerEntryDraft)).toMatchObject({
      baseCzk: '8000.00',
      vatCzk: '1680.00',
      khSection: 'B3',
      khDocumentTotalCzk: '9680.00',
    });
    expect(
      build(manager({ taxDocStatus: 'simplified_tax_document' }), MANAGER, PAYER_M).entries[0]
        ?.khSection,
    ).toBe('B3');
    const m = manager();
    const half = manager({ lines: [{ ...(m.lines[0] as VatLedgerLine), businessSharePct: '50' }] });
    expect(view(build(half, MANAGER, PAYER_M).entries[0] as VatLedgerEntryDraft)).toMatchObject({
      deductionPct: '50',
      baseCzk: '10711.44',
      vatCzk: '2249.40',
    });
  });

  it('recap row missing → Σ lines; mixed treatments at one rate → S_MIXED_TREATMENT_SAME_RATE', () => {
    expect(build(manager({ recap: [] }), MANAGER, PAYER_M).entries[0]?.baseCzk.toFixed2()).toBe(
      '10711.44',
    );
    const m = manager();
    const mixed = manager({
      lines: [
        m.lines[0] as VatLedgerLine,
        line({
          net: czk('100.00'),
          vat: czk('21.00'),
          gross: czk('121.00'),
          vatTreatment: 'rcv_foreign_vat_charged',
          categoryCode: 'exp_other_deductible',
        }),
      ],
    });
    const { entries, issues } = build(mixed, MANAGER, PAYER_M);
    expect(entries).toEqual([]);
    expect(issues).toEqual([
      {
        code: 'S_MIXED_TREATMENT_SAME_RATE',
        vatTreatment: 'rcv_domestic_vat',
        vatRateType: 'standard',
      },
    ]);
  });
});

describe('issued documents', () => {
  const issued = booking({
    documentId: 'doc-issued',
    class: 'issued_invoice',
    direction: 'out',
    documentNumber: '2026-0042',
    issueDate: d('2026-09-10'),
    duzp: d('2026-09-10'),
    servicePeriodFrom: null,
    servicePeriodTo: null,
    totalGross: czk('12100.00'),
    lines: [
      line({
        net: czk('10000.00'),
        vat: czk('2100.00'),
        gross: czk('12100.00'),
        vatTreatment: 'iss_domestic_vat',
        categoryCode: 'income_services',
      }),
    ],
    recap: [
      { vatRateType: 'standard', vatRatePct: 21, base: czk('10000.00'), vat: czk('2100.00') },
    ],
  });

  it('payer, CZ customer with DIČ: row 1, A4; without DIČ: A5; IO: nothing', () => {
    expect(view(build(issued, MANAGER, PAYER_M).entries[0] as VatLedgerEntryDraft)).toMatchObject({
      vatPointDate: '2026-09-10',
      vatPointRule: 'duzp',
      dphdp3Rows: ['1'],
      khSection: 'A4',
      khDocumentTotalCzk: '12100.00',
      baseCzk: '10000.00',
      vatCzk: '2100.00',
      counterpartyVatId: 'CZ12345678',
      evidenceNumber: '2026-0042',
    });
    expect(build(issued, CZ_NO_DIC, PAYER_M).entries[0]?.khSection).toBe('A5');
    expect(build(issued, MANAGER, IO).entries).toEqual([]);
  });

  it('payer EU B2B service: row 21, VAT 0, SH code 3, no KH', () => {
    const eu = booking({
      documentId: 'doc-eu',
      class: 'issued_invoice',
      direction: 'out',
      documentNumber: 'EU-1',
      issueDate: d('2026-09-10'),
      duzp: d('2026-09-10'),
      servicePeriodFrom: null,
      servicePeriodTo: null,
      totalGross: czk('5000.00'),
      lines: [
        line({
          net: czk('5000.00'),
          gross: czk('5000.00'),
          vatTreatment: 'iss_eu_service',
          vatRateType: 'zero',
          categoryCode: 'income_services',
        }),
      ],
    });
    expect(view(build(eu, ANTHROPIC, PAYER_M).entries[0] as VatLedgerEntryDraft)).toMatchObject({
      dphdp3Rows: ['21'],
      vatRateType: 'zero',
      vatRatePct: 0,
      baseCzk: '5000.00',
      vatCzk: '0.00',
      shvCode: 3,
      khSection: null,
      counterpartyVatId: 'IE3797893MH',
    });
  });

  it('IO service to an EU VAT payer (iss_no_vat, income_services): SH code 3, no DPHDP3 row; otherwise nothing', () => {
    const io = booking({
      documentId: 'doc-io-eu',
      class: 'issued_invoice',
      direction: 'out',
      documentNumber: 'IO-1',
      issueDate: d('2026-09-10'),
      servicePeriodFrom: null,
      servicePeriodTo: null,
      totalGross: czk('5000.00'),
      lines: [
        line({
          net: czk('5000.00'),
          gross: czk('5000.00'),
          vatTreatment: 'iss_no_vat',
          vatRateType: 'none',
          categoryCode: 'income_services',
        }),
      ],
    });
    expect(view(build(io, ANTHROPIC, IO).entries[0] as VatLedgerEntryDraft)).toMatchObject({
      dphdp3Rows: [],
      shvCode: 3,
      vatRatePct: 0,
      baseCzk: '5000.00',
      vatCzk: '0.00',
      khSection: null,
    });
    expect(build(io, { ...ANTHROPIC, vatIdValid: false }, IO).entries).toEqual([]);
    expect(build(io, CLOUDFLARE, IO).entries).toEqual([]);
    const accommodation = {
      ...io,
      lines: [{ ...(io.lines[0] as VatLedgerLine), categoryCode: 'income_accommodation' as const }],
    };
    expect(build(accommodation, ANTHROPIC, IO).entries).toEqual([]);
  });
});

describe('gates and issues', () => {
  it('neplatce, personal, not ready, deleted, non-bookable class → nothing', () => {
    expect(build(booking(), BOOKING, NONPAYER)).toEqual({ entries: [], issues: [] });
    expect(build(booking({ businessFlag: 'personal' }), BOOKING, IO)).toEqual({
      entries: [],
      issues: [],
    });
    expect(build(booking({ status: 'needs_review' }), BOOKING, IO)).toEqual({
      entries: [],
      issues: [],
    });
    expect(build(booking({ deleted: true }), BOOKING, IO)).toEqual({ entries: [], issues: [] });
    expect(build(booking({ class: 'other_supporting' }), BOOKING, IO)).toEqual({
      entries: [],
      issues: [],
    });
    expect(build(booking({ status: 'finalized' }), BOOKING, IO).entries).toHaveLength(1);
  });

  it('no usable date → S_DATE_MISSING; self-assessed with rate none → S_SELF_ASSESSED_RATE_UNKNOWN', () => {
    const undated = booking({ issueDate: null, servicePeriodFrom: null, servicePeriodTo: null });
    expect(build(undated, BOOKING, IO)).toEqual({
      entries: [],
      issues: [
        {
          code: 'S_DATE_MISSING',
          vatTreatment: 'rcv_eu_service_reverse_charge',
          vatRateType: 'standard',
        },
      ],
    });
    const b = booking();
    const none = booking({ lines: b.lines.map((l) => ({ ...l, vatRateType: 'none' as const })) });
    expect(build(none, BOOKING, IO)).toEqual({
      entries: [],
      issues: [
        {
          code: 'S_SELF_ASSESSED_RATE_UNKNOWN',
          vatTreatment: 'rcv_eu_service_reverse_charge',
          vatRateType: 'none',
        },
      ],
    });
  });

  it('evidence number is trimmed and cut to 60 characters; empty → null', () => {
    expect(
      build(booking({ documentNumber: `  ${'9'.repeat(70)}  ` }), BOOKING, IO).entries[0]
        ?.evidenceNumber,
    ).toBe('9'.repeat(60));
    expect(
      build(booking({ documentNumber: '   ' }), BOOKING, IO).entries[0]?.evidenceNumber,
    ).toBeNull();
    expect(
      build(booking({ documentNumber: null }), BOOKING, IO).entries[0]?.evidenceNumber,
    ).toBeNull();
  });

  it('no DPHDP3 row number is written in the builder (M05 §4.2 step 8)', () => {
    const src = readFileSync(new URL('../src/vat/ledger.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/'(?:[1-9]|[1-9]\d)'/);
    expect(src).not.toMatch(/10[_ ]?000/);
  });
});
