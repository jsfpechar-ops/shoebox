#!/usr/bin/env node
// Migration lint (M12 §4.3 step 4, rules.md Database): migrations in packages/db/migrations are
// forward-only. A destructive statement (drop table, drop column, alter column ... type, rename)
// fails unless the file's header comment carries `-- contract: <ticket>` (expand → migrate →
// contract over two releases). Runs with plain Node 22 (type stripping), no dependencies.
//
// Usage: node scripts/migration-lint.ts [file.sql ...]   (no files: every packages/db/migrations/*.sql)

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export type Violation = {
  file: string;
  line: number;
  rule: 'drop-table' | 'drop-column' | 'alter-column-type' | 'rename';
  statement: string;
};

export const MIGRATIONS_DIR = 'packages/db/migrations';

/** `-- contract: P0-DB-07` in the header (the leading run of comment and blank lines). */
const CONTRACT_HEADER = /^--\s*contract:\s*(\S+)/i;

const RULES: ReadonlyArray<readonly [Violation['rule'], RegExp]> = [
  ['drop-table', /\bdrop\s+table\b/i],
  ['drop-column', /\bdrop\s+column\b/i],
  ['alter-column-type', /\balter\s+column\s+(?:"[^"]+"|\w+)\s+(?:set\s+data\s+)?type\b/i],
  ['rename', /\brename\b/i],
];

/** Returns the ticket named by `-- contract: <ticket>` in the header, or null. */
export function contractTicket(source: string): string | null {
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (line === '') {
      continue;
    }
    if (!line.startsWith('--')) {
      return null;
    }
    const match = CONTRACT_HEADER.exec(line);
    if (match?.[1] !== undefined) {
      return match[1];
    }
  }
  return null;
}

/** Blanks line comments and block comments, keeping line numbers (newlines survive). */
function stripComments(source: string): string {
  const noBlock = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  return noBlock.replace(/--[^\n]*/g, '');
}

/** Splits SQL into statements on `;` outside dollar-quoted bodies; returns [statement, firstLine]. */
function splitStatements(sql: string): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  let start = 0;
  let line = 1;
  let startLine = 1;
  let dollarTag: string | null = null;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === '\n') {
      line += 1;
      continue;
    }
    if (ch === '$') {
      const tag = /^\$[\w]*\$/.exec(sql.slice(i));
      if (tag !== null) {
        if (dollarTag === null) {
          dollarTag = tag[0];
        } else if (dollarTag === tag[0]) {
          dollarTag = null;
        }
        i += tag[0].length - 1;
        continue;
      }
    }
    if (ch === ';' && dollarTag === null) {
      const text = sql.slice(start, i);
      const lead = text.length - text.trimStart().length;
      const leadLines = (text.slice(0, lead).match(/\n/g) ?? []).length;
      out.push([text.trim(), startLine + leadLines]);
      start = i + 1;
      startLine = line;
    }
  }
  const rest = sql.slice(start);
  if (rest.trim() !== '') {
    const lead = rest.length - rest.trimStart().length;
    out.push([rest.trim(), startLine + (rest.slice(0, lead).match(/\n/g) ?? []).length]);
  }
  return out;
}

/** Lints one migration. An empty array means the file passes. */
export function lintMigration(source: string, file: string): Violation[] {
  if (contractTicket(source) !== null) {
    return [];
  }
  const violations: Violation[] = [];
  for (const [statement, line] of splitStatements(stripComments(source))) {
    for (const [rule, pattern] of RULES) {
      if (pattern.test(statement)) {
        violations.push({ file, line, rule, statement: statement.replace(/\s+/g, ' ') });
      }
    }
  }
  return violations;
}

/** Lints the given files (or every migration) and returns the violations. */
export function lintFiles(files: readonly string[], root: string): Violation[] {
  const targets =
    files.length > 0
      ? files
      : readdirSync(join(root, MIGRATIONS_DIR))
          .filter((name) => name.endsWith('.sql'))
          .sort()
          .map((name) => join(MIGRATIONS_DIR, name));
  return targets.flatMap((file) => {
    const abs = resolve(root, file);
    return lintMigration(readFileSync(abs, 'utf8'), relative(root, abs));
  });
}

function main(argv: readonly string[]): number {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const violations = lintFiles(argv, root);
  for (const v of violations) {
    const msg = `${v.rule}: "${v.statement}" needs a "-- contract: <ticket>" header (forward-only, M12 §4.3)`;
    console.log(`::error file=${v.file},line=${v.line}::${msg}`);
  }
  if (violations.length === 0) {
    console.log(`migration-lint: OK (${argv.length > 0 ? argv.length : 'all'} file(s))`);
    return 0;
  }
  console.log(`migration-lint: ${violations.length} violation(s)`);
  return 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
