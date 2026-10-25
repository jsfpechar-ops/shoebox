# 0010b: custom lint rules as Biome GritQL plugins

Status: done
Ticket: P0-REPO-02 (part b of 2) | Depends on: 0010a (merged into phase/0: it adds `scripts/lint/test` to the vitest `unit` project) | Base commit: head of phase/0 | Branch: task/0010b-biome-plugins | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Add the five custom lint rules (no-jsx-literal-text, no-date-now-in-domain, no-number-money, no-raw-sql-outside-db, no-dangerouslySetInnerHTML) as Biome 2 GritQL plugins scoped by `biome.json` overrides, with a test per rule, so `pnpm lint` (already the CI `lint` job) rejects them. Also fix the four Biome warnings about folder-ignore patterns.

## 2. Context

Spec (M12 §4.1, custom lint rules):

1. `no-jsx-literal-text` in `apps/web`, `packages/ui`: JSX text and `aria-label|title|placeholder|alt` string literals are errors (i18n, 03 §4).
2. `no-date-now-in-domain`: `new Date()`/`Date.now()` banned in `packages/domain` (pass a `Clock`).
3. `no-number-money`: the plugin bans `parseFloat`/`Number()` in `packages/domain`, `packages/tax-xml`, `packages/exports` (the branded `Money` type handles arithmetic by construction, later ticket).
4. `no-console`, `no-raw-sql-outside-db`: `sql\`` template tags only inside `packages/db`.

Ticket adds `no-dangerouslySetInnerHTML`. M12 §9 AC-5: a JSX literal "Uložit" in `apps/web` fails lint; `t('doc.confirm')` passes. Hard rule 1: money is never a float. Hard rule 6: every user string goes through `packages/i18n`.

**T-17 result (verified by the brief writer in a scratch copy with Biome 2.5.15, record this in your report):** Biome 2 GritQL plugins cover all five rules; ts-morph is not needed. Findings: a plugin is a `.grit` file listed under `plugins`; `overrides[].plugins` with `includes` scopes a plugin to paths (negation `!packages/db/**` works); `register_diagnostic(..., severity="error")` makes `biome ci` exit 1; `jsx_text()` and `jsx_attribute(name=$n)` node patterns work; neither tagged-template nodes nor JSX attribute initializers can be matched by node name, so those two rules match the node text with a regex (`$m <: r"..."`). Biome formats `.grit` files, so the contents below are already in Biome's format: write them exactly.

`no-dangerouslySetInnerHTML` is Biome's built-in `security/noDangerouslySetInnerHtml`, set explicitly to `error` in `biome.json`; its diagnostic category is `lint/security/noDangerouslySetInnerHtml`. `no-console` already exists (`suspicious/noConsole: error`).

The four warnings from `pnpm lint` today are `lint/suspicious/useBiomeIgnoreFolder` on `biome.json` line 9: since Biome 2.2 a folder is ignored as `!docs`, not `!docs/**`.

The test writes fixture files at real paths (names start with `__lint-fixture-`), runs `biome lint --reporter=json <file>` on each, and deletes them in `finally`. Biome's JSON reporter prints to stdout (exit 1 when errors are found); each diagnostic has `category`, `severity`, `message`. Plugin diagnostics have category `plugin` and the rule name at the start of `message`. The test below passed as written (12 tests).

Current `biome.json` is replaced whole in step 5; its current content is the one on `phase/0` (formatter 2 spaces, width 100, single quotes, rules `noExplicitAny`, `noConsole`, `useImportType`, `noNonNullAssertion` = error, `scripts/**` override with `noConsole` off). Everything in it is kept; only `files.includes`, the `security` rule and four `overrides` entries are added.

## 3. Files

| Path | Action | What |
|---|---|---|
| `tools/biome-plugins/no-jsx-literal-text.grit` | new | rule 1 |
| `tools/biome-plugins/no-date-now-in-domain.grit` | new | rule 2 |
| `tools/biome-plugins/no-number-money.grit` | new | rule 3 |
| `tools/biome-plugins/no-raw-sql-outside-db.grit` | new | rule 4 |
| `biome.json` | replace | ignore-pattern fix, `noDangerouslySetInnerHtml`, plugin overrides |
| `scripts/lint/test/custom-rules.test.ts` | new | AC-5 plus one failing and one passing fixture per rule |

