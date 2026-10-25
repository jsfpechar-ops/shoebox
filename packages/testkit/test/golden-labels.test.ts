import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Money } from '@shoebox/domain';
import { afterEach, describe, expect, it } from 'vitest';
import {
  GoldenLabelsError,
  goldenSetDir,
  type LabelsAdapter,
  loadGoldenLabels,
  parseGoldenLabels,
  v1Adapter,
} from '../src/index';

type RawDoc = Record<string, unknown> & { totals?: Record<string, unknown>; file: string };
type RawLabels = Record<string, unknown> & { documents: RawDoc[] };

/** A fresh mutable copy of the committed labels. Tests never print label values. */
function rawLabels(): RawLabels {
  return JSON.parse(readFileSync(join(goldenSetDir(), 'labels.json'), 'utf8')) as RawLabels;
}

function firstWithTotals(raw: RawLabels): { doc: RawDoc; index: number } {
  const index = raw.documents.findIndex((doc) => doc.totals !== undefined);
  const doc = raw.documents[index];
  if (doc === undefined) throw new Error('golden set has no document with totals');
  return { doc, index };
}

function issuesOf(run: () => unknown): readonly string[] {
  try {
    run();
  } catch (error) {
    if (error instanceof GoldenLabelsError) return error.issues;
    throw error;
  }
  throw new Error('expected GoldenLabelsError');
}

