// The envelope every rule value travels in (06 §2): a key, a layer, an inclusive validity window,
// the law or official page it came from and the date it was last checked.
import { z } from 'zod';
import { isLegalDate, type LegalDate } from '../dates/index';

/** Precedence, lowest first: base year data < mid-year amendment < `rules_overrides` row (admin hotfix). */
export const RULE_LAYERS = ['base', 'amendment', 'override'] as const;
export type RuleLayer = (typeof RULE_LAYERS)[number];

/** A strict `YYYY-MM-DD` calendar date (ADR-007), typed as `LegalDate` after parsing. */
export const LegalDateSchema = z.string().transform((value, ctx): LegalDate => {
  if (isLegalDate(value)) return value;
  ctx.addIssue({ code: 'custom', message: `Expected a legal date YYYY-MM-DD, got "${value}"` });
  return z.NEVER;
});

const ruleEntryShape = {
  key: z.string().min(1),
  layer: z.enum(RULE_LAYERS),
  /** First day the value applies (inclusive). */
  valid_from: LegalDateSchema,
  /** Last day the value applies (inclusive); `null` = open-ended. */
  valid_to: LegalDateSchema.nullable(),
  /** The law or official page the value was taken from; required (06 §2). */
  source: z.url(),
  /** The day a person last checked the value against `source`. */
  verified_at: LegalDateSchema,
};

function validToAfterValidFrom(entry: {
  valid_from: LegalDate;
  valid_to: LegalDate | null;
}): boolean {
  return entry.valid_to === null || entry.valid_to >= entry.valid_from;
}

const VALID_TO_MESSAGE = 'valid_to is before valid_from';

/** The envelope without the value: what every rule key shares. */
export const RuleEntryMetaSchema = z
  .strictObject(ruleEntryShape)
  .refine(validToAfterValidFrom, { message: VALID_TO_MESSAGE, path: ['valid_to'] });

/** The envelope around one key's value schema. */
export function ruleEntrySchema<V extends z.ZodType>(value: V) {
  return z
    .strictObject({ ...ruleEntryShape, value })
    .refine(validToAfterValidFrom, { message: VALID_TO_MESSAGE, path: ['valid_to'] });
}

/** A validated entry: one value of one key in one layer for one date window. */
export interface RuleEntry<T = unknown> {
  readonly key: string;
  readonly layer: RuleLayer;
  readonly valid_from: LegalDate;
  readonly valid_to: LegalDate | null;
  readonly source: string;
  readonly verified_at: LegalDate;
  readonly value: T;
}

/** What callers pass in: data files and `rules_overrides` rows, before validation. */
export interface RuleEntryInput {
  readonly key: string;
  readonly layer: RuleLayer;
  readonly valid_from: string;
  readonly valid_to: string | null;
  readonly source: string;
  readonly verified_at: string;
  readonly value: unknown;
}
