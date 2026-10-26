# 0102 report

Status: review

## Files changed (vs branch start, steps 1-4)
- packages/i18n/messages/en.json (+1 key: inbox.upload.heic_unsupported)
- apps/web/test/prepare-image.test.ts (new, as given)
- apps/web/src/documents/prepare-image.ts (new)
- apps/web/src/documents/upload-dropzone.tsx (prepare before send, HEIC accept, unreadable notice)
- docs/tasks/0102-phone-photos.md (Status: review), docs/tasks/0102-report.md (new)

Note: `git diff --stat origin/phase/0` lists 22 files because this branch also carries 0101 and other commits not on origin/phase/0. The brief's acceptance check cannot be met literally on this branch.

## Commands (last lines)
- `pnpm --filter @shoebox/i18n test`: 3 files, 24 tests passed.
- `pnpm --filter @shoebox/web test -- prepare-image`: the `--` passed the filter through, so all 24 web test files ran: 172 tests passed (includes prepare-image).
- `pnpm --filter @shoebox/web typecheck`: no errors.
- `pnpm exec biome check apps/web/src/documents apps/web/test packages/i18n`: first run failed on one long ACCEPT line in upload-dropzone.tsx; formatted that file, amended step 4. Re-check: "Checked 50 files ... No fixes applied", clean.

## Section 7
- [ ] Tests pass; CI green: local tests pass, CI not yet checked.

## Deviations
None beyond the biome formatting fix above. Done: steps 1 to 4. Left: none.

## Questions
None.

## Owner steps left
Review PR when opened by owner's process; do not merge to main from here.
