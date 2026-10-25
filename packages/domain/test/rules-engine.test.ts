import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import {
  createRuleResolver,
  InvalidLegalDateError,
  RULE_LAYERS,
  type RuleEntryInput,
  RuleEntryMetaSchema,
  RuleError,
  RuleGapError,
  RuleMissingError,
  RuleOverlapError,
  RuleValueError,
  ruleEntrySchema,
  UnknownRuleKeyError,
} from '../src/index';

// Fake keys and fake values only: real law values are seeded by P0-DOM-05.
const schemas = {
  'test.rate': z.number().int().min(0).max(100),
  'test.limit': z.strictObject({ standard: z.number().int(), reduced: z.number().int() }),
} as const;

const SOURCE = 'https://example.invalid/law/test';

// Loosely typed on purpose: the rejection cases pass wrong shapes through.
function entry(overrides: Record<string, unknown> = {}): RuleEntryInput {
  return {
    key: 'test.rate',
    layer: 'base',
    valid_from: '2025-01-01',
    valid_to: '2025-12-31',
    source: SOURCE,
    verified_at: '2025-01-15',
    value: 10,
    ...overrides,
  } as RuleEntryInput;
}

/** The envelope without `value` (what `RuleEntryMetaSchema` validates). */
function meta(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const { value: _value, ...rest } = entry(overrides);
  return rest;
}

const base2025 = entry();
const base2026 = entry({ valid_from: '2026-01-01', valid_to: null, value: 12 });
const amendmentH2 = entry({
  layer: 'amendment',
  valid_from: '2026-07-01',
  valid_to: '2026-12-31',
  value: 15,
});
const overrideAugust = entry({
  layer: 'override',
  valid_from: '2026-08-01',
  valid_to: '2026-08-31',
  value: 99,
});

describe('rule entry envelope', () => {
  it('accepts a complete entry and types the dates', () => {
    const parsed = RuleEntryMetaSchema.parse(meta());
    expect(parsed.valid_from).toBe('2025-01-01');
    expect(parsed.valid_to).toBe('2025-12-31');
    expect(parsed.verified_at).toBe('2025-01-15');
    expect(parsed.layer).toBe('base');
  });

  it('accepts an open-ended window (valid_to null)', () => {
    expect(RuleEntryMetaSchema.safeParse(meta({ valid_to: null })).success).toBe(true);
  });

  it.each([
    ['missing source', { source: undefined }],
    ['source that is not a URL', { source: 'zákon č. 235/2004 Sb.' }],
    ['missing verified_at', { verified_at: undefined }],
    ['malformed valid_from', { valid_from: '2025-1-1' }],
    ['impossible valid_to', { valid_to: '2025-02-30' }],
    ['valid_to before valid_from', { valid_from: '2025-06-01', valid_to: '2025-05-31' }],
    ['unknown layer', { layer: 'hotfix' }],
    ['empty key', { key: '' }],
    ['extra field', { note: 'x' }],
  ])('rejects %s', (_name, patch) => {
    const result = RuleEntryMetaSchema.safeParse(meta(patch));
    expect(result.success).toBe(false);
  });

  it('ruleEntrySchema validates the value with the per-key schema', () => {
    const schema = ruleEntrySchema(schemas['test.limit']);
    expect(schema.safeParse(entry({ value: { standard: 21, reduced: 12 } })).success).toBe(true);
    const bad = schema.safeParse(entry({ value: { standard: 21 } }));
    expect(bad.success).toBe(false);
    expect(
      schema.safeParse(entry({ value: { standard: 21, reduced: 12, extra: 1 } })).success,
    ).toBe(false);
  });

  it('lists the three layers in precedence order', () => {
    expect(RULE_LAYERS).toEqual(['base', 'amendment', 'override']);
  });
});

