# 0322 report: vendor memory

Status: review

## Files changed
- apps/worker/src/categorize/vendor-memory.ts (new): learnVendorProfile, applyRelearnAnswer, confirmationOf, relearnPayload, emptyProfile
- packages/db/src/vendor-memory.ts (new): saveVendorProfile, openDocumentsOfPartner, insertRelearnQuestion
- packages/db/src/index.ts: one export line
- apps/worker/src/categorize/handler.ts: optional store functions, learning step after save
- apps/worker/test/vendor-memory.test.ts (new, from the brief, reformatted by biome)

## Checks
- vitest vendor-memory: 7 passed
- vitest categorize-job: 6 passed
- worker typecheck, db typecheck: clean
- biome check on changed paths: clean

## Deviations and questions
- Biome reformatted the brief's test file (whitespace only). No test logic changed.
- multiCategory: read as "at least 2 distinct category codes on item lines with classificationSource user". Please confirm.
- Relearn answers apply only in question_answered runs. Risk: an answered relearn question is re-applied by later question_answered runs of the same document, because there is no applied marker. Needs a fix or an owner decision.
- `always` pins the profile when any lines[*].remember user field is always. `vendor` or `always` counts as a confirmation.
- Subject hint is taken only from a user-sourced summary.subject field. A null hint removes the subject_cs key.
- Handler saves once per run (relearn and confirmation merged) and computes the threshold crossing against the stored profile. Relearn saves set last_confirmed_at to now.
- Not pushed. No PR opened.

## Owner steps
None.