No other file may change.

## 4. Steps

Setup: `git fetch origin phase/0 && git checkout -b task/0010b-biome-plugins origin/phase/0`. Confirm 0010a is in: `ls scripts/lint/test/depcruise.test.ts` must exist, else stop (§8). Write each new file with one Write call (the `.grit` files contain backticks and `$`, so use the Write tool, never a shell heredoc); do not re-read files you just wrote; do not explore. Commit after each step as `0010b step k`.

### Step 1: `tools/biome-plugins/no-jsx-literal-text.grit` (new, exact content)

```grit
// no-jsx-literal-text (M12 §4.1 rule 1): JSX text and aria-label|title|placeholder|alt string
// literals are errors in apps/web and packages/ui. Use t('key') from @shoebox/i18n.
language js

or {
  jsx_text() as $m where { $m <: not r"^\s*$" },
  jsx_attribute(name=$n) as $m where {
    $n <: or {
      `aria-label`,
      `title`,
      `placeholder`,
      `alt`
    },
    $m <: r"(?s)^[\w-]+\s*=\s*[\"'].*"
  }
} where {
  register_diagnostic(span=$m, message="no-jsx-literal-text: user-facing text goes through packages/i18n, use t('key').", severity="error")
}
```

Command: `pnpm lint 2>&1 | tail -3` → exit 0 (`Found 4 warnings.`, `Found 1 info.`; no `format` diagnostic on the new file).

### Step 2: `tools/biome-plugins/no-date-now-in-domain.grit` (new, exact content)

```grit
// no-date-now-in-domain (M12 §4.1 rule 2): packages/domain is pure, it takes a Clock.
language js

or {
  `Date.now()`,
  `new Date()`
} as $m where {
  register_diagnostic(span=$m, message="no-date-now-in-domain: packages/domain takes a Clock, never reads the wall clock.", severity="error")
}
```

Command: `pnpm lint 2>&1 | tail -3` → exit 0, as in step 1.

### Step 3: `tools/biome-plugins/no-number-money.grit` (new, exact content)

```grit
// no-number-money (M12 §4.1 rule 3, ADR-007): no parseFloat/Number() in domain, tax-xml, exports.
language js

or {
  `parseFloat($_)`,
  `Number($_)`
} as $m where {
  register_diagnostic(span=$m, message="no-number-money: money is never a float, parse amounts with Money (ADR-007).", severity="error")
}
```

Command: `pnpm lint 2>&1 | tail -3` → exit 0, as in step 1.

### Step 4: `tools/biome-plugins/no-raw-sql-outside-db.grit` (new, exact content)

```grit
// no-raw-sql-outside-db (M12 §4.1 rule 4): sql`` template tags only inside packages/db.
language js

`$x` as $m where {
  $m <: r"(?s)^sql\s*`.*`$",
  register_diagnostic(span=$m, message="no-raw-sql-outside-db: sql`` tags only inside packages/db, every query is org-scoped there.", severity="error")
}
```

Command: `pnpm lint 2>&1 | tail -3` → exit 0, as in step 1.

### Step 5: `biome.json` (replace the whole file with this exact content)

```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.15/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "files": {
    "includes": ["**", "!docs", "!research", "!testdata", "!.cursor", "!pnpm-lock.yaml"]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single"
    }
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": {
        "noExplicitAny": "error",
        "noConsole": "error"
      },
      "security": {
        "noDangerouslySetInnerHtml": "error"
      },
      "style": {
        "useImportType": "error",
        "noNonNullAssertion": "error"
      }
    }
  },
  "assist": {
    "actions": {
      "source": {
        "organizeImports": "on"
      }
    }
  },
  "overrides": [
    {
      "includes": ["scripts/**"],
      "linter": {
        "rules": {
          "suspicious": {
            "noConsole": "off"
          }
        }
      }
    },
    {
      "includes": ["apps/web/**", "packages/ui/**"],
      "plugins": ["./tools/biome-plugins/no-jsx-literal-text.grit"]
    },
    {
      "includes": ["packages/domain/**"],
      "plugins": ["./tools/biome-plugins/no-date-now-in-domain.grit"]
    },
    {
      "includes": ["packages/domain/**", "packages/tax-xml/**", "packages/exports/**"],
      "plugins": ["./tools/biome-plugins/no-number-money.grit"]
    },
    {
      "includes": ["**", "!packages/db/**"],
      "plugins": ["./tools/biome-plugins/no-raw-sql-outside-db.grit"]
    }
  ]
}
```

