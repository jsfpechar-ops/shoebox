// The one list of rule keys (06 §2: "this is the only list of rule keys") with its per-key zod
// schemas, the typed `RuleSet`, the entry/data-file schemas and the typed resolver factory.
import { z } from 'zod';
import { UnknownRuleKeyError } from './errors';
import { LAW_RULE_SCHEMAS } from './law';
import { PRODUCT_RULE_SCHEMAS } from './product';
import { createRuleResolver, type RuleResolver } from './resolver';
import { type RuleEntryInput, ruleEntrySchema } from './segment';

export const RULE_SCHEMAS = { ...LAW_RULE_SCHEMAS, ...PRODUCT_RULE_SCHEMAS } as const;

export type RuleKey = keyof typeof RULE_SCHEMAS;
export const RULE_KEYS = Object.keys(RULE_SCHEMAS).sort() as readonly RuleKey[];

/** The resolved value type of every key: `RuleSet['vat.rates']` is `{ standard: number; reduced: number }`. */
export type RuleSet = { readonly [K in RuleKey]: z.output<(typeof RULE_SCHEMAS)[K]> };

export function isRuleKey(key: string): key is RuleKey {
  return Object.hasOwn(RULE_SCHEMAS, key);
}

/** The zod schema of one key (M12 §4.9 admin editor); throws `UnknownRuleKeyError`. */
export function getRuleKeySchema(key: string): z.ZodType {
  if (!isRuleKey(key)) throw new UnknownRuleKeyError(key);
  return RULE_SCHEMAS[key];
}

/** One entry with its value checked against the schema of its key (one `rules_overrides` row, one data-file item). */
export const RuleEntrySchema = ruleEntrySchema(z.unknown()).superRefine((entry, ctx) => {
  if (!isRuleKey(entry.key)) {
    ctx.addIssue({ code: 'custom', path: ['key'], message: `Unknown rule key "${entry.key}"` });
    return;
  }
  const result = RULE_SCHEMAS[entry.key].safeParse(entry.value);
  if (!result.success) {
    for (const issue of result.error.issues) {
      ctx.addIssue({ code: 'custom', path: ['value', ...issue.path], message: issue.message });
    }
  }
});

/** A data file or a list of override rows: every item is a valid `RuleEntrySchema`. */
export const RuleSetSchema = z.array(RuleEntrySchema);

/** The typed resolver over the canonical keys: `createRules(entries).at(date).get('vat.rates')`. */
export function createRules(entries: readonly RuleEntryInput[]): RuleResolver<typeof RULE_SCHEMAS> {
  return createRuleResolver(entries, RULE_SCHEMAS);
}