const tempDirs: string[] = [];
function tempSet(raw: RawLabels): string {
  const dir = mkdtempSync(join(tmpdir(), 'golden-'));
  tempDirs.push(dir);
  writeFileSync(join(dir, 'labels.json'), JSON.stringify(raw));
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('committed golden-v1', () => {
  it('loads and validates against the M12 schema', () => {
    const labels = loadGoldenLabels();
    expect(labels.version).toBe('golden-v1');
    expect(labels.documents).toHaveLength(20);
    expect(labels.documents.filter((doc) => doc.bookable)).toHaveLength(12);
    expect(labels.documents.filter((doc) => doc.duplicate_of !== null)).toHaveLength(2);
  });

  it('turns every labeled amount into Money in the document currency', () => {
    const labels = loadGoldenLabels();
    let amounts = 0;
    for (const doc of labels.documents) {
      const all: (Money | null)[] = [
        ...(doc.totals ? [doc.totals.net, doc.totals.vat, doc.totals.gross] : []),
        ...(doc.vat_summary ?? []).flatMap((row) => [row.base, row.vat]),
        ...(doc.lines ?? []).map((line) => line.gross),
      ];
      for (const amount of all) {
        if (amount === null) continue;
        expect(Money.isMoney(amount)).toBe(true);
        expect(amount.currency).toBe(doc.currency);
        amounts += 1;
      }
    }
    expect(amounts).toBeGreaterThan(0);
  });

  it('defaults expected_validations and expected_questions to arrays', () => {
    for (const doc of loadGoldenLabels().documents) {
      expect(Array.isArray(doc.expected_validations)).toBe(true);
      expect(Array.isArray(doc.expected_questions)).toBe(true);
    }
  });
});

describe('schema failures', () => {
  it('rejects 19 documents', () => {
    const raw = rawLabels();
    raw.documents.pop();
    expect(issuesOf(() => parseGoldenLabels(raw)).some((i) => i.startsWith('documents'))).toBe(
      true,
    );
  });

  it('rejects a comma-decimal money string without echoing the value', () => {
    const raw = rawLabels();
    const { doc, index } = firstWithTotals(raw);
    doc.totals = { ...doc.totals, gross: '1234,50' };
    const issues = issuesOf(() => parseGoldenLabels(raw));
    expect(issues.some((i) => i.startsWith(`documents.${index}.totals.gross`))).toBe(true);
    expect(issues.join('\n')).not.toContain('1234,50');
  });

  it('rejects money as a JS number', () => {
    const raw = rawLabels();
    const { doc, index } = firstWithTotals(raw);
    doc.totals = { ...doc.totals, gross: 1234.5 };
    const issues = issuesOf(() => parseGoldenLabels(raw));
    expect(issues.some((i) => i.startsWith(`documents.${index}.totals.gross`))).toBe(true);
  });

  it('rejects a class that is not a domain DocumentClass', () => {
    const raw = rawLabels();
    const first = raw.documents[0] as RawDoc;
    first.class = 'invoice';
    expect(
      issuesOf(() => parseGoldenLabels(raw)).some((i) => i.startsWith('documents.0.class')),
    ).toBe(true);
  });

  it('rejects amounts without a currency', () => {
    const raw = rawLabels();
    const { doc, index } = firstWithTotals(raw);
    delete doc.currency;
    const issues = issuesOf(() => parseGoldenLabels(raw));
    expect(issues.some((i) => i.startsWith(`documents.${index}.currency`))).toBe(true);
  });

  it('rejects a wrong version', () => {
    const raw = rawLabels();
    raw.version = 'golden-v2';
    expect(issuesOf(() => parseGoldenLabels(raw)).some((i) => i.startsWith('version'))).toBe(true);
  });
});

describe('adapters', () => {
  it('v1Adapter is the identity', () => {
    const raw = rawLabels();
    expect(v1Adapter(raw)).toBe(raw);
  });

  it('applies adapters in order before validation instead of relaxing the schema', () => {
    const raw = rawLabels();
    const { doc } = firstWithTotals(raw);
    doc.totals = { ...doc.totals, gross: '1234,50' };
    const calls: string[] = [];
    const fixComma: LabelsAdapter = (value) => {
      calls.push('fixComma');
      const labels = value as RawLabels;
      for (const d of labels.documents) {
        if (typeof d.totals?.gross === 'string') d.totals.gross = d.totals.gross.replace(',', '.');
      }
      return labels;
    };
    const labels = loadGoldenLabels({ dir: tempSet(raw), adapters: [v1Adapter, fixComma] });
    expect(calls).toEqual(['fixComma']);
    const fixed = labels.documents.find((d) => d.file === doc.file);
    expect(fixed?.totals?.gross.toFixed2()).toBe('1234.50');
  });
});

describe('expected/*.json merge', () => {
  it('merges expected fields into the document with the same file', () => {
    const raw = rawLabels();
    const target = raw.documents[0] as RawDoc;
    const dir = tempSet(raw);
    mkdirSync(join(dir, 'expected'));
    writeFileSync(
      join(dir, 'expected', 'validation.json'),
      JSON.stringify({
        documents: {
          [target.file]: { expected_validations: [{ rule_id: 'X-TEST', severity: 'warning' }] },
        },
      }),
    );
    const merged = loadGoldenLabels({ dir }).documents[0];
    expect(merged?.expected_validations).toEqual([{ rule_id: 'X-TEST', severity: 'warning' }]);
  });

  it('fails when an expected entry matches no labeled document', () => {
    const dir = tempSet(rawLabels());
    mkdirSync(join(dir, 'expected'));
    writeFileSync(
      join(dir, 'expected', 'validation.json'),
      JSON.stringify({ documents: { 'no-such-file.pdf': { notes: 'x' } } }),
    );
    expect(issuesOf(() => loadGoldenLabels({ dir }))[0]).toContain('expected/validation.json');
  });

  it('fails when a merged expected field breaks the schema', () => {
    const raw = rawLabels();
    const target = raw.documents[0] as RawDoc;
    const dir = tempSet(raw);
    mkdirSync(join(dir, 'expected'));
    writeFileSync(
      join(dir, 'expected', 'validation.json'),
      JSON.stringify({
        documents: {
          [target.file]: { expected_validations: [{ rule_id: 'X', severity: 'fatal' }] },
        },
      }),
    );
    expect(
      issuesOf(() => loadGoldenLabels({ dir })).some((i) =>
        i.startsWith('documents.0.expected_validations.0.severity'),
      ),
    ).toBe(true);
  });
});