describe('createRuleResolver: validation at build time', () => {
  it('rejects an unknown key', () => {
    expect(() => createRuleResolver([entry({ key: 'test.unknown' })], schemas)).toThrow(
      UnknownRuleKeyError,
    );
  });

  it('rejects a value that fails the per-key schema, naming the entry and the path', () => {
    const bad = entry({ key: 'test.limit', value: { standard: 21, reduced: 'twelve' } });
    let caught: unknown;
    try {
      createRuleResolver([base2025, bad], schemas);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RuleValueError);
    const error = caught as RuleValueError;
    expect(error.key).toBe('test.limit');
    expect(error.message).toContain('#1');
    expect(error.issues.some((issue) => issue.startsWith('value.reduced:'))).toBe(true);
  });

  it('rejects an entry without a source', () => {
    expect(() => createRuleResolver([entry({ source: undefined })], schemas)).toThrow(
      RuleValueError,
    );
  });

  it('rejects overlapping base segments (one shared day)', () => {
    const overlapping = entry({ valid_from: '2025-12-31', valid_to: '2026-12-31', value: 12 });
    expect(() => createRuleResolver([base2025, overlapping], schemas)).toThrow(RuleOverlapError);
  });

  it('rejects a segment after an open-ended one in the same layer', () => {
    const later = entry({ valid_from: '2027-01-01', valid_to: null, value: 13 });
    expect(() => createRuleResolver([base2026, later], schemas)).toThrow(RuleOverlapError);
  });

  it('rejects overlapping overrides', () => {
    const other = entry({
      layer: 'override',
      valid_from: '2026-08-31',
      valid_to: '2026-09-30',
      value: 98,
    });
    expect(() => createRuleResolver([base2026, overrideAugust, other], schemas)).toThrow(
      RuleOverlapError,
    );
  });

  it('rejects a gap between base segments', () => {
    const short2025 = entry({ valid_to: '2025-12-30' });
    expect(() => createRuleResolver([short2025, base2026], schemas)).toThrow(RuleGapError);
  });

  it('allows gaps between amendments and between overrides', () => {
    const laterAmendment = entry({
      layer: 'amendment',
      valid_from: '2027-03-01',
      valid_to: '2027-03-31',
      value: 16,
    });
    const laterOverride = entry({
      layer: 'override',
      valid_from: '2027-06-01',
      valid_to: null,
      value: 97,
    });
    expect(() =>
      createRuleResolver(
        [base2025, base2026, amendmentH2, laterAmendment, overrideAugust, laterOverride],
        schemas,
      ),
    ).not.toThrow();
  });

  it('does not depend on input order', () => {
    const rules = createRuleResolver([overrideAugust, base2026, amendmentH2, base2025], schemas);
    expect(rules.at('2025-06-01').get('test.rate')).toBe(10);
    expect(rules.at('2026-08-15').get('test.rate')).toBe(99);
  });

  it('every error is a RuleError', () => {
    for (const E of [
      RuleMissingError,
      UnknownRuleKeyError,
      RuleValueError,
      RuleOverlapError,
      RuleGapError,
    ]) {
      expect(Object.create(E.prototype)).toBeInstanceOf(RuleError);
    }
  });
});

