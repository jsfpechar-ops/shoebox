// Errors of the rules engine (06 §2, ADR-008). Every one extends RuleError so callers can catch the family.
import type { LegalDate } from '../dates/index';

export class RuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleError';
  }
}

/** No segment of any layer covers the key on the date (06 §2: a date without data is an error, never a default). */
export class RuleMissingError extends RuleError {
  readonly key: string;
  readonly date: LegalDate;
  constructor(key: string, date: LegalDate) {
    super(`No rule value for "${key}" on ${date}`);
    this.name = 'RuleMissingError';
    this.key = key;
    this.date = date;
  }
}

/** The key is not in the schema map (06 §2.1/§2.2 is the only list of keys). */
export class UnknownRuleKeyError extends RuleError {
  readonly key: string;
  constructor(key: string) {
    super(`Unknown rule key "${key}"`);
    this.name = 'UnknownRuleKeyError';
    this.key = key;
  }
}

/** An entry failed its envelope or per-key zod schema. `issues` are zod issues as `path: message`. */
export class RuleValueError extends RuleError {
  readonly key: string;
  readonly issues: readonly string[];
  constructor(key: string, index: number, issues: readonly string[]) {
    super(`Invalid rule entry #${index} for "${key}": ${issues.join('; ')}`);
    this.name = 'RuleValueError';
    this.key = key;
    this.issues = issues;
  }
}

/** Two segments of the same key and layer cover a common date. */
export class RuleOverlapError extends RuleError {
  readonly key: string;
  constructor(key: string, layer: string, first: string, second: string) {
    super(`Overlapping ${layer} segments for "${key}": [${first}] and [${second}]`);
    this.name = 'RuleOverlapError';
    this.key = key;
  }
}

/** Two consecutive base segments of a key leave days without data between them. */
export class RuleGapError extends RuleError {
  readonly key: string;
  constructor(key: string, lastValidTo: LegalDate, nextValidFrom: LegalDate) {
    super(`Gap in base segments for "${key}": ${lastValidTo} is followed by ${nextValidFrom}`);
    this.name = 'RuleGapError';
    this.key = key;
  }
}
