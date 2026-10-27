# 0604 report

Status: review

## Files changed

- `apps/web/src/documents/trust.ts` (new): `Trust`, `CHECK_FIELDS`, `fieldsFlagged`, `trustOf`.
- `apps/web/test/field-trust.test.ts` (new): one case per rule branch, unknown and missing source, check-to-field map.
- `apps/web/src/documents/detail-data.ts`: `DetailField.trust`; `detailOf` takes an optional 5th argument (current `document_fields` rows) and computes trust per field; loader adds an org-scoped `document_fields(field_key, source)` select with `is_current = true` (a failed select only drops the hint).
- `apps/web/test/detail-data.test.ts`: fixture expectation gets `trust: 'checked'`; one new trust case.
- `apps/web/app/(app)/inbox/[id]/page.tsx`: a `TrustMark` (word + icon) after each value; a `HelpTip` beside "What we read".
- `packages/i18n/messages/en.json`: `doc.trust.exact`, `doc.trust.checked`, `doc.trust.check`, `doc.trust.help`.

## Commands

- `pnpm --filter @shoebox/web test -- field-trust detail-data 2>&1 | tail -30`: pass. The filter was not applied (vitest ran all 54 files): `Test Files 54 passed (54)`, `Tests 351 passed (351)`.
- `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`: clean, 0 errors.

## Acceptance (brief §7)

- [x] Tests pass, typecheck clean, copy only in `en.json`, query org-scoped.

## Deviations

- Brief named `AlertTriangle`; used `TriangleAlert` (same icon, the name the repo already uses).
- `CHECK_FIELDS` keys are the check ids derived from `rule_id` (`PROTO_` prefix stripped, lower case). Field keys follow the M02 grammar (`totals.gross`, `supplier.ico`, `dates.due_date`, `payment.account_number`, ...).
- `HelpTip` is imported from `src/overview/help-tip.tsx` (not edited) and reused, instead of a new component.
- Commit trailer: the harness attribution (Co-Authored-By Haiku 5.5) was used, not the Opus 5.5 line from the spawn message.

## Questions

- A value with no `document_fields` row (e.g. from the registry or vendor memory) is shown as `checked` when not flagged. The brief's rules give no separate outcome for it; say if it should be `check`.

## Owner steps left

- None for this brief. Merge to `phase/0` follows the normal process; no push or PR was made here.
