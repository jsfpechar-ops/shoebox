import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Custom lint rules (M12 §4.1, AC-5): GritQL plugins in tools/biome-plugins/, scoped by the
 * overrides in biome.json. Each fixture is written to the real path its scope covers, linted
 * with the repo biome.json, and removed again. Only error diagnostics count.
 */
const root = fileURLToPath(new URL('../../..', import.meta.url));
const biome = join(root, 'node_modules', '.bin', 'biome');

type Diagnostic = { category: string; severity: string; message?: string };

function lintAt(relPath: string, content: string): string[] {
  const abs = join(root, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  let stdout = '';
  try {
    stdout = execFileSync(biome, ['lint', '--reporter=json', '--colors=off', relPath], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (error) {
    stdout = String((error as { stdout?: string }).stdout ?? '');
  } finally {
    rmSync(abs, { force: true });
  }
  const parsed = JSON.parse(stdout) as { diagnostics: Diagnostic[] };
  return parsed.diagnostics
    .filter((d) => d.severity === 'error')
    .map((d) => `${d.category}: ${d.message ?? ''}`);
}

const t = 'declare function t(key: string): string;\n';

describe('no-jsx-literal-text', () => {
  it('fails on JSX literal text in apps/web (AC-5)', () => {
    const errors = lintAt(
      'apps/web/src/__lint-fixture-jsx-text.tsx',
      'export function Save() {\n  return <button type="button">Uložit</button>;\n}\n',
    );
    expect(errors.join('\n')).toContain('no-jsx-literal-text');
  });

  it("passes t('doc.confirm') in apps/web (AC-5)", () => {
    const errors = lintAt(
      'apps/web/src/__lint-fixture-jsx-t.tsx',
      `${t}export function Save() {\n  return <button type="button">{t('doc.confirm')}</button>;\n}\n`,
    );
    expect(errors).toEqual([]);
  });

  it('fails on a literal alt/title/placeholder/aria-label in packages/ui', () => {
    const errors = lintAt(
      'packages/ui/src/__lint-fixture-jsx-attr.tsx',
      'export function Logo() {\n  return <img alt="logo" src="/logo.svg" />;\n}\n',
    );
    expect(errors.join('\n')).toContain('no-jsx-literal-text');
  });

  it('passes a translated attribute and ignores files outside apps/web and packages/ui', () => {
    expect(
      lintAt(
        'packages/ui/src/__lint-fixture-jsx-attr-t.tsx',
        `${t}export function Search() {\n  return <input placeholder={t('search.placeholder')} />;\n}\n`,
      ),
    ).toEqual([]);
    expect(
      lintAt(
        'packages/pipeline/src/__lint-fixture-jsx-elsewhere.tsx',
        'export function Raw() {\n  return <b>internal</b>;\n}\n',
      ),
    ).toEqual([]);
  });
});

describe('no-date-now-in-domain', () => {
  it('fails on Date.now() and new Date() in packages/domain', () => {
    expect(
      lintAt('packages/domain/src/__lint-fixture-now.ts', 'export const now = Date.now();\n').join(
        '\n',
      ),
    ).toContain('no-date-now-in-domain');
    expect(
      lintAt(
        'packages/domain/src/__lint-fixture-new-date.ts',
        'export const d = new Date();\n',
      ).join('\n'),
    ).toContain('no-date-now-in-domain');
  });

  it('passes a Clock and ignores other packages', () => {
    expect(
      lintAt(
        'packages/domain/src/__lint-fixture-clock.ts',
        'export const at = (clock: { now(): number }) => new Date(clock.now());\n',
      ),
    ).toEqual([]);
    expect(
      lintAt('packages/pipeline/src/__lint-fixture-now.ts', 'export const now = Date.now();\n'),
    ).toEqual([]);
  });
});

describe('no-number-money', () => {
  it('fails on parseFloat/Number() in domain, tax-xml and exports', () => {
    expect(
      lintAt(
        'packages/domain/src/__lint-fixture-float.ts',
        "export const n = parseFloat('1.5');\n",
      ).join('\n'),
    ).toContain('no-number-money');
    expect(
      lintAt(
        'packages/tax-xml/src/__lint-fixture-number.ts',
        "export const n = Number('1.5');\n",
      ).join('\n'),
    ).toContain('no-number-money');
    expect(
      lintAt(
        'packages/exports/src/__lint-fixture-number.ts',
        "export const n = Number('1.5');\n",
      ).join('\n'),
    ).toContain('no-number-money');
  });

  it('passes Number.isInteger and ignores other packages', () => {
    expect(
      lintAt(
        'packages/exports/src/__lint-fixture-isint.ts',
        'export const ok = Number.isInteger(2);\n',
      ),
    ).toEqual([]);
    expect(
      lintAt('packages/pipeline/src/__lint-fixture-number.ts', "export const n = Number('1.5');\n"),
    ).toEqual([]);
  });
});

describe('no-raw-sql-outside-db', () => {
  const sql = 'declare function sql(s: TemplateStringsArray, ...v: unknown[]): string;\n';

  it('fails on a sql`` tag outside packages/db', () => {
    expect(
      lintAt(
        'packages/pipeline/src/__lint-fixture-sql.ts',
        `${sql}export const q = sql\`select 1\`;\n`,
      ).join('\n'),
    ).toContain('no-raw-sql-outside-db');
  });

  it('passes inside packages/db and passes a plain template string', () => {
    expect(
      lintAt('packages/db/src/__lint-fixture-sql.ts', `${sql}export const q = sql\`select 1\`;\n`),
    ).toEqual([]);
    expect(
      lintAt('packages/pipeline/src/__lint-fixture-tpl.ts', 'export const s = `select 1`;\n'),
    ).toEqual([]);
  });
});

describe('no-dangerouslySetInnerHTML', () => {
  it('fails on dangerouslySetInnerHTML in apps/web', () => {
    expect(
      lintAt(
        'apps/web/src/__lint-fixture-html.tsx',
        'export function Raw({ html }: { html: string }) {\n  return <div dangerouslySetInnerHTML={{ __html: html }} />;\n}\n',
      ).join('\n'),
    ).toContain('noDangerouslySetInnerHtml');
  });

  it('passes rendering text as a child', () => {
    expect(
      lintAt(
        'apps/web/src/__lint-fixture-text.tsx',
        'export function Safe({ text }: { text: string }) {\n  return <div>{text}</div>;\n}\n',
      ),
    ).toEqual([]);
  });
});
