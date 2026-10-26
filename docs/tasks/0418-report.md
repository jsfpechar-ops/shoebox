# 0418 report

Status: review

Built: card-view.ts (+ test), vat-actions.tsx, vat-cards.tsx, preview-view.tsx, `/prehled/dph/[periodStart]` page, Přehled wiring, en.json `vat.*` keys, K-D03.

Checks: card-view tests 12/12; web typecheck clean; i18n tests 24/24; biome clean; context lint OK.

Deviations:
- Test lives at `apps/web/test/vat-card-view.test.ts` (vitest only includes `test/**`).
- Catalog test needs lowercase keys: `vat.reason.s_pending_documents`, `vat.form.dphdp3` (not uppercase codes); `reasonText` lowercases the code.
- `vat.submit.checked` has no TODO text (user-visible); `TODO(verify)` is a code comment in preview-view.tsx.

Owner steps: none.
