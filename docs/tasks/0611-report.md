# 0611 report
Status: review

Files: ares.ts + types.ts (searchByName), worker handler.ts + registry-checks.ts (ARES IČO repair, optional `ares` dep), checks.ts (no buyer.missing), en/cs.json, tests.
Commands: validation 57 pass; registries 19 pass; worker doc-extract 205 pass; i18n 24 pass; typecheck of the three clean; biome clean.
Deviations: 0610 not merged, so the row uses severity `warning` (TODO(0610) in handler.ts). `proto.check.buyer.missing` removed from en/cs (unused). `toWrite` in the handler is now async.
Note: context_lint fails on docs/tasks/0614 (missing Status line), not from this brief.
