import {
  type DeadlineProfile,
  DIRECTION_VALUES,
  DOCUMENT_CLASS_VALUES,
  DOCUMENT_STATUS_VALUES,
  type LegalDate,
  LINE_TYPE_VALUES,
  type MeterProfile,
  type OverviewDocument,
  type OverviewLine,
  parseLegalDate,
  TAX_EFFECT_VALUES,
  TAX_REGIME_VALUES,
  VAT_PERIOD_VALUES,
  VAT_STATUS_VALUES,
  VAT_TREATMENT_VALUES,
} from '@shoebox/domain';
import { z } from 'zod';

/** PostgREST select for `documents` (numeric columns cast to text, ADR-007). */
export const DOCUMENTS_SELECT =
  'status, class, direction, business_flag, deleted_at, duzp, issue_date, received_date, service_period_to, currency, fx_rate::text, total_gross::text, partners(country, vat_id), document_lines(line_type, net::text, gross::text, vat_treatment, business_share_pct::text, categories(tax_effect))';
export const PROFILE_SELECT =
  'vat_status, vat_period, tax_regime, pausal_rate, pausal_dan_band, has_accountant';

export interface OverviewProfile extends MeterProfile, DeadlineProfile {
  readonly hasAccountant: boolean;
}

/** A calendar date from the database, parsed with the legal-date rules; an invalid date fails the row. */
const optionalDate = z
  .string()
  .nullable()
  .transform((value, ctx): LegalDate | null => {
    if (value === null) return null;
    try {
      return parseLegalDate(value);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'invalid date' });
      return z.NEVER;
    }
  });

/** A decimal literal as PostgREST returns a `::text` cast (ADR-007: never a float). */
const decimalText = z.string().regex(/^-?\d+(\.\d+)?$/);
const optionalDecimalText = decimalText.nullable();

const documentLineSchema = z.object({
  line_type: z.enum(LINE_TYPE_VALUES),
  net: optionalDecimalText,
  gross: optionalDecimalText,
  vat_treatment: z.enum(VAT_TREATMENT_VALUES).nullable(),
  business_share_pct: decimalText,
  categories: z.object({ tax_effect: z.enum(TAX_EFFECT_VALUES) }).nullable(),
});

const documentRowSchema = z.object({
  status: z.enum(DOCUMENT_STATUS_VALUES),
  class: z.enum(DOCUMENT_CLASS_VALUES),
  direction: z.enum(DIRECTION_VALUES).nullable(),
  business_flag: z.enum(['business', 'personal', 'mixed', 'unknown']),
  deleted_at: z.string().nullable(),
  duzp: optionalDate,
  issue_date: optionalDate,
  received_date: optionalDate,
  service_period_to: optionalDate,
  currency: z.string().length(3),
  fx_rate: optionalDecimalText,
  total_gross: optionalDecimalText,
  partners: z.object({ country: z.string(), vat_id: z.string().nullable() }).nullable(),
  document_lines: z.array(documentLineSchema).nullable(),
});

const profileRowSchema = z.object({
  vat_status: z.enum(VAT_STATUS_VALUES),
  vat_period: z.enum(VAT_PERIOD_VALUES).nullable(),
  tax_regime: z.enum(TAX_REGIME_VALUES),
  pausal_rate: z.union([z.literal(80), z.literal(60), z.literal(40), z.literal(30)]).nullable(),
  pausal_dan_band: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable(),
  has_accountant: z.boolean(),
});

/** Maps one `documents` row (with its lines, partner and categories) to the domain type; null when it does not parse. */
export function toOverviewDocument(row: unknown): OverviewDocument | null {
  const parsed = documentRowSchema.safeParse(row);
  if (!parsed.success) return null;
  const doc = parsed.data;
  const lines: OverviewLine[] = (doc.document_lines ?? []).map((line) => ({
    lineType: line.line_type,
    net: line.net,
    gross: line.gross,
    vatTreatment: line.vat_treatment,
    taxEffect: line.categories?.tax_effect ?? null,
    businessSharePct: line.business_share_pct,
  }));
  return {
    status: doc.status,
    class: doc.class,
    direction: doc.direction,
    businessFlag: doc.business_flag,
    deleted: doc.deleted_at !== null,
    duzp: doc.duzp,
    issueDate: doc.issue_date,
    receivedDate: doc.received_date,
    servicePeriodTo: doc.service_period_to,
    currency: doc.currency,
    fxRate: doc.fx_rate,
    totalGross: doc.total_gross,
    partnerCountry: doc.partners?.country ?? null,
    partnerVatId: doc.partners?.vat_id ?? null,
    lines,
  };
}

/** Maps one `taxpayer_profiles` row; null when it does not parse. */
export function toOverviewProfile(
  row: unknown,
  insuranceSelfPaid: boolean,
): OverviewProfile | null {
  const parsed = profileRowSchema.safeParse(row);
  if (!parsed.success) return null;
  const profile = parsed.data;
  return {
    vatStatus: profile.vat_status,
    vatPeriod: profile.vat_period,
    taxRegime: profile.tax_regime,
    pausalRate: profile.pausal_rate,
    pausalDanBand: profile.pausal_dan_band,
    hasAccountant: profile.has_accountant,
    insuranceSelfPaid,
  };
}
