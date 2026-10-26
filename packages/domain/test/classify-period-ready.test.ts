import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import { Money } from '../src/money/index';
import { createCzRules } from '../src/rules/index';
import { classifyPeriod, type SimpleCheckCode } from '../src/vat/classify-period';
import { doc, entry, io, line, payer } from './classify-period.test';

const rules = createCzRules();
const d = parseLegalDate;
const czk = (s: string) => Money.parse(s, 'CZK');
const must = <T>(value: T | undefined | null): T => {
  if (value === undefined || value === null) throw new Error('expected a value');
  return value;
};
const check = (r: ReturnType<typeof classifyPeriod>, code: SimpleCheckCode) =>
  must(r.checks.find((c) => c.code === code));
const CZ = { dic: 'CZ12345678', vatId: null, vatIdValid: null, documentShowsDic: true };
const NO_DIC = { dic: null, vatId: null, vatIdValid: null, documentShowsDic: false };

describe('not_ready checks (0332)', () => {
  it('S_PENDING_DOCUMENTS: a ready invoice blocks, a supporting document does not', () => {
    expect(
      check(
        classifyPeriod(io({ documents: [doc({ documentId: 'b', status: 'ready' })] }), rules),
        'S_PENDING_DOCUMENTS',
      ),
    ).toMatchObject({ outcome: 'not_ready', documentIds: ['b'] });
    expect(
      check(
        classifyPeriod(
          io({
            documents: [
              doc({ documentId: 'b' }),
              doc({ documentId: 's', class: 'other_supporting', status: 'supporting' }),
            ],
          }),
          rules,
        ),
        'S_PENDING_DOCUMENTS',
      ).outcome,
    ).toBe('pass');
    expect(
      classifyPeriod(io({ documents: [doc({ documentId: 'b', status: 'needs_review' })] }), rules)
        .verdict,
    ).toBe('not_ready');
  });
  it('S_BLOCKING_VALIDATION and S_BUSINESS_FLAG_UNKNOWN', () => {
    expect(
      check(
        classifyPeriod(
          io({ documents: [doc({ documentId: 'b', hasBlockingValidation: true })] }),
          rules,
        ),
        'S_BLOCKING_VALIDATION',
      ).documentIds,
    ).toEqual(['b']);
    expect(
      check(
        classifyPeriod(
          io({ documents: [doc({ documentId: 'b', businessFlag: 'unknown' })] }),
          rules,
        ),
        'S_BUSINESS_FLAG_UNKNOWN',
      ).outcome,
    ).toBe('not_ready');
    expect(
      check(
        classifyPeriod(io({ documents: [doc({ documentId: 'b', businessFlag: 'mixed' })] }), rules),
        'S_BUSINESS_FLAG_UNKNOWN',
      ).outcome,
    ).toBe('pass');
  });
  it('ledger issues pass through by code', () => {
    const r = classifyPeriod(
      io({
        ledgerIssues: [
          { code: 'S_FX_MISSING', documentId: 'c' },
          { code: 'S_FX_MISSING', documentId: 'a' },
          { code: 'S_DATE_MISSING', documentId: 'b' },
        ],
      }),
      rules,
    );
    expect(check(r, 'S_FX_MISSING')).toMatchObject({
      outcome: 'not_ready',
      documentIds: ['a', 'c'],
    });
    expect(check(r, 'S_DATE_MISSING').documentIds).toEqual(['b']);
    expect(check(r, 'S_SELF_ASSESSED_RATE_UNKNOWN').outcome).toBe('pass');
    expect(check(r, 'S_MIXED_TREATMENT_SAME_RATE').outcome).toBe('pass');
  });
  it('S_KH_DIC_MISSING (#8): supplier 10 000,01 without DIČ; with DIČ passes; IO never', () => {
    const dom = (
      partner: { dic: string | null; vatId: null; vatIdValid: null; documentShowsDic: boolean },
      total: string,
      section: 'B2' | 'B3',
    ) => ({
      entries: [
        entry({
          documentId: 'm',
          vatTreatment: 'rcv_domestic_vat',
          dphdp3Rows: ['40'],
          khSection: section,
          khDocumentTotalCzk: czk(total),
          baseCzk: czk('8264.47'),
          vatCzk: czk('1735.54'),
          counterpartyVatId: partner.dic,
        }),
      ],
      documents: [
        doc({
          documentId: 'm',
          taxDocStatus: 'full_tax_document',
          partner,
          lines: [line({ vatTreatment: 'rcv_domestic_vat' })],
        }),
      ],
    });
    expect(
      check(classifyPeriod(payer(dom(NO_DIC, '10000.01', 'B3')), rules), 'S_KH_DIC_MISSING'),
    ).toMatchObject({ outcome: 'not_ready', documentIds: ['m'] });
    expect(
      check(classifyPeriod(payer(dom(CZ, '10000.01', 'B2')), rules), 'S_KH_DIC_MISSING').outcome,
    ).toBe('pass');
    expect(
      check(classifyPeriod(io(dom(NO_DIC, '10000.01', 'B3')), rules), 'S_KH_DIC_MISSING').outcome,
    ).toBe('pass');
  });
  it('S_KH_DIC_MISSING (b): A5 over the limit with a DIČ printed but not captured', () => {
    const out = payer({
      entries: [
        entry({
          documentId: 'i',
          vatTreatment: 'iss_domestic_vat',
          dphdp3Rows: ['1'],
          khSection: 'A5',
          khDocumentTotalCzk: czk('12100.00'),
          baseCzk: czk('10000.00'),
          vatCzk: czk('2100.00'),
          counterpartyVatId: null,
        }),
      ],
      documents: [
        doc({
          documentId: 'i',
          class: 'issued_invoice',
          taxDocStatus: 'full_tax_document',
          partner: { ...NO_DIC, documentShowsDic: true },
          lines: [line({ vatTreatment: 'iss_domestic_vat' })],
        }),
      ],
    });
    expect(check(classifyPeriod(out, rules), 'S_KH_DIC_MISSING').outcome).toBe('not_ready');
    const first = must(out.documents[0]);
    const b2c = { ...out, documents: [{ ...first, partner: NO_DIC }] };
    expect(check(classifyPeriod(b2c, rules), 'S_KH_DIC_MISSING').outcome).toBe('pass');
  });
  it('S_KH_EVIDENCE_NUMBER_MISSING: A2 entry without a document number; A5 does not need one', () => {
    expect(
      check(
        classifyPeriod(
          payer({
            entries: [
              entry({
                documentId: 'b',
                dphdp3Rows: ['5', '43'],
                khSection: 'A2',
                evidenceNumber: null,
              }),
            ],
          }),
          rules,
        ),
        'S_KH_EVIDENCE_NUMBER_MISSING',
      ).documentIds,
    ).toEqual(['b']);
    expect(
      check(
        classifyPeriod(
          payer({
            entries: [
              entry({
                documentId: 'b',
                vatTreatment: 'iss_domestic_vat',
                dphdp3Rows: ['1'],
                khSection: 'A5',
                evidenceNumber: '',
              }),
            ],
          }),
          rules,
        ),
        'S_KH_EVIDENCE_NUMBER_MISSING',
      ).outcome,
    ).toBe('pass');
  });
  it('S_DOMESTIC_NOT_TAX_DOC: Alza "není daňový doklad" with a domestic VAT line', () => {
    const alza = payer({
      documents: [
        doc({ documentId: 'b' }),
        doc({
          documentId: 'z',
          taxDocStatus: 'not_tax_document',
          partner: CZ,
          lines: [line({ vatTreatment: 'rcv_domestic_vat' })],
        }),
      ],
    });
    expect(check(classifyPeriod(alza, rules), 'S_DOMESTIC_NOT_TAX_DOC').documentIds).toEqual(['z']);
    expect(
      check(
        classifyPeriod(
          payer({
            documents: [
              doc({
                documentId: 'z',
                taxDocStatus: 'simplified_tax_document',
                partner: CZ,
                lines: [line({ vatTreatment: 'rcv_domestic_vat' })],
              }),
            ],
          }),
          rules,
        ),
        'S_DOMESTIC_NOT_TAX_DOC',
      ).outcome,
    ).toBe('pass');
  });
  it('S_SH_VAT_ID_INVALID: SH entry needs a VIES-valid VAT ID', () => {
    const sh = (vatIdValid: boolean | null) =>
      payer({
        entries: [
          entry({
            documentId: 'e',
            vatTreatment: 'iss_eu_service',
            dphdp3Rows: ['21'],
            shvCode: 3,
            vatCzk: czk('0.00'),
            counterpartyVatId: 'DE123456789',
          }),
        ],
        documents: [
          doc({
            documentId: 'e',
            class: 'issued_invoice',
            partner: { dic: null, vatId: 'DE123456789', vatIdValid, documentShowsDic: false },
            lines: [line({ vatTreatment: 'iss_eu_service' })],
          }),
        ],
      });
    expect(check(classifyPeriod(sh(false), rules), 'S_SH_VAT_ID_INVALID').outcome).toBe(
      'not_ready',
    );
    expect(check(classifyPeriod(sh(null), rules), 'S_SH_VAT_ID_INVALID').outcome).toBe('not_ready');
    expect(check(classifyPeriod(sh(true), rules), 'S_SH_VAT_ID_INVALID').outcome).toBe('pass');
  });
  it('Booking August: missing buyer DIČ fails nothing', () => {
    expect(
      classifyPeriod(
        io({
          entries: [
            entry({
              documentId: 'b',
              vatPointDate: d('2026-09-03'),
              baseCzk: czk('11549.94'),
              vatCzk: czk('2425.49'),
            }),
          ],
        }),
        rules,
      ).verdict,
    ).toBe('simple');
  });
});