Command: `pnpm lint 2>&1 | tail -3` → `Checked … files …`, `Found 1 info.` (the info is Biome's pre-existing "recommended is deprecated, use preset" note, out of scope), no warnings, exit 0.

### Step 6: `scripts/lint/test/custom-rules.test.ts` (new, full test file; implement nothing else, do not edit it)

```ts
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
```

Command: `pnpm vitest run --project unit scripts/lint/test/custom-rules.test.ts 2>&1 | tail -30` → `Test Files  1 passed (1)`, `Tests  12 passed (12)`. Then `git status --porcelain | grep fixture` → prints nothing.

### Step 7: report and push (§9)

## 5. Do not touch

`apps/**`, `packages/**` (the test creates and deletes its own fixture files there at run time; never commit any), `.github/**`, `package.json`, `pnpm-lock.yaml`, `vitest.workspace.ts`, `.dependency-cruiser.cjs`, `scripts/lint/test/depcruise.test.ts`, `docs/` other than your report. Hard rules: 1 and 6 (these rules enforce them), 7 (no new dependency: no ts-morph), 8 (never push to `main`).

## 6. Commands

- `pnpm lint 2>&1 | tail -5` → exit 0, 0 warnings, 1 info.
- `pnpm vitest run --project unit scripts/lint 2>&1 | tail -30` → 2 files, 22 tests passed (10 from 0010a + 12).
- `pnpm typecheck 2>&1 | tail -10` → all tasks successful (unchanged packages).

## 7. Acceptance

- [ ] Rules no-jsx-literal-text, no-date-now-in-domain, no-number-money (`parseFloat`/`Number()` in domain, tax-xml, exports), no-raw-sql-outside-db, no-dangerouslySetInnerHTML exist and `pnpm lint` enforces them; the report records the T-17 result: "GritQL plugins (Biome 2.5.15) cover all five rules, ts-morph not used".
- [ ] `scripts/lint/test/custom-rules.test.ts`: JSX "Uložit" fails, `t('doc.confirm')` passes (AC-5); each other rule has one failing and one passing fixture; 12 tests green; no fixture file left in the tree.
- [ ] `ci.yml` runs the rules inside `lint`: true by construction (`pnpm lint` = `biome ci .` loads the plugins); no `ci.yml` change in this brief. The `depcruise` job came with 0010a.
- [ ] `pnpm lint` shows 0 warnings (the four `useBiomeIgnoreFolder` warnings are gone).

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found, or `scripts/lint/test/depcruise.test.ts` does not exist on your branch (0010a not merged yet);
- a test fails twice, or a test the brief wrote seems wrong;
- `pnpm lint` says `Failed to compile the Grit plugin` after you wrote a plugin exactly as given;
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a new dependency seems needed;
- a file outside §3 needs a change;
- §5 would be touched;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy (hand that to the owner with the exact command).

## 9. Report

Write `docs/tasks/0010b-report.md` (600 tokens at most) and set `Status: review`. Push with `git push -u origin task/0010b-biome-plugins`; the orchestrator opens and merges the PR. The report has:

1. The files changed (`git diff --stat origin/phase/0`).
2. Each command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations, and `[verify]` findings with their source (include the T-17 line from §7).
5. Questions.
6. Owner steps left.

## Risk list (for the reviewer)

`biome.json` (an override `includes` that is too narrow silently disables a rule; check the five `overrides` entries against the §2 scopes, and that `!packages/db/**` is the only exemption for `no-raw-sql-outside-db`), the four `.grit` files (byte-exact to the brief; the `no-raw-sql-outside-db` regex must keep the `^sql\s*\`` anchor or it flags every template string).

## Owner steps

None now. At the Phase 0 gate the orchestrator closes 22 T-17 with the report's finding ("GritQL plugins, ts-morph not needed") and appends it to decisions.md.
