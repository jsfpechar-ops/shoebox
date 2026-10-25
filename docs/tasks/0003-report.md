# 0003 report: CI base workflow

Status: review. Branch `task/0003-ci-base` from `origin/phase/0` (588867d). Steps 1 to 8 done.

## 1. Files changed (`git diff --stat origin/phase/0`)

```
.github/actions/setup/action.yml |  26 +++++
.github/workflows/ci.yml         |  75 +++++++++++++++
docs/tasks/0003-ci-base.md       |   2 +-
package.json                     |   2 +
pnpm-lock.yaml                   | 198 +++++++++++++++++++++++++++++++++++----
pnpm-workspace.yaml              |   1 +
vitest.config.ts                 |  13 +++
7 files changed, 298 insertions(+), 19 deletions(-)
```

Step commits: `0003 step 1` (fb0f26e), `0003 step 2` (a9c71bb), `0003 step 3` (97df617), `0003 step 4` (e05b882), `0003 step 5` (d9d6fa4), `0003 step 6` (06b2891). The report commit follows.

## 2. Commands (last lines)

- `pnpm lint`: `Checked 87 files in 17ms. No fixes applied.` / `Found 4 warnings.` / `Found 1 info.` (Biome warnings on `biome.json` ignore patterns, existing, not in scope; no errors.)
- `pnpm typecheck`: `Tasks: 16 successful, 16 total` / `Cached: 0 cached, 16 total` / `Time: 7.147s`
- `pnpm test:unit`: `Test Files 16 passed (16)`, `Tests 16 passed (16)`, `% Coverage report from v8`, `Statements: 100%`, `Branches: 100%`, `Functions: 100%`, `Lines: 100% (16/16)`. No `ERROR: Coverage`.
- `python3 scripts/context_lint.py`: 3 warnings about `packages/domain/rules` and the open briefs, `WARN 7 commit(s) touched apps/ or packages/ after the last status.md update`, `next free: task 0010 | migration 0001`, `context lint: OK`.
- Broken-link proof: `exit=1`; `ERROR docs/context/known-issues.md: link target missing: no-such-file.md`; `context lint: FAIL`. Then `git checkout -- docs/context/known-issues.md`; `git status --short` is empty.
- Pin greps: setup action `2`, `ci.yml` `5`. YAML check: `yaml ok`.

## 3. §7 acceptance

- [x] `ci.yml` has jobs `setup`, `lint`, `typecheck`, `unit`, `context-lint`; every `uses:` pinned by a 40-character SHA (greps 2 and 5).
- [x] Thresholds in `vitest.config.ts` (domain 90, validation 90, tax-xml 85 lines); `pnpm test:unit` passes locally.
- [ ] PR run green and broken-link PR red: NOT done by the executor. Orchestrator and owner steps (see §6).

## 4. Deviations and findings

- Step 4 and the `vitest.config.ts` rewrite: `vitest.config.ts` was written with the Write tool; the Bash heredoc was refused by the worktree guard. Content is exactly as the brief gives.
- The proof in §6 used `/tmp/0003-cl.out` instead of the scratchpad. The file was removed.
- Vitest prints a Vite warning: `import "./vitest.workspace" without a file extension`. It is a warning, not an error. The brief says `vitest.workspace.ts` stays unchanged, so it is left as is.
- `pnpm install` added the `@vitest/coverage-v8` 4.1.11 entry and its dependencies to `pnpm-lock.yaml`. No peer conflict.
- The security hook flagged `ci.yml`. Checked: no untrusted `github.event.*` input appears in any `run:` line. The only dynamic value is the `concurrency.group` key, which is not a shell context.
- `pnpm lint` exits with warnings, not errors (see §2). The `lint` job runs `pnpm lint`, which is fine for CI as long as Biome reports no errors.

## 5. Questions

- Biome warnings (`biome.json` ignore patterns in the `files` section) are existing. Should the `lint` job fail on warnings? Not changed here; the brief does not say.

## 6. Owner and orchestrator steps left

1. Open PR `task/0003-ci-base` to `phase/0`. Wait for `setup`, `lint`, `typecheck`, `unit`, `context-lint` to be green. Copy the run link into the review.
2. Broken-link proof on GitHub (branch `test/0003-broken-link`, draft PR, expect `context-lint` red). Copy the run link, close without merge, delete the branch.
3. Merge the 0003 PR into `phase/0`.
4. Josef, later: branch ruleset for `main` and `phase/*` requiring the five checks.
