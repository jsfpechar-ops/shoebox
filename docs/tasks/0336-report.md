# 0336 report

Status: blocked
Reason: brief §8 stop. `pnpm install --offline` needs the network (ERR_PNPM_NO_OFFLINE_META: cannot resolve vite@8.3.4 for apps/email-worker in the offline package cache). The filtered run `pnpm --filter @shoebox/tax-xml install --offline` fails the same way. The `@shoebox/domain` workspace link is therefore not created, and the tests cannot import `@shoebox/domain`.

Done: step 0 only (§3 `packages/tax-xml/package.json` edit: `"dependencies": { "@shoebox/domain": "workspace:*" }`). Left uncommitted in the worktree; the lockfile is not updated.

Left: steps 1 to 6 (xml.ts, forms.ts, validate.ts, the three manifests, index.ts, test/validate.test.ts), then the test and typecheck commands from §6, then Biome.

Checks run: none (no tests run; the install blocked before any check).

Owner step: on a machine with network, in the worktree run `pnpm install` (or `pnpm --filter @shoebox/tax-xml install`), commit the resulting `pnpm-lock.yaml` change with the package.json edit, then restart the executor at step 1.

Deviations: none so far.
Questions: may the orchestrator allow a network install for this one step, or should the owner run it?
