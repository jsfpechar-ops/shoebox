// check:tenant-sql (M12 §4.4 RLS test suite item 6): a Drizzle query on a tenant table that is not
// inside a withTenant()/withServiceRole() callback, or inside a function that takes a TenantTx or
// ServiceTx, is an error. Runs on Node 22 (type stripping) with the TypeScript compiler API that is
// already a root devDependency; no ts-morph (decisions 2026-10-18 [tooling] T-17).
//
//   node scripts/check-tenant-sql.ts            # scans apps/*/src and packages/*/src
//   node scripts/check-tenant-sql.ts <path...>  # scans these files or directories instead
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { GLOBAL_TABLES } from '../packages/db/src/rls-catalog.ts';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const SCHEMA_DIR = join(ROOT, 'packages', 'db', 'src', 'schema');

/** Query-builder methods whose first argument is a table (Drizzle pg-core). */
const TABLE_METHODS = new Set(['from', 'insert', 'update', 'delete', 'into']);
const SCOPED_CALL = /(^|\.)with(Tenant|ServiceRole)$/;
const SCOPED_PARAM = /\b(TenantTx|ServiceTx)\b/;
const SKIP_DIRS = new Set(['node_modules', 'test', 'dist', '.next', 'coverage']);

export interface Violation {
  file: string;
  line: number;
  column: number;
  /** Drizzle identifier of the table (export name in packages/db/src/schema). */
  table: string;
  /** `from`, `insert`, `update`, `delete`, `into` or `query`. */
  call: string;
}

function parse(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/**
 * Export names of the tenant tables: `export const <name> = pgTable('<table>', …)` in the schema
 * files, minus the global tables of the RLS catalog. Map: identifier → SQL table name.
 */
export function loadTenantIdentifiers(schemaDir: string = SCHEMA_DIR): Map<string, string> {
  const found = new Map<string, string>();
  for (const entry of readdirSync(schemaDir)
    .filter((f) => f.endsWith('.ts'))
    .sort()) {
    const source = parse(entry, readFileSync(join(schemaDir, entry), 'utf8'));
    const visit = (node: ts.Node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer !== undefined &&
        ts.isCallExpression(node.initializer) &&
        node.initializer.expression.getText(source) === 'pgTable'
      ) {
        const first = node.initializer.arguments[0];
        if (first !== undefined && ts.isStringLiteral(first) && !(first.text in GLOBAL_TABLES)) {
          found.set(node.name.text, first.text);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found;
}

/** True when `node` sits in a withTenant/withServiceRole argument or in a TenantTx/ServiceTx function. */
function isScoped(node: ts.Node, source: ts.SourceFile): boolean {
  let child: ts.Node = node;
  for (let parent = node.parent; parent !== undefined; child = parent, parent = parent.parent) {
    if (
      ts.isCallExpression(parent) &&
      parent.arguments.includes(child as ts.Expression) &&
      SCOPED_CALL.test(parent.expression.getText(source))
    ) {
      return true;
    }
    if (
      ts.isFunctionLike(parent) &&
      parent.parameters.some(
        (p) => p.type !== undefined && SCOPED_PARAM.test(p.type.getText(source)),
      )
    ) {
      return true;
    }
  }
  return false;
}

/** The Drizzle calls on tenant tables in `text` that are not scoped. */
export function findViolations(
  fileName: string,
  text: string,
  tenantIdentifiers: ReadonlySet<string>,
): Violation[] {
  const source = parse(fileName, text);
  const violations: Violation[] = [];
  const report = (node: ts.Node, table: string, call: string) => {
    if (isScoped(node, source)) {
      return;
    }
    const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
    violations.push({ file: fileName, line: line + 1, column: character + 1, table, call });
  };
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const first = node.arguments[0];
      if (
        TABLE_METHODS.has(method) &&
        first !== undefined &&
        ts.isIdentifier(first) &&
        tenantIdentifiers.has(first.text)
      ) {
        report(node, first.text, method);
      }
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      tenantIdentifiers.has(node.name.text) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'query'
    ) {
      report(node, node.name.text, 'query');
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

/** `*.ts`/`*.tsx` files under `paths` (directories are walked; test folders and test files skipped). */
export function listSourceFiles(paths: string[]): string[] {
  const files: string[] = [];
  const walk = (p: string) => {
    if (statSync(p).isDirectory()) {
      for (const entry of readdirSync(p, { withFileTypes: true })) {
        if (entry.isDirectory() ? !SKIP_DIRS.has(entry.name) : true) {
          walk(join(p, entry.name));
        }
      }
      return;
    }
    if (/\.tsx?$/.test(p) && !/\.(test|spec)\.tsx?$/.test(p) && !p.endsWith('.d.ts')) {
      files.push(p);
    }
  };
  for (const p of paths) {
    walk(p);
  }
  return files.sort();
}

/** The default scan: every app and package source tree that exists. */
export function defaultPaths(root: string = ROOT): string[] {
  const paths: string[] = [];
  for (const group of ['apps', 'packages']) {
    const dir = join(root, group);
    for (const name of readdirSync(dir).sort()) {
      const src = join(dir, name, 'src');
      try {
        if (statSync(src).isDirectory()) {
          paths.push(src);
        }
      } catch {
        // no src folder
      }
    }
  }
  return paths;
}

export function run(paths: string[], tenantIdentifiers = new Set(loadTenantIdentifiers().keys())) {
  const files = listSourceFiles(paths);
  const violations = files.flatMap((file) =>
    findViolations(relative(ROOT, file), readFileSync(file, 'utf8'), tenantIdentifiers),
  );
  return { files: files.length, violations };
}

function main(argv: string[]): number {
  const paths = argv.length > 0 ? argv.map((p) => resolve(p)) : defaultPaths();
  const { files, violations } = run(paths);
  for (const v of violations) {
    console.error(
      `${v.file}:${v.line}:${v.column}  ${v.call}(${v.table}) on a tenant table outside withTenant()`,
    );
  }
  if (violations.length > 0) {
    console.error(
      `check:tenant-sql: ${violations.length} violation(s) in ${files} files. Run tenant queries inside withTenant(orgId, fn) or in a function that takes a TenantTx (M12 §4.4).`,
    );
    return 1;
  }
  console.log(
    `check:tenant-sql: ${files} files, no Drizzle call on a tenant table outside withTenant()`,
  );
  return 0;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exit(main(process.argv.slice(2)));
}
