// The Czech rule data (06 §2): every base-layer entry of every seeded year, and the resolver over
// them. Apps add `rules_overrides` rows (layer `override`) through `createCzRules(extra)`.
import { createRules, type RULE_SCHEMAS } from '../keys';
import type { RuleResolver } from '../resolver';
import type { RuleEntryInput } from '../segment';
import { RULES_CZ_2025 } from './2025';
import { RULES_CZ_2026 } from './2026';
import { RULES_CZ_PRODUCT } from './classification';

/** All seeded Czech entries: law by year (oldest first), then the open-ended product keys. */
export const CZ_RULE_ENTRIES: readonly RuleEntryInput[] = [
  ...RULES_CZ_2025,
  ...RULES_CZ_2026,
  ...RULES_CZ_PRODUCT,
];

/** The Czech rules, optionally merged with amendments or `rules_overrides` rows; pure. */
export function createCzRules(
  extra: readonly RuleEntryInput[] = [],
): RuleResolver<typeof RULE_SCHEMAS> {
  return createRules([...CZ_RULE_ENTRIES, ...extra]);
}

export { RULES_CZ_2025, RULES_CZ_2026, RULES_CZ_PRODUCT };
