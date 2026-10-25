import { isValidIco } from '@shoebox/registries';
import { z } from 'zod';

export const TAX_REGIME_ANSWERS = [
  'danova_evidence',
  'pausalni_vydaje',
  'pausalni_dan',
  'nevim',
] as const;
export const VAT_ANSWERS = [
  'neplatce',
  'platce_monthly',
  'platce_quarterly',
  'identifikovana_osoba',
] as const;

export type OnboardingInput = {
  ico: string;
  name: string;
  dic: string | null;
  street: string;
  houseNumber: string | null;
  orientationNumber: string | null;
  city: string;
  zip: string;
  fuCode: string | null;
  validFrom: string;
  slugBase: string;
  vat: (typeof VAT_ANSWERS)[number];
  regime: (typeof TAX_REGIME_ANSWERS)[number];
  pausalRate: 80 | 60 | 40 | 30 | null;
  pausalDanBand: 1 | 2 | 3 | null;
};

const trimText = (v: unknown): unknown => (typeof v === 'string' ? v.trim() : v);

/** Trimmed text; empty or missing → null. */
const emptyToNull = (v: unknown): unknown => {
  const t = trimText(v);
  return t === '' || t === undefined ? null : t;
};

/** Form numbers arrive as strings; empty → null. */
const toNumber = (v: unknown): unknown => {
  const t = emptyToNull(v);
  return typeof t === 'string' ? Number(t) : t;
};

const requiredText = (max: number) => z.preprocess(trimText, z.string().min(1).max(max));
const nullableText = (max: number) => z.preprocess(emptyToNull, z.string().max(max).nullable());

const dicSchema = z.preprocess(
  (v) => {
    const t = emptyToNull(v);
    return typeof t === 'string' ? t.toUpperCase().replace(/\s+/g, '') : t;
  },
  z
    .string()
    .regex(/^CZ\d{8,10}$/)
    .nullable(),
);

const zipSchema = z.preprocess(
  trimText,
  z
    .string()
    .regex(/^\d{3} ?\d{2}$/)
    .transform((s) => s.replace(' ', '')),
);

const slugSchema = z.preprocess(
  (v) => (typeof v === 'string' && /^[a-z0-9-]{1,30}$/.test(v) ? v : 'firma'),
  z.string(),
);

export const onboardingSchema: z.ZodType<OnboardingInput> = z
  .object({
    ico: z.preprocess(
      (v) => (typeof v === 'string' ? v.replace(/\s+/g, '') : v),
      z.string().refine(isValidIco),
    ),
    name: requiredText(200),
    dic: dicSchema,
    street: requiredText(100),
    houseNumber: nullableText(20),
    orientationNumber: nullableText(20),
    city: requiredText(100),
    zip: zipSchema,
    fuCode: nullableText(10),
    validFrom: z.preprocess(trimText, z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
    slugBase: slugSchema,
    vat: z.enum(VAT_ANSWERS),
    regime: z.enum(TAX_REGIME_ANSWERS),
    pausalRate: z.preprocess(
      toNumber,
      z.union([z.literal(80), z.literal(60), z.literal(40), z.literal(30)]).nullable(),
    ),
    pausalDanBand: z.preprocess(
      toNumber,
      z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable(),
    ),
  })
  .superRefine((v, ctx) => {
    if (v.regime === 'pausalni_vydaje' && v.pausalRate === null) {
      ctx.addIssue({ code: 'custom', message: 'pausal_rate_required', path: ['pausalRate'] });
    }
    if (v.regime === 'pausalni_dan') {
      if (v.pausalDanBand === null) {
        ctx.addIssue({ code: 'custom', message: 'band_required', path: ['pausalDanBand'] });
      }
      if (v.vat.startsWith('platce')) {
        ctx.addIssue({ code: 'custom', message: 'pausal_dan_payer', path: ['vat'] });
      }
    }
  })
  .transform(
    (v): OnboardingInput => ({
      ...v,
      pausalRate: v.regime === 'pausalni_vydaje' ? v.pausalRate : null,
      pausalDanBand: v.regime === 'pausalni_dan' ? v.pausalDanBand : null,
    }),
  );

/** Maps the three answers to `public.create_firm` input (0061). */
export function toCreateFirmInput(input: OnboardingInput): Record<string, unknown> {
  const vat = {
    neplatce: { vat_status: 'neplatce', vat_period: null },
    platce_monthly: { vat_status: 'platce', vat_period: 'monthly' },
    platce_quarterly: { vat_status: 'platce', vat_period: 'quarterly' },
    identifikovana_osoba: { vat_status: 'identifikovana_osoba', vat_period: 'monthly' },
  } as const;
  // TODO(review-question confirm_profile): "nevim" falls back to danova_evidence until the review_questions row exists (M03).
  const taxRegime = input.regime === 'nevim' ? 'danova_evidence' : input.regime;
  return {
    name: input.name,
    ico: input.ico,
    dic: input.dic,
    ...vat[input.vat],
    tax_regime: taxRegime,
    pausal_rate: input.pausalRate,
    pausal_dan_band: input.pausalDanBand,
    valid_from: input.validFrom,
    address: {
      street: input.street,
      house_number: input.houseNumber,
      orientation_number: input.orientationNumber,
      city: input.city,
      zip: input.zip,
      country: 'CZ',
    },
    fu_code: input.fuCode,
    slug_base: input.slugBase,
  };
}

export function parseOnboardingForm(formData: FormData) {
  return onboardingSchema.safeParse(Object.fromEntries(formData.entries()));
}
