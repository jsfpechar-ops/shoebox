import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ENUMS } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';

// Hard rule 5 / 04: every Postgres enum is also a TypeScript union in packages/domain. This test
// reads the SQL migrations (no database needed, runs in the `unit` project) and compares every
// `create type … as enum` and `alter type … add value` with ENUMS, names and values, in order.

const MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url));

function stripComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

function parseEnums(files: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const file of files) {
    const sql = stripComments(readFileSync(`${MIGRATIONS}/${file}`, 'utf8'));
    for (const m of sql.matchAll(/create type\s+(\w+)\s+as enum\s*\(([^)]*)\)/gi)) {
      const name = m[1] ?? '';
      out[name] = [...(m[2] ?? '').matchAll(/'([^']*)'/g)].map((v) => v[1] ?? '');
    }
    for (const m of sql.matchAll(
      /alter type\s+(\w+)\s+add value\s+(?:if not exists\s+)?'([^']*)'/gi,
    )) {
      const name = m[1] ?? '';
      const list = out[name];
      if (list === undefined) {
        throw new Error(`${file}: alter type ${name} before its create type`);
      }
      list.push(m[2] ?? '');
    }
  }
  return out;
}

const files = readdirSync(MIGRATIONS)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort();
const sqlEnums = parseEnums(files);
const names = Object.keys(ENUMS) as (keyof typeof ENUMS)[];

describe('SQL enums mirror @shoebox/domain ENUMS', () => {
  it('reads the migrations in order, 0001_enums.sql first', () => {
    expect(files[0]).toBe('0001_enums.sql');
  });

  it('defines exactly the 25 domain enums (same names, no extra types)', () => {
    expect(names).toHaveLength(25);
    expect(Object.keys(sqlEnums).sort()).toEqual([...names].sort());
  });

  it.each(names)('%s has the same values in the same order', (name) => {
    expect(sqlEnums[name]).toEqual([...ENUMS[name]]);
  });
});
