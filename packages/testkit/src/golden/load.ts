import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { z } from 'zod';
import { type LabelsAdapter, v1Adapter } from './labels-adapters/v1';
import { GoldenLabels } from './schema';

export type GoldenSetName = 'golden-v1';

/** Thrown when labels do not match the schema. Messages carry paths only, never label values. */
export class GoldenLabelsError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`golden labels invalid:\n${issues.join('\n')}`);
    this.name = 'GoldenLabelsError';
    this.issues = issues;
  }
}

export interface LoadGoldenOptions {
  /** Directory holding `labels.json` (and optionally `expected/`). Default: the committed set. */
  readonly dir?: string;
  /** Applied in order before validation. Default: `[v1Adapter]`. */
  readonly adapters?: readonly LabelsAdapter[];
}

/** Absolute path of `testdata/<set>/` in this repository. */
export function goldenSetDir(set: GoldenSetName = 'golden-v1'): string {
  return fileURLToPath(new URL(`../../../../testdata/${set}/`, import.meta.url));
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map(
    (issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`,
  );
}

/** Validates already-read labels JSON: adapters first, then the M12 schema. */
export function parseGoldenLabels(
  raw: unknown,
  adapters: readonly LabelsAdapter[] = [v1Adapter],
): GoldenLabels {
  const adapted = adapters.reduce<unknown>((value, adapter) => adapter(value), raw);
  const result = GoldenLabels.safeParse(adapted);
  if (!result.success) {
    throw new GoldenLabelsError(formatIssues(result.error));
  }
  return result.data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Merges `expected/*.json` (alphabetical) into the documents: each file is
 * `{ "documents": { "<file>": { ...fields } } }`, shallow-merged into the document with that `file`.
 */
function mergeExpected(raw: unknown, dir: string): unknown {
  const expectedDir = join(dir, 'expected');
  if (!existsSync(expectedDir) || !isRecord(raw) || !Array.isArray(raw.documents)) {
    return raw;
  }
  const documents: unknown[] = raw.documents.map((doc) => (isRecord(doc) ? { ...doc } : doc));
  const names = readdirSync(expectedDir)
    .filter((name) => name.endsWith('.json'))
    .sort();
  for (const name of names) {
    const content: unknown = JSON.parse(readFileSync(join(expectedDir, name), 'utf8'));
    if (!isRecord(content) || !isRecord(content.documents)) {
      throw new GoldenLabelsError([
        `expected/${name}: must be { "documents": { "<file>": {...} } }`,
      ]);
    }
    let position = 0;
    for (const [file, fields] of Object.entries(content.documents)) {
      position += 1;
      const target = documents.find((doc) => isRecord(doc) && doc.file === file);
      if (!isRecord(target) || !isRecord(fields)) {
        throw new GoldenLabelsError([
          `expected/${name}: entry #${position} matches no labeled document or is not an object`,
        ]);
      }
      Object.assign(target, fields);
    }
  }
  return { ...raw, documents };
}

/** Reads `labels.json`, applies adapters, merges `expected/*.json` and validates (M12 §4.10). */
export function loadGoldenLabels(options: LoadGoldenOptions = {}): GoldenLabels {
  const dir = options.dir ?? goldenSetDir();
  const raw: unknown = JSON.parse(readFileSync(join(dir, 'labels.json'), 'utf8'));
  const adapters = options.adapters ?? [v1Adapter];
  const adapted = adapters.reduce<unknown>((value, adapter) => adapter(value), raw);
  return parseGoldenLabels(mergeExpected(adapted, dir), []);
}
