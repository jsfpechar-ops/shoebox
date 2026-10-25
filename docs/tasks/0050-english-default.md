# 0050: English as the app's language for now, Czech kept dormant

Status: review
Ticket: owner decision 2026-10-25 [i18n] | Depends on: none | Base commit: see branch | Branch: task/0050-english-default | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

The UI renders in English by default, and English becomes the catalog that defines the message keys. The Czech catalog stays in the repo but is optional: a key missing in Czech is no error, so new work writes English only and saves tokens. Czech comes back later by switching the default.

## 2. Context

- Owner, 2026-10-25: "make the app in English for now so we don't spend tokens on translation, I'll want Czech once we finish the app or get further but keep the translations hidden somewhere for future use."
- `packages/i18n/src/index.ts` today (excerpt):

```ts
/** Czech is the source of truth; every other locale must have every Czech key. */
export type Locale = 'cs' | 'en';
export type MessageKey = keyof typeof cs;
export type Catalog = Readonly<Record<MessageKey, string>>;

// Assigning `en` to Catalog makes a missing English key a typecheck error as well as a test failure.
export const catalogs: Readonly<Record<Locale, Catalog>> = { cs, en };
```

  and at the end:

```ts
/** Czech translator, the default for server code and tests. */
export const t: Translate = createT('cs');
```

- `packages/i18n/test/catalog.test.ts` has `it('en has every cs key and no extra key', ...)`, a key-shape test over `Object.keys(cs)`, and `describe('t', ...)` tests that expect Czech from `t`.
- `apps/web/app/layout.tsx` has `<html lang="cs" data-theme={theme}>`.
- Number and date formatting (`formatMoney`, `formatLegalDate` in `packages/ui`) stay Czech-style (CZK amounts); do not change them.
- The prototype checks (`renderProtoChecks(results, locale = 'cs')` in `packages/validation`) keep their own default; do not change validation.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/i18n/src/index.ts` | edit | English keys and default, Czech partial with English fallback |
| `packages/i18n/test/catalog.test.ts` | edit | tests below |
| `apps/web/app/layout.tsx` | edit | `lang="en"` |
| `packages/ui/test/*.test.tsx` | edit | only expectations of rendered Czech copy, now English |
| `apps/web/test/*.test.ts` | edit | only expectations of rendered Czech copy, now English |
| `apps/web/e2e/*.spec.ts`, `apps/web/e2e/fixtures.ts` | edit | only text locators/assertions of Czech UI copy, now English |

No other file may change.

## 4. Steps

1. Edit `packages/i18n/src/index.ts`: replace the first excerpt with

```ts
/**
 * English is the source of truth for now (owner 2026-10-25): it defines the keys and is the default.
 * Czech is kept dormant: it may miss keys, and a missing Czech key falls back to English.
 */
export type Locale = 'cs' | 'en';
export type MessageKey = keyof typeof en;
export type Catalog = Readonly<Record<MessageKey, string>>;

export const DEFAULT_LOCALE: Locale = 'en';

// Assigning `en` to Catalog keeps it complete; Czech is partial until it comes back.
export const catalogs: Readonly<{ en: Catalog; cs: Partial<Catalog> }> = { cs, en };
```

   In `createT`, read the message as `catalogs[locale][key] ?? catalogs.en[key]`. Replace the last excerpt with

```ts
/** English translator, the default for server code and tests (DEFAULT_LOCALE). */
export const t: Translate = createT(DEFAULT_LOCALE);
```

   If `import cs from '../messages/cs.json'` now gives a type error for extra keys, cast it: `cs as Partial<Catalog>`. Run `pnpm --filter @shoebox/i18n typecheck 2>&1 | tail -30`. Commit `0050 step 1`.
2. Edit `packages/i18n/test/catalog.test.ts`: replace the test `'en has every cs key and no extra key'` with `it('cs has no key that en lacks', () => { const extra = Object.keys(cs).filter((k) => !(k in en)); expect(extra).toEqual([]); });`; make the key-shape test use `Object.keys(en)`; change `describe('t', ...)` to expect English from `t` (`'Upload documents'`, `'1 document'`, `'5 documents'`, and for `review.progress` use the value in `en.json`), and add `it('renders Czech through createT, falling back to English', ...)` that checks `createT('cs')('inbox.upload.cta')` is `'Nahrát doklady'`. Run `pnpm --filter @shoebox/i18n test 2>&1 | tail -30`. Expected: pass. Commit `0050 step 2`.
3. Edit `apps/web/app/layout.tsx`: `lang="cs"` → `lang="en"`. Commit `0050 step 3`.
4. Run `pnpm --filter @shoebox/ui test 2>&1 | tail -40` and `pnpm --filter @shoebox/web test 2>&1 | tail -40`. For each failure that only expects Czech UI copy, change the expectation to the English text from `packages/i18n/messages/en.json` (or to `t('<key>')`). Do not change any source file in `packages/ui/src` or `apps/web/src`. Commit `0050 step 4`.
5. E2E on Chromium only (never run `playwright install`): `PLAYWRIGHT_BROWSERS_PATH=/tmp/claude-0/-home-user-leonoperations/fec3a6c0-307f-53e5-ae9f-913c435a941b/scratchpad/pw pnpm --filter @shoebox/web e2e -- --project=setup --project=desktop-chromium --project=mobile-chromium 2>&1 | tail -40`. Change Czech text locators and assertions in `apps/web/e2e` to the English copy. Specs that are skipped without live credentials (`auth-live.spec.ts`): update their Czech strings by reading `en.json`, without running them. Commit `0050 step 5`.
6. Run `pnpm exec biome ci packages/i18n packages/ui apps/web 2>&1 | tail -30` and `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`. Expected: clean. Commit `0050 step 6`.

## 5. Do not touch

`packages/i18n/messages/*.json` (no key added or removed), `packages/ui/src/**`, `apps/web/src/**`, `apps/web/app/**` except `layout.tsx`, `packages/validation/**`, number/date formatting.

## 6. Commands

The commands of steps 1–6, each ending `2>&1 | tail -30`.

## 7. Acceptance

- [ ] `t('inbox.upload.cta')` is `Upload documents`; `createT('cs')` still renders Czech.
- [ ] i18n, ui and web unit tests pass; e2e on Chromium passes (or the reason is in the report).
- [ ] Only expectation lines changed in test and spec files (`git diff --stat` matches §3).

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found;
- a test fails twice, or a test the brief wrote seems wrong;
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a new dependency seems needed;
- a file outside §3 needs a change;
- §5 would be touched;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy (hand that to the owner with the exact command).

## 9. Report

Write `docs/tasks/0050-report.md` (600 tokens at most) and set `Status: review`. The report has the files changed, each command with the last 5 lines of output, §7 ticked, deviations, questions, owner steps left.

## Risk list (for the reviewer)

`packages/i18n/src/index.ts`.

## Owner steps

None.
