# 0420 report

Status: review

Built: VAT_WORKBOOK download decision, `workbookFilingId` on cards, xlsx action for needs_accountant, `DownloadButton` (fetch, friendly 409/403 messages) used in VAT and podklady cards, i18n keys, K-D03 removed, decision logged.
Checks: web tests 329 pass, typecheck clean, i18n tests 24 pass, context lint OK, biome clean (one existing img warning).
Deviations: preview-view.tsx needed no edit (uses VatActionView). To fit lint cap I trimmed two older lines in decisions.md (line 22, 32) and shortened the new line.
