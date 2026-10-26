import type { CategorizeLineRow, CategorizeQuestionRow, DocumentForCategorize } from '@shoebox/db';
import { createCzRules, parseLegalDate } from '@shoebox/domain';
import type { CategorizeOutput } from '@shoebox/extraction';
import { describe, expect, it } from 'vitest';
import { type PlanInput, planCategorization } from '../src/categorize/plan';

const ORG = '11111111-1111-4111-8111-111111111111';
const DOC = '22222222-2222-4222-8222-222222222222';
const L1 = '33333333-3333-4333-8333-333333333331';
const L2 = '33333333-3333-4333-8333-333333333332';
const rules = createCzRules();
const today = parseLegalDate('2026-10-26');

function line(over: Partial<CategorizeLineRow> = {}): CategorizeLineRow {
  return {
    id: L1,
    position: 1,
    lineType: 'item',
    description: 'Quechua backpack',
    quantity: '1',
    net: '205.79',
    vat: '43.21',
    gross: '249.00',
    vatRateType: 'standard',
    vatRatePct: '21',
    vatTreatment: null,
    categoryCode: null,
    businessSharePct: '100',
    deductibility: null,
    coveredByDocumentId: null,
    rcCommodityCode: null,
    classificationSource: null,
    classificationConfidence: null,
    ...over,
  };
}
function doc(over: Partial<DocumentForCategorize> = {}): DocumentForCategorize {
  return {
    id: DOC,
    orgId: ORG,
    status: 'validating',
    revision: 1,
    class: 'received_receipt',
    direction: 'in',
    taxDocStatus: 'simplified_tax_document',
    issueDate: '2026-09-12',
    duzp: '2026-09-12',
    receivedDate: null,
    servicePeriodFrom: null,
    servicePeriodTo: null,
    paidAt: '2026-09-12',
    vatPointDate: null,
    currency: 'CZK',
    fxRate: null,
    fxRateDate: null,
    totalGross: '249.00',
    paymentMethod: 'card',
    isPaidPerDocument: true,
    businessFlag: 'business',
    summaryCs: null,
    partnerId: 'p1',
    partnerSnapshot: null,
    buyerSnapshot: null,
    stageVersion: {},
    orgIco: '12345678',
    orgDic: 'CZ12345678',
    orgSettings: { activity_keywords: ['short-term apartment rental'] },
    lines: [line()],
    fields: [],
    questions: [],
    partner: {
      id: 'p1',
      name: 'Decathlon',
      ico: '26151006',
      dic: 'CZ26151006',
      vatId: null,
      country: 'CZ',
      isVatPayer: true,
    },
    vendor: null,
    profiles: [
      {
        validFrom: '2026-01-01',
        validTo: null,
        vatStatus: 'identifikovana_osoba',
        vatPeriod: 'monthly',
        foreignServiceDppdPolicy: 'issue_date',
        mainActivityNace: '55.20',
      },
    ],
    fxRates: [],
    ...over,
  };
}
function llm(
  over: Partial<CategorizeOutput> = {},
  lineOver: Partial<CategorizeOutput['lines'][number]> = {},
): CategorizeOutput {
  return {
    subject: 'Backpack',
    dominantCategoryCode: 'exp_other_deductible',
    businessLikelihood: 'personal',
    personalReason: 'sports gear',
    lines: [
      {
        position: 1,
        categoryCode: 'exp_other_deductible',
        alternativeCategoryCode: 'private_expense',
        confidence: 0.55,
        supplyKind: 'goods',
        assetCandidate: false,
        mixedUseItem: false,
        placeOfSupplyAbroad: false,
        reason: 'sports gear',
        ...lineOver,
      },
    ],
    ...over,
  };
}
function plan(over: Partial<PlanInput> = {}) {
  return planCategorization({
    doc: doc(),
    llm: null,
    rules,
    today,
    model: 'claude-haiku-5-5',
    categorizeVersion: 1,
    ...over,
  });
}
const answered = (
  kind: string,
  value: string,
  lineIds: string[] = [L1],
): CategorizeQuestionRow => ({
  id: `q-${kind}`,
  kind,
  payload: {
    question: `categorize.question.${kind}`,
    params: { line_ids: lineIds },
    options: [{ value, label: 'x' }],
  },
  answer: { value },
  answeredAt: new Date('2026-10-01T00:00:00Z'),
});

