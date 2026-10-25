# 0051 report: Document page

Status: review

## Files changed (git diff --stat, base phase/0 to HEAD)

- `packages/i18n/messages/en.json` (+10)
- `apps/web/src/documents/detail-data.ts` (new): `detailOf`, `loadDocumentDetail`
- `apps/web/test/detail-data.test.ts` (new): brief test, biome formatting only
- `apps/web/app/(app)/inbox/[id]/page.tsx` (new): document page
- `apps/web/app/(app)/inbox/page.tsx` (row title is a link)

## Commands (last lines)

- Step 1 `pnpm --filter @shoebox/i18n test`: `Test Files 3 passed (3)`, `Tests 24 passed (24)`
- Step 2 `pnpm --filter @shoebox/web exec vitest run test/detail-data.test.ts`: `Tests 3 passed (3)`
- Step 3 `pnpm --filter @shoebox/web typecheck`: clean (tsc, no errors)
- Step 4 `pnpm exec biome check --write <paths>`: first run reported one lint error (noArrayIndexKey in the page), fixed by keying checks on key plus params; final run `Checked 96 files ... No fixes applied.`
- Step 4 `pnpm exec biome ci apps/web packages/i18n`: `Checked 96 files in 6s. No fixes applied.` `Found 1 warning.` (no errors)
- Step 4 `pnpm --filter @shoebox/web typecheck`: clean
- `check:i18n` script: not present in apps/web/package.json, skipped

## Acceptance (§7)

- [x] Test file unchanged apart from biome formatting; passes. i18n test passes.
- [x] No literal UI text in the new `.tsx` files; no raw colors; no `text-sm`/`text-xs`/`text-muted-foreground`.
- [x] Typecheck clean; biome ci has no errors.

## Deviations

- The brief gives signatures only for `detail-data.ts`; the bodies of `detailOf` and `loadDocumentDetail` are written to match the brief's rules and the test.
- The unused `LegalDate` type import from the brief's header was removed.
- Blocking checks get a `Badge` (tone `warning`) labelled with the existing key `status.badge.needs_review`. No new keys beyond step 1.
- `StatusBadge` gets `processingSince` only when processing, as on the inbox page.
- Biome reports one warning, `noImgElement`, on the `<img>` in the page. The brief requires `<img>`, so it is left as is.
- No PR is opened: the executor cannot push. The branch is local at HEAD.

## Questions

- None blocking. Confirm whether the warning is acceptable or whether the image should use `next/image`.

## Owner steps left

- Push `task/0051-document-detail` and open the PR against `phase/0`.
