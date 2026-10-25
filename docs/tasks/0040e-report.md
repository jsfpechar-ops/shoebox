# 0040e report

Status: review

## Check summary (`pnpm proto:report`, fake client, invented data)
- Runs: 3 (failed: 0, retries: 0)
- Documents: 2 (labeled: 1)
- Label revisions: 2
- Parse issue rate: 0 %, not end_turn: 0

## Axe
0 violations (@axe-core/playwright present), run at 375 px.

## Screenshots (not committed)
- 1440 px: three columns (queue, preview, form); form fields, checks list and usage line all readable, no overlap or cut-off. The 10x10 test PNG shows as a tiny dot in the preview, as expected.
- 375 px: single column, scrollWidth 375 = viewport, no horizontal scroll, no overlap; buttons wrap cleanly.

## Fixes
1. After a reload the queue order followed the IndexedDB key (hash), not upload order. File records now carry `added_at` and are sorted on load.

## Deviations
- Work started from origin/phase/0 (includes 0040d), not base cba65e2.
- Probe in the session scratchpad instead of /tmp/probe, deleted at the end.
- One console 404 on load (most likely favicon), not investigated.

## Questions / owner steps
None beyond 0040d.
