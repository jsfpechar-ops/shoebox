import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import { Money } from '../src/money/index';
import { createCzRules } from '../src/rules/index';
import {
  classifyPeriod,
  type PeriodClassifierInput,
  type PeriodDocument,
  type PeriodLine,
  type SimpleCheckCode,
} from '../src/vat/classify-period';
import type { VatLedgerEntryDraft } from '../src/vat/ledger';

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

const rules = createCzRules();
const d = parseLegalDate;
const czk = (s: string) => Money.parse(s, 'CZK');
const AUG = { start: d('2026-08-01'), end: d('2026-08-31') };
export const entry = (
  o: Partial<VatLedgerEntryDraft> & { documentId: string },
): VatLedgerEntryDraft => ({
  periodStart: AUG.start,
  periodEnd: AUG.end,
  vatPointDate: d('2026-08-03'),
  vatPointRule: 'issue_date',
  lineId: null,
  vatTreatment: 'rcv_eu_service_reverse_charge',
  vatRateType: 'standard',
  vatRatePct: 21,
  baseCzk: czk('13699.77'),
  vatCzk: czk('2876.95'),
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
  ...o,
});
export const line = (o: Partial<PeriodLine> = {}): PeriodLine => ({
  lineType: 'item',
  vatTreatment: 'rcv_eu_service_reverse_charge',
  vatRateType: 'standard',
  businessSharePct: '100',
  rcCommodityCode: null,
  categoryCode: 'exp_software_saas',
  linkedIssuedInvoiceId: null,
  ...o,
});
export const doc = (o: Partial<PeriodDocument> & { documentId: string }): PeriodDocument => ({
  class: 'received_invoice',
  status: 'finalized',
  taxDocStatus: 'foreign_document',
  businessFlag: 'business',
  vatPointDate: d('2026-08-03'),
  correctsDocumentId: null,
  correctsVatPointDate: null,
  partner: { dic: null, vatId: 'NL805734958B01', vatIdValid: true, documentShowsDic: false },
  lines: [line()],
  hasBlockingValidation: false,
  ...o,
});
const IO_PROFILE = [
  {
    validFrom: d('2026-01-01'),
    validTo: null,
    vatStatus: 'identifikovana_osoba' as const,
    vatPeriod: 'monthly' as const,
    entityType: 'osvc' as const,
  },
];
const PAYER_PROFILE = [{ ...must(IO_PROFILE[0]), vatStatus: 'platce' as const }];
export const io = (o: Partial<PeriodClassifierInput> = {}): PeriodClassifierInput => ({
  status: 'identifikovana_osoba',
  period: AUG,
  entries: [entry({ documentId: 'b' })],
  documents: [doc({ documentId: 'b' })],
  profiles: IO_PROFILE,
  ledgerIssues: [],
  evaluatedAt: '2026-09-20T10:00:00Z',
  ...o,
});
export const payer = (o: Partial<PeriodClassifierInput> = {}): PeriodClassifierInput =>
  io({
    status: 'platce',
    profiles: PAYER_PROFILE,
    entries: [entry({ documentId: 'b', dphdp3Rows: ['5', '43'], khSection: 'A2' })],
    ...o,
  });
const failing = (r: ReturnType<typeof classifyPeriod>) =>
  r.checks.filter((c) => c.outcome !== 'pass').map((c) => c.code);
const check = (r: ReturnType<typeof classifyPeriod>, code: SimpleCheckCode) =>
  must(r.checks.find((c) => c.code === code));

describe('classifyPeriod: verdicts', () => {
  it('golden August IO → simple; every code present once; metadata', () => {
    const r = classifyPeriod(io(), rules);
    expect(r.verdict).toBe('simple');
    expect(failing(r)).toEqual([]);
    expect(new Set(r.checks.map((c) => c.code)).size).toBe(r.checks.length);
    expect(r.checks.length).toBe(24);
    expect(r).toMatchObject({
      policyVersion: '2026.2',
      rulesDate: '2026-08-01',
      evaluatedAt: '2026-09-20T10:00:00Z',
    });
  });
  it('IO with no return rows and no SH → nothing_to_file; with an SH entry → simple', () => {
    expect(classifyPeriod(io({ entries: [], documents: [] }), rules).verdict).toBe(
      'nothing_to_file',
    );
    expect(
      classifyPeriod(
        io({
          entries: [
            entry({
              documentId: 'b',
              vatTreatment: 'iss_no_vat',
              dphdp3Rows: [],
              shvCode: 3,
              vatCzk: czk('0.00'),
            }),
          ],
          documents: [
            doc({
              documentId: 'b',
              class: 'issued_invoice',
              lines: [line({ vatTreatment: 'iss_no_vat' })],
            }),
          ],
        }),
        rules,
      ).verdict,
    ).toBe('simple');
  });
  it('payer with no entries → simple (nil return), never nothing_to_file', () => {
    expect(classifyPeriod(payer({ entries: [], documents: [] }), rules).verdict).toBe('simple');
  });
  it('precedence: needs_accountant beats not_ready', () => {
    const r = classifyPeriod(
      io({
        entries: [entry({ documentId: 'b', vatPointDate: d('2025-12-15') })],
        documents: [doc({ documentId: 'b', class: 'received_advance_tax_doc' })],
      }),
      rules,
    );
    expect(r.verdict).toBe('needs_accountant');
    expect(failing(r)).toEqual(
      expect.arrayContaining(['S_ENTRY_BEFORE_STATUS', 'S_FORBIDDEN_CLASS']),
    );
  });
});

