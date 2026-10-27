# 0604: Mark the values the user should check

Status: todo
Ticket: GAP-02 (owner go 2026-10-26 23:02) | Depends on: none | Base commit: 886fc60 | Branch: claude/project-thread-7b9jcx | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

On the document page every value looks equally certain. Mark each value with how sure we are, so the user only looks at the few that need a check: "Exact" (read from the file's ISDOC/QR/text), "Checked" (read by AI and every check on it passed), "Please check" (AI read it and a check on it failed or warned, or it is empty but needed).

## 2. Context

- Our confidence is deterministic, not the model's guess (hard rule 2): it comes from the field's `source` and the checks.
- `document_fields` rows: `field_key`, `source` (`FIELD_SOURCE_VALUES` in `packages/domain/src/enums/index.ts`: e.g. `isdoc`, `qr`, `pdf_text`, `template`, model sources, `user`), `is_current`.
- `apps/web/src/documents/detail-data.ts`: `DetailField { label; value; kind }`, `DetailCheck { severity; key; params }`, `detailOf(...)` (pure) and `loadDocumentDetail` (loads rows). `apps/web/src/documents/correction.ts` `EDITABLE` maps field keys (e.g. `totals.gross`) to labels.
- Checks are `validation_results` rows; their `params` and `rule_id` say which field they concern. Read `packages/validation/src/proto-checks/checks.ts` to build a map from check id to the field keys it concerns (e.g. `vat_sum`, `totals_math` → `totals.net`, `totals.vat`, `totals.gross`; IČO check → `supplier.ico`). Put the map in the new file, not in the validation package.
- The page that renders fields is `apps/web/app/(app)/inbox/[id]/page.tsx`.
- Copy in `packages/i18n/messages/en.json` only; design tokens only (use existing success/warning tokens from `packages/ui`); add a HelpTip-style "?" explaining the three marks. Text at body size.

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/web/src/documents/trust.ts` | new | `type Trust = 'exact' \| 'checked' \| 'check'`; `CHECK_FIELDS: Record<string, readonly string[]>`; `trustOf(input: { source: string \| null; value: string; failedOrWarnedFields: ReadonlySet<string>; fieldKey: string }): Trust` and `fieldsFlagged(checks): Set<string>` |
| `apps/web/test/field-trust.test.ts` | new | tests |
| `apps/web/src/documents/detail-data.ts` | edit | `DetailField` gets `trust: Trust`; load current `document_fields(field_key, source)` org-scoped; compute trust in `detailOf` |
| `apps/web/test/detail-data.test.ts` | edit | update fixtures for the new field, add one trust case |
| `apps/web/app/(app)/inbox/[id]/page.tsx` | edit | show a small mark next to each value; "Please check" ones first in reading order is NOT required, keep order |
| `packages/i18n/messages/en.json` | edit | `doc.trust.exact`, `doc.trust.checked`, `doc.trust.check`, `doc.trust.help` |

No other file may change.

## 4. Steps

1. `trust.ts` rules, in order: source `user` → `checked`; source in {`isdoc`,`qr`,`pdf_text`} and field not flagged → `exact`; value empty → `check`; field flagged → `check`; otherwise → `checked`. Tests cover each branch plus an unknown source.
2. Wire into `detail-data.ts` (pure function stays pure; the loader adds the extra select with `.eq('org_id', …)`).
3. Render: one short word with an icon from `lucide-react` (already a dependency): `exact` CheckCheck, `checked` Check, `check` AlertTriangle in the warning token. Screen-reader text is the word itself.
4. Run §6.

## 5. Do not touch

`packages/validation`, `packages/extraction`, `fix-field.tsx`, `correction.ts`, `pdf-viewer.tsx`. Hard rules 2, 3, 6.

## 6. Commands

- `pnpm --filter @shoebox/web test -- field-trust detail-data 2>&1 | tail -30` → pass.
- `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` → 0 errors.

## 7. Acceptance

- [ ] Tests pass, typecheck clean, copy only in `en.json`, query org-scoped.

## 8. Stop and ask

As in TEMPLATE.md §8.

## 9. Report

Write `docs/tasks/0604-report.md` (600 tokens at most), set `Status: review`, commit with message `0604: mark values exact, checked or please check`. Do not push.
