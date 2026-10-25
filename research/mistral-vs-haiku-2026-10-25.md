# Mistral vs Claude Haiku 5.5: reading test, 2026-10-24/25

Owner-run test in the CTO-review thread. Aggregates only: no document content, names or IDs are recorded here. Real scans were used with the owner's consent, kept in a scratch folder and deleted afterwards.

## Setups

Same schema and instructions as the prototype (`m02-proto-v2`). Haiku = `claude-haiku-5-5`. Mistral: `mistral-ocr-4-1` (plain text, or its built-in annotation mode), `mistral-small-2603`, `mistral-medium-3-5`, `ministral-14b-2512`. "OCR →" means OCR text first, then the chat model; "direct" means the file goes straight to the model.

## Result 1: golden-v1 (18 clean documents, field accuracy)

| Setup | Accuracy |
|---|---|
| Mistral Medium 3.5 direct | 94 % |
| OCR 4.1 → Haiku 5.5 | 94 % |
| Haiku 5.5 direct | 93 % |
| Gemini baseline (earlier) | 93 % |
| OCR 4.1 → Medium 3.5 | 93 % |
| OCR 4.1 → Small / OCR 4.1 annotations | 90 % |
| Small direct | 89 % |
| Ministral 14B | 88 % |

A difference of one or two points on 18 documents is noise. Haiku never returned an invented IČO (its misses were empty fields); the Mistral models returned a wrong IČO on 2 to 3 documents.

## Result 2: owner's real scans (93 image-only pages, no labels)

No labels, so the setups were judged by self-consistency (two runs of the same page), by the deterministic checks (VAT math, IČO check digit) and by hand on two pages.

| Setup | Total differs between its own two runs | Failed VAT-math checks | IČO fails check digit |
|---|---|---|---|
| Haiku direct / OCR → Haiku | 0 of 30 | 1 / 2 | 11 / 9 |
| Small direct / OCR → Small | 28 of 59 | 43 / 12 | 21 / 14 |

- Small invents totals on pages that have none (two different invented totals for one page), and misreads upside-down totals. Haiku leaves the total empty, which is correct.
- Haiku direct beats OCR → Haiku on upside-down pages. Elsewhere they agree.
- About 1 IČO in 5 fails the check digit in every setup (scan quality turns one digit). The check catches it.
- 13 of 93 pages were blank backs. Haiku already classes them `non_document` or `unknown` for a fraction of a cent.
- Haiku direct returned no JSON on 2 large pages (cause not checked).

## Decision

Haiku 5.5 direct is the reader (decisions 2026-10-25). Mistral Small is not used. Mistral Medium 3.5 was not tried on the scans.

## Where the learnings go

| Learning | Where | Status |
|---|---|---|
| One retry when no JSON; one hinted retry when the IČO check digit fails | brief `0042a-proto-retries.md` (prototype) | todo |
| Blank pages: skip by pixel ink share (no AI), never drop a page that has text or a stamp | M01 normalization (production, `sharp`/`pdfjs-dist` already planned); not needed in the prototype | Phase 1 |
| Known-supplier memory: repeated suppliers keep one verified IČO; a new reading that differs is flagged | M02/M04 vendor priors | Phase 1 |
| IČO that fails the check digit or is unknown to ARES is never auto-accepted | already M03 `ID_*`; keep it blocking | exists |
| Scanner that makes one PDF per page splits invoices across files (header page, total page) | M01 camera bundle covers photos; joining separate files is an open question | open |
| Haiku 5.5 Batch API: 50 % off ($0.05 in / $0.25 out per MTok instead of $0.10 / $0.50; most batches done within 1 h, at most 24 h; results kept 29 days). Saves about 0.01 Kč per page. Owner decision: batch for non-urgent documents, regular calls when the user is waiting or the org's next obligation is near (from the tax profile: VAT period monthly/quarterly/identified person, paušální daň, the yearly income tax return; deadlines from the rule tables and M09 obligations); accepted that batch documents fall outside ZDR | Phase 2 (M02 §4.10, Later); prototype uses normal calls | decided |
| Prices, ZDR and batch: ZDR on request; Batch API is not covered by ZDR at Anthropic (29 days) or Mistral | `docs/v3/22-open-questions.md` L-03 | owner |
