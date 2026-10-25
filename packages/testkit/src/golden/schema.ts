import {
  DOCUMENT_CLASS_VALUES,
  LINE_TYPE_VALUES,
  type LineType,
  Money,
  SEVERITY_VALUES,
  TAX_DOC_STATUS_VALUES,
  TAX_REGIME_VALUES,
  VAT_STATUS_VALUES,
  VAT_TREATMENT_VALUES,
} from '@shoebox/domain';
import { z } from 'zod';

/** M12 §4.10: money in labels is a dot-decimal string with exactly two places. */
export const LabelMoney = z
  .string()
  .regex(/^-?\d+\.\d{2}$/, 'money must be a dot-decimal string with two places');

const IsoDate = z.iso.date();

export const TaxpayerProfileFixture = z.object({
  name: z.string(),
  legal_form: z.string(),
  ico: z.string(),
  dic: z.string(),
  vat_status: z.enum(VAT_STATUS_VALUES),
  accounting_regime: z.enum(TAX_REGIME_VALUES),
  address: z.object({
    street: z.string(),
    city: z.string(),
    zip: z.string(),
    country: z.string().length(2),
  }),
  foreign_service_dppd_policy: z.string(),
  tourist_fee_municipality: z.string().optional(),
  today: IsoDate,
});

/** The M12 `ExpectedDoc` with domain enums; amounts are still strings here. */
export const ExpectedDocRaw = z.object({
  file: z.string(),
  sha256: z.string().length(64),
  bookable: z.boolean(),
  class: z.enum(DOCUMENT_CLASS_VALUES),
  duplicate_of: z.string().nullable(),
  tax_doc_status: z.enum(TAX_DOC_STATUS_VALUES).optional(),
  partner: z
    .object({
      name: z.string(),
      ico: z.string().nullable(),
      dic: z.string().nullable(),
      vat_id: z.string().nullable(),
      country: z.string().length(2),
    })
    .optional(),
  document_number: z.string().nullable().optional(),
  variable_symbol: z.string().nullable().optional(),
  issue_date: IsoDate.nullable().optional(),
  duzp: IsoDate.nullable().optional(),
  due_date: IsoDate.nullable().optional(),
  service_period_from: IsoDate.nullable().optional(),
  service_period_to: IsoDate.nullable().optional(),
  currency: z.string().length(3).optional(),
  totals: z
    .object({ net: LabelMoney.nullable(), vat: LabelMoney.nullable(), gross: LabelMoney })
    .optional(),
  vat_summary: z
    .array(z.object({ rate_pct: z.number(), base: LabelMoney, vat: LabelMoney }))
    .optional(),
  lines: z
    .array(
      z.object({ description: z.string(), gross: LabelMoney, line_type: z.enum(LINE_TYPE_VALUES) }),
    )
    .optional(),
  category_code: z.string().optional(),
  vat_treatment: z.enum(VAT_TREATMENT_VALUES).optional(),
  business_flag: z.enum(['business', 'personal', 'mixed', 'unknown']).optional(),
  expected_validations: z
    .array(z.object({ rule_id: z.string(), severity: z.enum(SEVERITY_VALUES) }))
    .default([]),
  expected_questions: z.array(z.string()).default([]),
  notes: z.string().optional(),
});
export type ExpectedDocRaw = z.output<typeof ExpectedDocRaw>;

export interface GoldenTotals {
  readonly net: Money | null;
  readonly vat: Money | null;
  readonly gross: Money;
}
export interface GoldenVatSummaryRow {
  readonly rate_pct: number;
  readonly base: Money;
  readonly vat: Money;
}
export interface GoldenLine {
  readonly description: string;
  readonly gross: Money;
  readonly line_type: LineType;
}
/** One labeled document with every amount as `Money` in the document currency. */
export type GoldenDoc = Omit<ExpectedDocRaw, 'totals' | 'vat_summary' | 'lines'> & {
  totals?: GoldenTotals;
  vat_summary?: GoldenVatSummaryRow[];
  lines?: GoldenLine[];
};

export const ExpectedDoc = ExpectedDocRaw.transform((doc, ctx): GoldenDoc => {
  const { totals, vat_summary, lines, ...rest } = doc;
  if (totals === undefined && vat_summary === undefined && lines === undefined) {
    return rest;
  }
  const currency = doc.currency;
  if (currency === undefined) {
    ctx.issues.push({
      code: 'custom',
      message: 'currency is required when amounts are labeled',
      input: doc,
      path: ['currency'],
    });
    return z.NEVER;
  }
  const money = (text: string): Money => Money.parse(text, currency);
  const out: GoldenDoc = { ...rest };
  if (totals !== undefined) {
    out.totals = {
      net: totals.net === null ? null : money(totals.net),
      vat: totals.vat === null ? null : money(totals.vat),
      gross: money(totals.gross),
    };
  }
  if (vat_summary !== undefined) {
    out.vat_summary = vat_summary.map((row) => ({
      rate_pct: row.rate_pct,
      base: money(row.base),
      vat: money(row.vat),
    }));
  }
  if (lines !== undefined) {
    out.lines = lines.map((line) => ({
      description: line.description,
      gross: money(line.gross),
      line_type: line.line_type,
    }));
  }
  return out;
});

export const GoldenLabels = z.object({
  version: z.literal('golden-v1'),
  taxpayer: TaxpayerProfileFixture,
  documents: z.array(ExpectedDoc).length(20),
  periods: z
    .array(
      z.object({
        period: z.string().regex(/^\d{4}-\d{2}$/),
        dphdp3: z.record(z.string(), z.object({ base: z.number().int(), tax: z.number().int() })),
      }),
    )
    .default([]),
});
export type GoldenLabels = z.output<typeof GoldenLabels>;
