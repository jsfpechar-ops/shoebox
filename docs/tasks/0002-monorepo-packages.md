# 0002: Monorepo packages (every ADR-010 app and package as `@shoebox/<name>`)

Status: done
Ticket: P0-REPO-01 | Depends on: 0001 | Base commit: head of phase/0 after 0001 (with 0001-cont-1 and 0001-fix-1) merges | Branch: task/0002-monorepo-packages | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Add the remaining 14 workspace packages of ADR-010 (3 apps, 11 packages) as empty `@shoebox/<name>` packages, each with `exports` and a passing smoke test, so the ticket's acceptance command passes over the whole workspace. This completes P0-REPO-01.

## 2. Context

Brief 0001 created the root tooling and `packages/domain` as the template. Copy that template exactly; the only differences per package are the name, the description and (for `ui`) the test environment and the `happy-dom` dev dependency.

ADR-010 layout (pasted; the executor never opens `docs/v3/`):

```
apps/
  web/              Next.js 15 (App Router, RSC, Server Actions), Tailwind 4, shadcn/ui; REST /api/v1
  worker/           pg-boss workers, schedulers
  email-worker/     Cloudflare Worker (inbound e-mail)
packages/
  domain/           (exists from 0001)
  db/               Drizzle schema, migrations, seeds, RLS policies, typed queries
  pipeline/         stage orchestration, idempotency, job payload schemas (zod)
  extraction/       ISDOC parser, QR decoder, PDF text, vendor templates, LLM prompts + schemas
  validation/       rule catalog (M03), each rule = pure function + metadata
  registries/       ARES REST, CRPDPH SOAP, VIES REST, ČNB rates clients (+ caching, rate limits)
  bank/             parsers (GPC/ABO, CAMT.053, MT940, CSV), e-mail notice parsers, matcher
  tax-xml/          EPO builders (DPHDP3, DPHKH1, DPHSHV; DPFDP7 partial), XSD files vendored + validator
  exports/          accountant package, Pohoda, ISDOC writer, CSV/XLSX, ZIP
  ui/               design system components, tokens (07-design-system)
  platform/         logger, telemetry, signed webhooks, file admission, LLM budget wiring, eval CLI (M12)
  i18n/             cs (source of truth) + en message catalogs (ICU)
  testkit/          factories, golden-set loader, fake registries
```

Spec: every app and package exists as `@shoebox/<name>` with `exports` and a passing `test/smoke.test.ts` (ticket acceptance). Vitest projects: `unit` (node) for all, `ui` (happy-dom) for `packages/ui` (M12 §4.1). Apps are not yet Next.js / Cloudflare projects; those come with their own tickets. No real code, no dependencies beyond the 0001 catalog (hard rule 7).

The existing template (from 0001, `packages/domain`):

`packages/domain/package.json`:
```json
{
  "name": "@shoebox/domain",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "Pure TS: Money, dates, rules engine, taxonomy, VAT routing, KH routing, ledgers. No I/O.",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    }
  },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

`packages/domain/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "."
  },
  "include": ["src", "test"]
}
```

`packages/domain/src/index.ts`: `export const packageName = '@shoebox/domain' as const;`

`packages/domain/test/smoke.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { packageName } from '../src/index';