describe('needs_accountant checks (M05 §9 #7, #9)', () => {
  it('S_PROFILE_UNSUPPORTED: neplatce or sro', () => {
    expect(
      check(classifyPeriod(io({ status: 'neplatce' }), rules), 'S_PROFILE_UNSUPPORTED').outcome,
    ).toBe('needs_accountant');
    expect(
      check(
        classifyPeriod(io({ profiles: [{ ...must(IO_PROFILE[0]), entityType: 'sro' }] }), rules),
        'S_PROFILE_UNSUPPORTED',
      ).outcome,
    ).toBe('needs_accountant');
  });
  it('S_PROFILE_CHANGED_IN_PERIOD: status flips mid-month; a version ending before the period is ignored', () => {
    const flip = [
      { ...must(IO_PROFILE[0]), validTo: d('2026-08-14') },
      { ...must(PAYER_PROFILE[0]), validFrom: d('2026-08-15') },
    ];
    expect(
      check(classifyPeriod(io({ profiles: flip }), rules), 'S_PROFILE_CHANGED_IN_PERIOD').outcome,
    ).toBe('needs_accountant');
    const old = [
      { ...must(PAYER_PROFILE[0]), validTo: d('2026-07-31') },
      { ...must(IO_PROFILE[0]), validFrom: d('2026-08-01') },
    ];
    expect(
      check(classifyPeriod(io({ profiles: old }), rules), 'S_PROFILE_CHANGED_IN_PERIOD').outcome,
    ).toBe('pass');
  });
  it('S_ENTRY_BEFORE_STATUS (not_ready) names the document and the earliest date', () => {
    const r = classifyPeriod(
      io({ profiles: [{ ...must(IO_PROFILE[0]), validFrom: d('2026-08-10') }] }),
      rules,
    );
    expect(check(r, 'S_ENTRY_BEFORE_STATUS')).toEqual({
      code: 'S_ENTRY_BEFORE_STATUS',
      outcome: 'not_ready',
      documentIds: ['b'],
      params: { earliest: '2026-08-10' },
    });
    expect(r.verdict).toBe('not_ready');
  });
  it('S_TREATMENT_NOT_ALLOWED: IO with EU goods (#9); payer allows it', () => {
    const goods = (p: typeof io) =>
      p({
        entries: [
          entry({ documentId: 'g', vatTreatment: 'rcv_eu_goods_acquisition', dphdp3Rows: ['3'] }),
        ],
        documents: [
          doc({ documentId: 'g', lines: [line({ vatTreatment: 'rcv_eu_goods_acquisition' })] }),
        ],
      });
    expect(check(classifyPeriod(goods(io), rules), 'S_TREATMENT_NOT_ALLOWED')).toMatchObject({
      outcome: 'needs_accountant',
      documentIds: ['g'],
      params: { treatment: 'rcv_eu_goods_acquisition' },
    });
    expect(check(classifyPeriod(goods(payer), rules), 'S_TREATMENT_NOT_ALLOWED').outcome).toBe(
      'pass',
    );
  });
  it('S_RC_COMMODITY and S_FORBIDDEN_CLASS (class and line type)', () => {
    expect(
      check(
        classifyPeriod(
          io({ documents: [doc({ documentId: 'b', lines: [line({ rcCommodityCode: '4' })] })] }),
          rules,
        ),
        'S_RC_COMMODITY',
      ).outcome,
    ).toBe('needs_accountant');
    expect(
      check(
        classifyPeriod(
          io({ documents: [doc({ documentId: 'b', class: 'received_advance_tax_doc' })] }),
          rules,
        ),
        'S_FORBIDDEN_CLASS',
      ).documentIds,
    ).toEqual(['b']);
    expect(
      check(
        classifyPeriod(
          io({
            documents: [doc({ documentId: 'b', lines: [line({ lineType: 'advance_deduction' })] })],
          }),
          rules,
        ),
        'S_FORBIDDEN_CLASS',
      ).outcome,
    ).toBe('needs_accountant');
  });
  it('S_EU_GOODS_MULTI_RATE: two rates on one EU goods document', () => {
    const two = payer({
      entries: [
        entry({
          documentId: 'g',
          vatTreatment: 'rcv_eu_goods_acquisition',
          dphdp3Rows: ['3', '43'],
        }),
        entry({
          documentId: 'g',
          vatTreatment: 'rcv_eu_goods_acquisition',
          vatRateType: 'reduced',
          vatRatePct: 12,
          dphdp3Rows: ['4', '44'],
        }),
      ],
      documents: [doc({ documentId: 'g' })],
    });
    expect(check(classifyPeriod(two, rules), 'S_EU_GOODS_MULTI_RATE').outcome).toBe(
      'needs_accountant',
    );
    expect(
      check(
        classifyPeriod(payer({ entries: [must(two.entries[0])], documents: two.documents }), rules),
        'S_EU_GOODS_MULTI_RATE',
      ).outcome,
    ).toBe('pass');
  });
  it('S_PRIOR_PERIOD_CREDIT_NOTE: corrects a July document; same-period correction passes', () => {
    const cn = (when: string) =>
      io({
        entries: [
          entry({ documentId: 'b' }),
          entry({ documentId: 'cn', baseCzk: czk('-1000.00'), vatCzk: czk('-210.00') }),
        ],
        documents: [
          doc({ documentId: 'b' }),
          doc({
            documentId: 'cn',
            class: 'received_credit_note',
            correctsDocumentId: 'x',
            correctsVatPointDate: d(when),
          }),
        ],
      });
    expect(
      check(classifyPeriod(cn('2026-07-15'), rules), 'S_PRIOR_PERIOD_CREDIT_NOTE'),
    ).toMatchObject({ outcome: 'needs_accountant', documentIds: ['cn'] });
    expect(
      check(classifyPeriod(cn('2026-08-02'), rules), 'S_PRIOR_PERIOD_CREDIT_NOTE').outcome,
    ).toBe('pass');
  });
  it('S_PARTIAL_SHARE_DEDUCTION: allowed by policy 2026.2 (§ 75 computed); payer and IO pass', () => {
    const docs = [
      doc({
        documentId: 'b',
        lines: [line({ vatTreatment: 'rcv_domestic_vat', businessSharePct: '60' })],
      }),
    ];
    expect(
      check(classifyPeriod(payer({ documents: docs }), rules), 'S_PARTIAL_SHARE_DEDUCTION').outcome,
    ).toBe('pass');
    expect(
      check(classifyPeriod(io({ documents: docs }), rules), 'S_PARTIAL_SHARE_DEDUCTION').outcome,
    ).toBe('pass');
  });
  it('S_PLATFORM_INCOME_PAYER: platform statement income without a linked issued invoice', () => {
    const ps = (linked: string | null) =>
      payer({
        documents: [
          doc({ documentId: 'b' }),
          doc({
            documentId: 'p',
            class: 'platform_statement',
            lines: [
              line({
                vatTreatment: 'iss_domestic_vat',
                categoryCode: 'income_services',
                linkedIssuedInvoiceId: linked,
              }),
            ],
          }),
        ],
      });
    expect(check(classifyPeriod(ps(null), rules), 'S_PLATFORM_INCOME_PAYER').documentIds).toEqual([
      'p',
    ]);
    expect(check(classifyPeriod(ps('inv-1'), rules), 'S_PLATFORM_INCOME_PAYER').outcome).toBe(
      'pass',
    );
  });
  it('S_IO_OUTPUT_VAT (#9) and S_IO_NEGATIVE_TAX (TA-11)', () => {
    expect(
      check(
        classifyPeriod(
          io({
            documents: [
              doc({ documentId: 'b', lines: [line({ vatTreatment: 'iss_domestic_vat' })] }),
            ],
          }),
          rules,
        ),
        'S_IO_OUTPUT_VAT',
      ).outcome,
    ).toBe('needs_accountant');
    expect(
      check(
        classifyPeriod(
          payer({
            documents: [
              doc({ documentId: 'b', lines: [line({ vatTreatment: 'iss_domestic_vat' })] }),
            ],
          }),
          rules,
        ),
        'S_IO_OUTPUT_VAT',
      ).outcome,
    ).toBe('pass');
    const neg = io({
      entries: [
        entry({ documentId: 'b' }),
        entry({ documentId: 'cn', baseCzk: czk('-20000.00'), vatCzk: czk('-4200.00') }),
      ],
      documents: [
        doc({ documentId: 'b' }),
        doc({
          documentId: 'cn',
          class: 'received_credit_note',
          correctsDocumentId: 'b',
          correctsVatPointDate: d('2026-08-03'),
        }),
      ],
    });
    expect(check(classifyPeriod(neg, rules), 'S_IO_NEGATIVE_TAX')).toMatchObject({
      outcome: 'needs_accountant',
      params: { sumVatCzk: '-1323.05' },
    });
  });
  it('S_MAX_DOCS: 151 documents with entries → needs_accountant', () => {
    const ids = Array.from({ length: 151 }, (_, i) => `d${i}`);
    const r = classifyPeriod(
      io({
        entries: ids.map((id) => entry({ documentId: id })),
        documents: ids.map((id) => doc({ documentId: id })),
      }),
      rules,
    );
    expect(check(r, 'S_MAX_DOCS')).toMatchObject({
      outcome: 'needs_accountant',
      params: { count: 151, max: 150 },
    });
  });
});
