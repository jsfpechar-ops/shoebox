# 0361 report

Status: review (not pushed, not merged; orchestrator to review wt-0361)

## Files changed (git diff --stat vs base)

- packages/exports/package.json (+pdf-lib 1.17.1)
- pnpm-lock.yaml (+3 lines, exports importer only)
- packages/exports/src/podklady-pdf.ts (new)
- packages/exports/src/index.ts (export buildPodkladyPdf, formatKc, podkladyPdfLines, transliterate)
- packages/exports/test/podklady-pdf.test.ts (new, verbatim from brief, not edited)

## Checks

- `pnpm --filter @shoebox/exports exec vitest run test/podklady-pdf`: 7 passed, 0 failed.
- `pnpm --filter @shoebox/exports typecheck`: clean.
- `biome check` on src/podklady-pdf.ts and src/index.ts: clean (after biome --write formatting).
- `biome check` on test/podklady-pdf.test.ts: format, organizeImports and noAssignInExpressions findings, all from the verbatim brief text. Not edited (brief rule: never change a test the brief wrote).
- S2 fixture page count: 2 pages (3234 bytes), limit 4.

## Deviations

- formatKc separates thousands with an ASCII space (the test expects "141 540 Kč"), not a thin space.
- transliterate is applied at draw time, so Kč renders as "Kc" in the PDF (č is outside WinAnsi).
- Flat-rate direction key: podklady.flat.lower / higher / equal from baseFlat vs baseActual (brief gave only the lower case).
- index.ts exports only the four named functions; PDF_MIME is exported from the module only.
- Commit trailer: Co-Authored-By Claude Haiku 5.5 (the attribution setting for this session), not the Opus line in the task message.

## Questions

- None blocking.

## Owner steps left

1. Decisions line: "2026-10-26 [deps] pdf-lib 1.17.1 in packages/exports (already in extraction); Helvetica + transliteration until a Unicode font is chosen (TODO(decision-pdf-font))".
2. Later: pick a font file so Czech names render with diacritics (separate brief).
