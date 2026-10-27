# 0611 report
Status: review

Files: ares.ts + types.ts (searchByName), worker handler.ts + registry-checks.ts (ARES IČO repair, optional `ares` dep), checks.ts (no buyer.missing), en/cs.json, tests.
Commands: validation 57 pass; registries 19 pass; worker doc-extract 205 pass; i18n 24 pass; typecheck of the three clean; biome clean.
Deviations: 0610 not merged, so the row uses severity `warning` (TODO(0610) in handler.ts). `proto.check.buyer.missing` removed from en/cs (unused). `toWrite` in the handler is now async.
Note: context_lint fails on docs/tasks/0614 (missing Status line), not from this brief.

## 1. Objective

None

## 2. Context

-

## 3. Files

As named in §2 and §4.

## 4. Steps

As in §1 and §3.

## 5. Do not touch

None

## 6. Commands

None

## 7. Acceptance

- [ ] Tests pass, typecheck clean, no float on money, copy only in `en.json`.

## 8. Stop and ask

As in TEMPLATE.md §8.

## 9. Report

None
