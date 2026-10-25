// The effective-dated resolver `rules.at(date)` (ADR-008, 06 §2). Pure: data in, values out, no I/O.
import type { z } from 'zod';
import { addDays, type LegalDate, parseLegalDate } from '../dates/index';
import {
  RuleGapError,
  RuleMissingError,
  RuleOverlapError,
  RuleValueError,
  UnknownRuleKeyError,
} from './errors';
import {
  RULE_LAYERS,
  type RuleEntry,
  type RuleEntryInput,
  type RuleLayer,
  ruleEntrySchema,
} from './segment';

/** One zod schema per rule key; the map's keys are the only keys the resolver accepts. */
export type RuleSchemaMap = Readonly<Record<string, z.ZodType>>;
export type RuleKeyOf<S extends RuleSchemaMap> = Extract<keyof S, string>;
export type RuleValueOf<S extends RuleSchemaMap, K extends RuleKeyOf<S>> = z.output<S[K]>;

/** The rules in force on one date. */
export interface RulesAt<S extends RuleSchemaMap> {
  readonly date: LegalDate;
  /** The value of `key` on `date`; throws `RuleMissingError` when no layer covers it. */
  get<K extends RuleKeyOf<S>>(key: K): RuleValueOf<S, K>;
  /** The value with its provenance (layer, window, source, verified_at); throws `RuleMissingError`. */
  resolve<K extends RuleKeyOf<S>>(key: K): RuleEntry<RuleValueOf<S, K>>;
  /** True when some layer covers `key` on `date`. */
  has(key: RuleKeyOf<S>): boolean;
}

export interface RuleResolver<S extends RuleSchemaMap> {
  /** The rules in force on `date`; throws `InvalidLegalDateError` for a malformed date. */
  at(date: LegalDate | string): RulesAt<S>;
  /** Every key of the schema map, sorted. */
  readonly keys: readonly RuleKeyOf<S>[];
  /** All validated entries of `key`, sorted by layer then `valid_from`; `[]` for a key without data. */
  entries(key: RuleKeyOf<S>): readonly RuleEntry[];
}

type Segments = Map<RuleLayer, RuleEntry[]>;

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map(
    (issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`,
  );
}

function windowOf(entry: RuleEntry): string {
  return `${entry.valid_from}..${entry.valid_to ?? 'open'}`;
}

function covers(entry: RuleEntry, date: LegalDate): boolean {
  return entry.valid_from <= date && (entry.valid_to === null || date <= entry.valid_to);
}

function validateEntries(
  entries: readonly RuleEntryInput[],
  schemas: RuleSchemaMap,
): Map<string, Segments> {
  const byKey = new Map<string, Segments>();
  entries.forEach((input, index) => {
    const schema = Object.hasOwn(schemas, input.key) ? schemas[input.key] : undefined;
    if (schema === undefined) throw new UnknownRuleKeyError(input.key);
    const parsed = ruleEntrySchema(schema).safeParse(input);
    if (!parsed.success) throw new RuleValueError(input.key, index, formatIssues(parsed.error));
    const entry: RuleEntry = parsed.data;
    let segments = byKey.get(entry.key);
    if (segments === undefined) {
      segments = new Map();
      byKey.set(entry.key, segments);
    }
    const list = segments.get(entry.layer) ?? [];
    list.push(entry);
    segments.set(entry.layer, list);
  });
  return byKey;
}

function checkWindows(key: string, layer: RuleLayer, list: RuleEntry[]): void {
  list.sort((a, b) => (a.valid_from < b.valid_from ? -1 : a.valid_from > b.valid_from ? 1 : 0));
  for (let i = 1; i < list.length; i += 1) {
    const previous = list[i - 1];
    const next = list[i];
    if (previous === undefined || next === undefined) continue;
    if (previous.valid_to === null || next.valid_from <= previous.valid_to) {
      throw new RuleOverlapError(key, layer, windowOf(previous), windowOf(next));
    }
    if (layer === 'base' && addDays(previous.valid_to, 1) !== next.valid_from) {
      throw new RuleGapError(key, previous.valid_to, next.valid_from);
    }
  }
}

/**
 * Builds a resolver from entries (base-year data, amendments and `rules_overrides` rows mapped to
 * `layer: 'override'`) and the per-key schemas. Throws at build time on an unknown key, an invalid
 * value, overlapping windows within a layer, or a gap between base segments. Within a date, the
 * override layer beats the amendment layer, which beats the base layer.
 */
export function createRuleResolver<S extends RuleSchemaMap>(
  entries: readonly RuleEntryInput[],
  schemas: S,
): RuleResolver<S> {
  const byKey = validateEntries(entries, schemas);
  for (const [key, segments] of byKey) {
    for (const layer of RULE_LAYERS) {
      const list = segments.get(layer);
      if (list !== undefined) checkWindows(key, layer, list);
    }
  }
  const keys = Object.keys(schemas).sort() as RuleKeyOf<S>[];
  const precedence: readonly RuleLayer[] = ['override', 'amendment', 'base'];

  function find(key: string, date: LegalDate): RuleEntry | undefined {
    const segments = byKey.get(key);
    if (segments === undefined) return undefined;
    for (const layer of precedence) {
      const hit = segments.get(layer)?.find((entry) => covers(entry, date));
      if (hit !== undefined) return hit;
    }
    return undefined;
  }

  return {
    keys,
    entries(key) {
      const segments = byKey.get(key);
      if (segments === undefined) return [];
      return RULE_LAYERS.flatMap((layer) => segments.get(layer) ?? []);
    },
    at(input) {
      const date = parseLegalDate(input);
      const resolve = <K extends RuleKeyOf<S>>(key: K): RuleEntry<RuleValueOf<S, K>> => {
        if (!Object.hasOwn(schemas, key)) throw new UnknownRuleKeyError(key);
        const hit = find(key, date);
        if (hit === undefined) throw new RuleMissingError(key, date);
        return hit as RuleEntry<RuleValueOf<S, K>>;
      };
      return {
        date,
        resolve,
        get: (key) => resolve(key).value,
        has: (key) => find(key, date) !== undefined,
      };
    },
  };
}
