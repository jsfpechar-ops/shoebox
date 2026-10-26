# 0421 report

Status: review

Built the podklady page blocks (categories with drill-down, comparison, flat-rate tax, assets and private use, VAT line) and the optional questions form; `PrepareSummaryButton` takes `answers`. K-D04 removed.

- web tests, typecheck, biome, i18n tests, context lint: pass.
- Deviation: `summary-blocks.tsx` is named `summary-blocks-view.tsx`, because `.ts` and `.tsx` with the same base name collide on import.