describe('planCategorization', () => {
  it('asks for the LLM when a line is unresolved and builds the request for that position only', () => {
    const r = plan();
    expect(r.needsLlm).toBe(true);
    expect(r.llmRequest?.resolved).toEqual({ '1': null });
    expect(r.llmRequest?.document.direction).toBe('in');
    expect(r.llmRequest?.categories.every((c) => c.direction !== 'out')).toBe(true);
    expect(r.llmRequest?.business.vatStatus).toBe('identifikovana_osoba');
  });

  it('Decathlon (AC-9h): personal-looking → business_or_personal question, flag unknown, needs_review', () => {
    const r = plan({ llm: llm() });
    expect(r.needsLlm).toBe(false);
    expect(r.write.status).toBe('needs_review');
    expect(r.write.document.businessFlag).toBe('unknown');
    expect(r.write.questions.map((q) => q.kind)).toEqual([
      'business_or_personal',
      'which_category',
    ]);
    expect(r.write.questions[0]?.payload).toMatchObject({
      suggested: 'personal',
      params: { merchant: 'Decathlon', line_ids: [L1] },
    });
    expect(r.write.lines[0]).toMatchObject({
      lineId: L1,
      categoryCode: 'exp_other_deductible',
      vatTreatment: 'rcv_domestic_vat',
      vatRatePct: '21',
      classificationSource: 'llm',
    });
    expect(r.write.fields).toContainEqual(
      expect.objectContaining({
        fieldKey: 'lines[1].category_code',
        source: 'llm',
        valueText: 'exp_other_deductible',
      }),
    );
    expect(r.write.fields).toContainEqual(
      expect.objectContaining({
        fieldKey: 'summary.subject',
        source: 'llm',
        valueText: 'Backpack',
      }),
    );
    expect(r.write.document.summaryCs).toBe(
      'Backpack – tax-deductible expense, VAT 21 % is part of the cost',
    );
    expect(r.event.questions).toEqual(['business_or_personal', 'which_category']);
  });

  it('Decathlon answered "personal": private_expense, share 0, non_deductible, ready, no LLM', () => {
    const r = plan({
      doc: doc({
        questions: [answered('business_or_personal', 'personal')],
        fields: [
          { fieldKey: 'summary.subject', valueText: 'Backpack', valueJson: null, source: 'llm' },
        ],
      }),
    });
    expect(r.needsLlm).toBe(false);
    expect(r.write.lines[0]).toMatchObject({
      categoryCode: 'private_expense',
      businessSharePct: '0',
      deductibility: 'non_deductible',
      classificationSource: 'user',
    });
    expect(r.write.fields).toContainEqual(
      expect.objectContaining({
        fieldKey: 'lines[1].category_code',
        source: 'user',
        valueText: 'private_expense',
      }),
    );
    expect(r.write.fields).toContainEqual(
      expect.objectContaining({
        fieldKey: 'lines[1].business_share_pct',
        source: 'user',
        valueText: '0',
      }),
    );
    expect(r.write.questions).toEqual([]);
    expect(r.write.status).toBe('ready');
    expect(r.write.document.businessFlag).toBe('personal');
    expect(r.write.document.summaryCs).toBe(
      'Backpack – personal expense, not counted for the business',
    );
  });

  it('MacBook (AC-9i): durable 26 990 → exp_small_assets + question; answer 80 → partially deductible, flag mixed, ready', () => {
    const mac = doc({
      lines: [
        line({ description: 'MacBook Air 13', net: '22305.79', vat: '4684.21', gross: '26990.00' }),
      ],
      partner: {
        id: 'p2',
        name: 'Alza.cz',
        ico: '27082440',
        dic: 'CZ27082440',
        vatId: null,
        country: 'CZ',
        isVatPayer: true,
      },
      issueDate: '2026-03-10',
      duzp: '2026-03-10',
      paidAt: '2026-03-10',
    });
    const out = llm(
      {
        subject: 'MacBook Air laptop',
        businessLikelihood: 'mixed',
        dominantCategoryCode: 'exp_other_deductible',
      },
      {
        categoryCode: 'exp_other_deductible',
        confidence: 0.9,
        assetCandidate: true,
        mixedUseItem: true,
      },
    );
    const first = plan({ doc: mac, llm: out });
    expect(first.write.lines[0]).toMatchObject({
      categoryCode: 'exp_small_assets',
      businessSharePct: '100',
      deductibility: 'deductible',
    });
    expect(first.write.questions.map((q) => q.kind)).toEqual(['small_asset_business_use']);
    expect(first.write.status).toBe('needs_review');
    const second = plan({
      doc: {
        ...mac,
        questions: [answered('small_asset_business_use', '80')],
        fields: [
          {
            fieldKey: 'summary.subject',
            valueText: 'MacBook Air laptop',
            valueJson: null,
            source: 'llm',
          },
        ],
      },
      llm: out,
    });
    expect(second.write.lines[0]).toMatchObject({
      categoryCode: 'exp_small_assets',
      businessSharePct: '80',
      deductibility: 'partially_deductible',
    });
    expect(second.write.document.businessFlag).toBe('mixed');
    expect(second.write.status).toBe('ready');
    expect(second.write.document.summaryCs).toBe(
      'MacBook Air laptop – 80 % tax-deductible, VAT 21 % is part of the cost',
    );
    expect(
      second.write.fields.some(
        (f) => f.fieldKey === 'lines[1].business_share_pct' && f.source === 'derived',
      ),
    ).toBe(false);
  });

  it('cleaning (AC-9b) via vendor memory: zero LLM, no VAT, subject from the vendor hint, ready', () => {
    const r = plan({
      doc: doc({
        class: 'received_invoice',
        taxDocStatus: 'not_tax_document',
        issueDate: '2026-10-02',
        duzp: null,
        servicePeriodFrom: '2026-09-01',
        servicePeriodTo: '2026-09-30',
        lines: [
          line({
            description: 'Úklid apartmánu září',
            net: '11600.00',
            vat: null,
            gross: '11600.00',
            vatRateType: 'none',
            vatRatePct: null,
          }),
        ],
        partner: {
          id: 'p3',
          name: 'Čistá s.r.o.',
          ico: '11223344',
          dic: null,
          vatId: null,
          country: 'CZ',
          isVatPayer: false,
        },
        vendor: {
          id: 'v1',
          partnerId: 'p3',
          defaultCategoryCode: 'exp_cleaning',
          defaultVatTreatment: 'rcv_domestic_no_vat',
          defaultBusinessFlag: 'business',
          confirmations: 2,
          pinned: false,
          multiCategory: false,
          extractionHints: { subject_cs: 'Apartment cleaning' },
        },
      }),
    });
    expect(r.needsLlm).toBe(false);
    expect(r.llmRequest).toBeNull();
    expect(r.write.lines[0]).toMatchObject({
      categoryCode: 'exp_cleaning',
      vatTreatment: 'rcv_domestic_no_vat',
      classificationSource: 'vendor_memory',
      deductibility: 'deductible',
    });
    expect(r.write.status).toBe('ready');
    expect(r.write.document.summaryCs).toBe(
      'Apartment cleaning for September – tax-deductible expense, no VAT',
    );
    expect(r.write.document.categorizeVersion).toBe(1);
  });

  it('Booking July (AC-9c): EU reverse charge, VAT point = issue date (policy issue_date), rate 21, summary names August', () => {
    const booking = doc({
      class: 'received_invoice',
      taxDocStatus: 'foreign_document',
      issueDate: '2026-08-03',
      duzp: null,
      servicePeriodFrom: '2026-07-01',
      servicePeriodTo: '2026-07-31',
      paidAt: null,
      totalGross: '13699.77',
      lines: [
        line({
          description: 'Commission',
          net: '12990.12',
          vat: null,
          gross: '12990.12',
          vatRateType: 'none',
          vatRatePct: null,
        }),
        line({
          id: L2,
          position: 2,
          lineType: 'fee',
          description: 'Payments service fee',
          net: '709.65',
          vat: null,
          gross: '709.65',
          vatRateType: 'none',
          vatRatePct: null,
        }),
      ],
      partner: {
        id: 'p4',
        name: 'Booking.com B.V.',
        ico: null,
        dic: null,
        vatId: 'NL805734958B01',
        country: 'NL',
        isVatPayer: null,
      },
    });
    const out: CategorizeOutput = {
      subject: 'Booking.com commission',
      dominantCategoryCode: 'exp_platform_commission',
      businessLikelihood: 'business',
      personalReason: null,
      lines: [
        {
          position: 1,
          categoryCode: 'exp_platform_commission',
          alternativeCategoryCode: null,
          confidence: 0.95,
          supplyKind: 'service',
          assetCandidate: false,
          mixedUseItem: false,
          placeOfSupplyAbroad: false,
          reason: 'x',
        },
        {
          position: 2,
          categoryCode: 'exp_payment_fees',
          alternativeCategoryCode: null,
          confidence: 0.9,
          supplyKind: 'service',
          assetCandidate: false,
          mixedUseItem: false,
          placeOfSupplyAbroad: false,
          reason: 'x',
        },
      ],
    };
    const r = plan({ doc: booking, llm: out });
    expect(r.write.lines.map((l) => [l.categoryCode, l.vatTreatment, l.vatRatePct])).toEqual([
      ['exp_platform_commission', 'rcv_eu_service_reverse_charge', '21'],
      ['exp_payment_fees', 'rcv_eu_service_reverse_charge', '21'],
    ]);
    expect(r.write.document.vatPointDate).toBe('2026-08-03');
    expect(r.write.fields).toContainEqual(
      expect.objectContaining({
        fieldKey: 'lines[2].supply_kind',
        source: 'llm',
        valueText: 'service',
      }),
    );
    expect(r.write.document.summaryCs).toBe(
      'Booking.com commission for July – tax-deductible expense, you pay VAT 21 % yourself in the return for August',
    );
    expect(r.write.status).toBe('ready');
  });

  it('foreign currency: resolves the CNB rate for the document and stores fx_rate / fx_rate_date', () => {
    const r = plan({
      doc: doc({
        currency: 'USD',
        totalGross: '10.46',
        issueDate: '2026-10-05',
        duzp: null,
        paidAt: null,
        class: 'received_invoice',
        taxDocStatus: 'foreign_document',
        lines: [
          line({
            description: 'Cloudflare Pro',
            net: '10.46',
            vat: null,
            gross: '10.46',
            vatRateType: 'none',
            vatRatePct: null,
          }),
        ],
        partner: {
          id: 'p5',
          name: 'Cloudflare, Inc.',
          ico: null,
          dic: null,
          vatId: null,
          country: 'US',
          isVatPayer: null,
        },
        fxRates: [{ rateDate: '2026-10-02', currency: 'USD', amount: 1, rate: '23.456' }],
      }),
      llm: llm(
        { subject: 'Cloudflare hosting', businessLikelihood: 'business' },
        { categoryCode: 'exp_hosting_domains', confidence: 0.95, supplyKind: 'service' },
      ),
    });
    expect(r.write.document.fxRate).toBe('23.456000');
    expect(r.write.document.fxRateDate).toBe('2026-10-02');
    expect(r.write.lines[0]?.vatTreatment).toBe('rcv_non_eu_service_reverse_charge');
  });

  it('a blocking post-check or an open question keeps needs_review; a null direction throws', () => {
    const base = doc({
      questions: [answered('business_or_personal', 'business')],
      fields: [
        { fieldKey: 'summary.subject', valueText: 'Backpack', valueJson: null, source: 'llm' },
      ],
    });
    expect(
      plan({ doc: base, llm: llm({ businessLikelihood: 'business' }, { confidence: 0.9 }) }).write
        .status,
    ).toBe('ready');
    expect(
      plan({
        doc: base,
        llm: llm({ businessLikelihood: 'business' }, { confidence: 0.9 }),
        postChecks: [{ ruleId: 'X', severity: 'blocking' }],
      }).write.status,
    ).toBe('needs_review');
    expect(() => plan({ doc: doc({ direction: null }) })).toThrow('CategorizeInputError');
  });

  it('never emits a non-user field for a key the user already set', () => {
    const r = plan({
      doc: doc({
        fields: [
          {
            fieldKey: 'lines[1].category_code',
            valueText: 'exp_office_supplies',
            valueJson: null,
            source: 'user',
          },
          { fieldKey: 'summary.subject', valueText: 'Pens', valueJson: null, source: 'user' },
        ],
      }),
    });
    expect(r.needsLlm).toBe(false);
    expect(r.write.lines[0]).toMatchObject({
      categoryCode: 'exp_office_supplies',
      classificationSource: 'user',
    });
    expect(r.write.fields.filter((f) => f.fieldKey === 'lines[1].category_code')).toEqual([]);
    expect(r.write.document.summaryCs?.startsWith('Pens')).toBe(true);
  });
});