describe('@shoebox/domain', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@shoebox/domain');
  });
});
```

## 3. Files

For each row, 5 new files: `<dir>/package.json`, `<dir>/tsconfig.json`, `<dir>/vitest.config.ts`, `<dir>/src/index.ts`, `<dir>/test/smoke.test.ts`.

| Dir | Name | Description (package.json) |
|---|---|---|
| `apps/web` | `@shoebox/web` | Next.js app: App Router, RSC, Server Actions; REST /api/v1. |
| `apps/worker` | `@shoebox/worker` | pg-boss workers and schedulers. |
| `apps/email-worker` | `@shoebox/email-worker` | Cloudflare Worker for inbound e-mail. |
| `packages/db` | `@shoebox/db` | Drizzle schema, migrations, seeds, RLS policies, typed queries. |
| `packages/pipeline` | `@shoebox/pipeline` | Stage orchestration, idempotency, job payload schemas. |
| `packages/extraction` | `@shoebox/extraction` | ISDOC parser, QR decoder, PDF text, vendor templates, LLM prompts and schemas. |
| `packages/validation` | `@shoebox/validation` | Rule catalog (M03): each rule a pure function plus metadata. |
| `packages/registries` | `@shoebox/registries` | ARES, CRPDPH, VIES and CNB clients with caching and rate limits. |
| `packages/bank` | `@shoebox/bank` | Bank statement parsers (GPC/ABO, CAMT.053, MT940, CSV), notice parsers, matcher. |
| `packages/tax-xml` | `@shoebox/tax-xml` | EPO XML builders (DPHDP3, DPHKH1, DPHSHV, DPFDP7 partial), vendored XSD validator. |
| `packages/exports` | `@shoebox/exports` | Accountant package, Pohoda, ISDOC writer, CSV/XLSX, ZIP. |
| `packages/ui` | `@shoebox/ui` | Design system components and tokens (07). |
| `packages/platform` | `@shoebox/platform` | Logger, telemetry, signed webhooks, file admission, LLM budget wiring, eval CLI (M12). |
| `packages/i18n` | `@shoebox/i18n` | Message catalogs: cs (source of truth) and en, ICU. |
| `packages/testkit` | `@shoebox/testkit` | Factories, golden-set loader, fake registries. |

Plus:

| Path | Action | What |
|---|---|---|
| `pnpm-lock.yaml` | edit | regenerated by `pnpm install` (new importers; no new versions) |
| `docs/tasks/0002-report.md` | new | report |

No other file may change. In particular `packages/domain/**` and every root file stay as 0001 left them.

## 4. Steps

Before step 1: `git checkout phase/0 && git pull && git checkout -b task/0002-monorepo-packages`. Commit after every step with the message `0002 step k`.

### Step 1: generate the 14 packages (one Bash call; 70 files)

Run exactly this from the repo root. It writes the five files per package from the 0001 template, differing only in name and description.

```bash
set -e
gen() {
  dir="$1"; name="$2"; desc="$3"
  mkdir -p "$dir/src" "$dir/test"
  cat > "$dir/package.json" <<EOF
{
  "name": "$name",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "$desc",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    }
  },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
EOF
  cat > "$dir/tsconfig.json" <<EOF
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "."
  },
  "include": ["src", "test"]
}
EOF
  cat > "$dir/vitest.config.ts" <<EOF
import { defineConfig } from 'vitest/config';

// Per-package config: without it, vitest run inside the package loads the root multi-project config and finds no tests.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
  },
});
EOF
  cat > "$dir/src/index.ts" <<EOF
export const packageName = '$name' as const;
EOF
  cat > "$dir/test/smoke.test.ts" <<EOF
import { describe, expect, it } from 'vitest';
import { packageName } from '../src/index';

describe('$name', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('$name');
  });
});
EOF
}
gen apps/web          @shoebox/web          "Next.js app: App Router, RSC, Server Actions; REST /api/v1."
gen apps/worker       @shoebox/worker       "pg-boss workers and schedulers."
gen apps/email-worker @shoebox/email-worker "Cloudflare Worker for inbound e-mail."
gen packages/db         @shoebox/db         "Drizzle schema, migrations, seeds, RLS policies, typed queries."
gen packages/pipeline   @shoebox/pipeline   "Stage orchestration, idempotency, job payload schemas."
gen packages/extraction @shoebox/extraction "ISDOC parser, QR decoder, PDF text, vendor templates, LLM prompts and schemas."
gen packages/validation @shoebox/validation "Rule catalog (M03): each rule a pure function plus metadata."
gen packages/registries @shoebox/registries "ARES, CRPDPH, VIES and CNB clients with caching and rate limits."
gen packages/bank       @shoebox/bank       "Bank statement parsers (GPC/ABO, CAMT.053, MT940, CSV), notice parsers, matcher."
gen packages/tax-xml    @shoebox/tax-xml    "EPO XML builders (DPHDP3, DPHKH1, DPHSHV, DPFDP7 partial), vendored XSD validator."
gen packages/exports    @shoebox/exports    "Accountant package, Pohoda, ISDOC writer, CSV/XLSX, ZIP."
gen packages/ui         @shoebox/ui         "Design system components and tokens (07)."
gen packages/platform   @shoebox/platform   "Logger, telemetry, signed webhooks, file admission, LLM budget wiring, eval CLI (M12)."
gen packages/i18n       @shoebox/i18n       "Message catalogs: cs (source of truth) and en, ICU."
gen packages/testkit    @shoebox/testkit    "Factories, golden-set loader, fake registries."
find apps packages -type f -not -path '*/node_modules/*' | wc -l
```

Expected: `75` (70 new files + 5 in `packages/domain`, whose `vitest.config.ts` came from 0001-fix-1).

Command check: `git status --short | wc -l | tail -30`. Expected: `15` (14 new directories plus nothing else; `apps/` and `packages/<name>` show as untracked dirs).

### Step 2: `packages/ui` runs under happy-dom

Edit `packages/ui/package.json`. Anchor (must be found verbatim with `grep -nF`):

```
    "test": "vitest run"
```

Replace with:

```
    "test": "vitest run --environment happy-dom"
```

Anchor:

```
    "typescript": "catalog:",
    "vitest": "catalog:"
```

Replace with:

```
    "happy-dom": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
```

Command: `node -e "const p=require('./packages/ui/package.json'); console.log(p.scripts.test, Object.keys(p.devDependencies).join(','))" 2>&1 | tail -30`. Expected: `vitest run --environment happy-dom happy-dom,typescript,vitest`.

### Step 3: install (lockfile gains the new importers)

```
pnpm install 2>&1 | tail -30
```

Expected: `Done in ...`, no peer errors. `git status --short pnpm-lock.yaml` shows ` M pnpm-lock.yaml`. Then `pnpm exec biome format --write apps packages 2>&1 | tail -30` (expected: nothing to fix or a few files formatted). Commit the lockfile with this step.

### Step 4: run §6, write the report (§9), push

`git push -u origin task/0002-monorepo-packages 2>&1 | tail -30`.

## 5. Do not touch

- `packages/domain/**`, every root file (`package.json`, `pnpm-workspace.yaml`, `.npmrc`, `turbo.json`, `tsconfig.base.json`, `biome.json`, `vitest.workspace.ts`, `vitest.config.ts`, `renovate.json`, `.env.example`, `.gitignore`).
- `.github/**`, `docs/**` except `docs/tasks/0002-report.md`, `research/**`, `testdata/**`, `scripts/**`.
- No dependency outside the 0001 catalog (hard rule 7). No Next.js, Tailwind, Drizzle, Wrangler yet. Never push to `main` (hard rule 8). No string copy, no money code, no SQL (hard rules 1, 3, 6: nothing of that belongs in this brief).

## 6. Commands

Test-map row "A package with no row", then the ticket's full acceptance command:

```
pnpm --filter @shoebox/ui test -- smoke 2>&1 | tail -30
pnpm --filter @shoebox/platform test -- smoke 2>&1 | tail -30
pnpm install --frozen-lockfile 2>&1 | tail -30
pnpm typecheck 2>&1 | tail -30
pnpm lint 2>&1 | tail -30
pnpm test 2>&1 | tail -30
pnpm exec vitest run --project unit 2>&1 | tail -30
```

Expected: each single-package test `1 passed`; install `Done` (`--frozen-lockfile` must not complain); typecheck and test `Tasks: 15 successful, 15 total`; lint exit 0 (`Checked N files`); root `vitest run --project unit` runs 14 test files (all but `ui`) and passes.

## 7. Acceptance

- [ ] `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test` passes on Node 22 (M12 §9 AC-1 first half).
- [ ] Root files match the M12 §4.1 table: `package.json` (pinned `packageManager`, `engines.node >=22 <23`, root scripts), `pnpm-workspace.yaml` (`onlyBuiltDependencies`), `.npmrc`, `turbo.json`, `tsconfig.base.json` (all listed strict flags), `biome.json`, `vitest.workspace.ts` (projects unit, db, ui), `renovate.json` (verbatim from M12 §4.1). (Unchanged from 0001; confirm with `git diff phase/0 -- package.json biome.json | wc -l` = `0`.)
- [ ] Every app and package of ADR-010 (+ `packages/platform`) exists as `@shoebox/<name>` with `exports` and a passing `test/smoke.test.ts` (`ls apps packages | tail -30` shows web, worker, email-worker; domain, db, pipeline, extraction, validation, registries, bank, tax-xml, exports, ui, platform, i18n, testkit).
- [ ] `.env.example` lists the secret names of M12 §4.13 with no values (unchanged from 0001).

## 8. Stop and ask

Stop, and write the report, if:

- an anchor in step 2 is not found;
- `pnpm install --frozen-lockfile` fails (the lockfile from step 3 must be committed first);
- a test fails twice, or a test the brief wrote seems wrong;
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a new dependency seems needed;
- a file outside §3 needs a change;
- §5 would be touched;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy (hand that to the owner with the exact command).

## 9. Report

Write `docs/tasks/0002-report.md` (600 tokens at most) and set `Status: review`. The report has:

1. The files changed (`git diff --stat phase/0..HEAD | tail -5`).
2. Each §6 command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations, and `[verify]` findings with their source.
5. Questions.
6. Owner steps left.

Push the branch; if you cannot open a PR, say so in the report and the orchestrator opens it.

## Risk list (for the reviewer)

`packages/ui/package.json` (happy-dom only here), `pnpm-lock.yaml` (no new package versions, only new importers), and that `packages/domain` has no dependency besides the catalog dev tools.

## Owner steps

None.
