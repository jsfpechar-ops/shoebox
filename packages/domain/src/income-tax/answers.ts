import { z } from 'zod';
export const FLAT_RATES = [80, 60, 40, 30] as const;
export type FlatRate = (typeof FLAT_RATES)[number];
export const YES_NO_UNKNOWN = ['yes', 'no', 'unknown'] as const;
const flatRate = z.union([z.literal(80), z.literal(60), z.literal(40), z.literal(30)]);
export const podkladyAnswersSchema = z.strictObject({
  otherIncome: z.enum(YES_NO_UNKNOWN).default('unknown'),
  otherIncomeApprox: z.number().int().min(0).nullable().default(null), // whole CZK, paušální daň only
  employmentBeyondLimits: z.enum(YES_NO_UNKNOWN).default('unknown'),
  insolvencyOrPartner: z.enum(YES_NO_UNKNOWN).default('unknown'),
  comparisonRate: flatRate.nullable().default(null), // DE users, §4.3
  activityClass: flatRate.nullable().default(null), // paušální daň when pausal_rate is null
  includePartialXml: z.boolean().default(false),
});
export type PodkladyAnswers = z.output<typeof podkladyAnswersSchema>;
export const EMPTY_ANSWERS: PodkladyAnswers = podkladyAnswersSchema.parse({});