describe('rules.at(date): segment selection', () => {
  const rules = createRuleResolver([base2025, base2026, amendmentH2, overrideAugust], schemas);

  it('picks the base segment by inclusive boundaries', () => {
    expect(rules.at('2025-01-01').get('test.rate')).toBe(10);
    expect(rules.at('2025-12-31').get('test.rate')).toBe(10);
    expect(rules.at('2026-01-01').get('test.rate')).toBe(12);
    expect(rules.at('2026-06-30').get('test.rate')).toBe(12);
  });

  it('amendment beats base from its first day to its last day', () => {
    expect(rules.at('2026-06-30').get('test.rate')).toBe(12);
    expect(rules.at('2026-07-01').get('test.rate')).toBe(15);
    expect(rules.at('2026-12-31').get('test.rate')).toBe(15);
    expect(rules.at('2027-01-01').get('test.rate')).toBe(12);
  });

  it('override applies last, over the amendment', () => {
    expect(rules.at('2026-07-31').get('test.rate')).toBe(15);
    expect(rules.at('2026-08-01').get('test.rate')).toBe(99);
    expect(rules.at('2026-08-31').get('test.rate')).toBe(99);
    expect(rules.at('2026-09-01').get('test.rate')).toBe(15);
  });

  it('an open-ended override beats an open-ended base', () => {
    const hotfix = entry({
      layer: 'override',
      valid_from: '2026-03-01',
      valid_to: null,
      value: 50,
    });
    const patched = createRuleResolver([base2026, hotfix], schemas);
    expect(patched.at('2026-02-28').get('test.rate')).toBe(12);
    expect(patched.at('2026-03-01').get('test.rate')).toBe(50);
    expect(patched.at('2099-12-31').get('test.rate')).toBe(50);
  });

  it('throws RuleMissingError for a date before the first segment', () => {
    expect(() => rules.at('2024-12-31').get('test.rate')).toThrow(RuleMissingError);
    expect(rules.at('2024-12-31').has('test.rate')).toBe(false);
  });

  it('throws RuleMissingError for a key with no data', () => {
    let caught: unknown;
    try {
      rules.at('2026-01-01').get('test.limit');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RuleMissingError);
    expect((caught as RuleMissingError).key).toBe('test.limit');
    expect((caught as RuleMissingError).date).toBe('2026-01-01');
    expect(rules.at('2026-01-01').has('test.limit')).toBe(false);
  });

  it('throws RuleMissingError after a closed last segment', () => {
    const closed = createRuleResolver([base2025], schemas);
    expect(() => closed.at('2026-01-01').get('test.rate')).toThrow(RuleMissingError);
  });

  it('an override alone does not cover dates outside its window', () => {
    const only = createRuleResolver([overrideAugust], schemas);
    expect(only.at('2026-08-15').get('test.rate')).toBe(99);
    expect(() => only.at('2026-09-01').get('test.rate')).toThrow(RuleMissingError);
  });

  it('rejects a malformed date', () => {
    expect(() => rules.at('2026-13-01')).toThrow(InvalidLegalDateError);
  });

  it('resolve() returns the provenance of the winning segment', () => {
    const hit = rules.at('2026-08-15').resolve('test.rate');
    expect(hit).toEqual({
      key: 'test.rate',
      layer: 'override',
      valid_from: '2026-08-01',
      valid_to: '2026-08-31',
      source: SOURCE,
      verified_at: '2025-01-15',
      value: 99,
    });
    expect(rules.at('2026-07-15').resolve('test.rate').layer).toBe('amendment');
    expect(rules.at('2026-01-15').resolve('test.rate').layer).toBe('base');
  });

  it('exposes sorted keys and the entries of a key by layer then date', () => {
    expect(rules.keys).toEqual(['test.limit', 'test.rate']);
    expect(rules.entries('test.rate').map((e) => `${e.layer}:${e.valid_from}`)).toEqual([
      'base:2025-01-01',
      'base:2026-01-01',
      'amendment:2026-07-01',
      'override:2026-08-01',
    ]);
    expect(rules.entries('test.limit')).toEqual([]);
  });

  it('get() is typed by the per-key schema', () => {
    const at = rules.at('2026-01-01');
    expectTypeOf(at.get('test.rate')).toEqualTypeOf<number>();
    expectTypeOf(at.get<'test.limit'>).returns.toEqualTypeOf<{
      standard: number;
      reduced: number;
    }>();
    // @ts-expect-error unknown keys do not compile
    expect(() => at.get('test.unknown')).toThrow(UnknownRuleKeyError);
  });
});

describe('purity (M12 §4.1: packages/domain has no I/O)', () => {
  it('src/rules imports only zod and the domain package itself', () => {
    const dir = fileURLToPath(new URL('../src/rules/', import.meta.url));
    const files = readdirSync(dir, { recursive: true, encoding: 'utf8' });
    for (const file of files.filter((name) => name.endsWith('.ts'))) {
      const text = readFileSync(join(dir, file), 'utf8');
      const specifiers = [...text.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1] ?? '');
      expect(specifiers.length).toBeGreaterThan(0);
      for (const specifier of specifiers) {
        expect(
          specifier === 'zod' || specifier.startsWith('./') || specifier.startsWith('../'),
        ).toBe(true);
      }
      expect(text).not.toMatch(/Date\.now\(\)|new Date\(/);
    }
  });
});
