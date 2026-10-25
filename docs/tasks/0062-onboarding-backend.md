# 0062: Onboarding backend (IČO lookup, create firm, gate)

Status: review
Ticket: P1-ONB-01 (onboarding from IČO) | Depends on: 0060, 0061 | Base commit: branch head | Branch: claude/project-thread-e840r7 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

The server side of `/vitejte`: look up an IČO in ARES and turn the answer into prefilled values, validate the user's three answers, create the firm through `public.create_firm` (0061), and send a signed-in user without a firm to `/vitejte`. The screen itself is 0063.

## 2. Context

- `@shoebox/registries` (0060) exports `createAresClient({ baseUrl?, fetch?, timeoutMs?, now? })`, `isValidIco(s)`, types `AresSubject`, `RegistryResult`. `AresSubject.sidlo` has `nazevUlice, cisloDomovni, cisloOrientacni, nazevObce, nazevCastiObce, psc (number), textovaAdresa, kodStatu`; also `dic`, `datumVzniku`, `financniUrad`, `dphAktivni`.
- `public.create_firm(p jsonb)` (0061) takes `{name, ico, dic, vat_status, vat_period, tax_regime, pausal_rate, pausal_dan_band, valid_from, address, fu_code, slug_base}` and returns `{org_id, inbound_email_slug, inbound_email_secret}`. It raises `already_has_firm`, `invalid_profile`, `not_authenticated`. Combination rules: payer needs `vat_period`; non-payer has none; identified person → monthly; `pausalni_vydaje` needs `pausal_rate` ∈ {80,60,40,30}; `pausalni_dan` needs `pausal_dan_band` ∈ {1,2,3} and not payer.
- M11 §5.5: ARES down → manual fields, never block. Org name defaults to the ARES name. `valid_from` = 1 Jan of the current year, or the ARES `datumVzniku` if later. "Nevím" for the expense regime sets `danova_evidence` (`TODO(review-question confirm_profile)`: the `review_questions` row comes with M03 work).
- Server actions pattern: `apps/web/src/auth/actions.ts` (`'use server'`, `createSupabaseServerClient()` from `../supabase/server`, zod `safeParse`, never expose provider messages). Errors are codes; the UI maps them to `onboarding.error.<code>` keys (0063).
- The inbound address is `{slug}-{secret lower-case}@{domain}`; domain from env `SHOEBOX_INBOUND_DOMAIN`, default `in.shoebox.cz` with `TODO(decision-inbound-domain)`.
- The login thread owns `apps/web/src/auth/**`, `apps/web/e2e/fixtures.ts`, the login e2e specs: do not touch them. After first sign-in the user reaches `/inbox`; the `(app)` layout gate sends a firm-less user to `/vitejte`. The gate must do nothing when the memberships query errors (the e2e fake server has no PostgREST), so existing e2e still land on `/inbox`.
- Hard rules: Czech first (no user-facing strings in this brief; codes only), no personal data in logs (log nothing), every query org-scoped / under the user session (RLS).

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/web/package.json` | edit | add `"@shoebox/registries": "workspace:*"` to dependencies (alphabetical) |
| `pnpm-lock.yaml` | edit | via `pnpm install` only |
| `apps/web/src/onboarding/prefill.ts` | new | pure ARES → prefill |
| `apps/web/src/onboarding/schema.ts` | new | zod schema + mapping to `create_firm` input |
| `apps/web/src/onboarding/gate.ts` | new | `needsOnboarding` |
| `apps/web/src/onboarding/actions.ts` | new | server actions |
| `apps/web/app/(app)/layout.tsx` | edit | call the gate |
| `apps/web/test/onboarding-prefill.test.ts` | new | tests |
| `apps/web/test/onboarding-schema.test.ts` | new | tests |
| `apps/web/test/onboarding-gate.test.ts` | new | tests |

No other file may change.

## 4. Steps

1. `package.json` dep, then `pnpm install 2>&1 | tail -5` (lockfile changes only for the workspace link).

2. `prefill.ts`:
```ts
import type { AresSubject } from '@shoebox/registries';
export interface FirmAddress { street: string; house_number: string | null; orientation_number: string | null; city: string; zip: string; country: string }
export interface OnboardingPrefill {
  ico: string; name: string; dic: string | null; address: FirmAddress;
  addressText: string;                 // one line for the confirmation card
  fuCode: string | null;
  vatGuess: 'platce' | 'neplatce';     // from dphAktivni; the user confirms with a chip
  validFrom: string;                   // YYYY-MM-DD
  slugBase: string;
}
export function slugify(name: string): string;
export function validFromFor(today: string, datumVzniku: string | null): string;
export function prefillFromAres(subject: AresSubject, today: string): OnboardingPrefill;
```
   - `slugify`: NFD, drop combining marks, lower-case, every run of non `[a-z0-9]` → `-`, trim `-`, cut to 30 chars, trim `-` again; empty → `firma`. `'Josef Novák'` → `josef-novak`; `'Alza.cz a.s.'` → `alza-cz-a-s`; `'  ---  '` → `firma`.
   - `validFromFor('2026-10-25', null)` → `2026-01-01`; `('2026-10-25','2003-08-26')` → `2026-01-01`; `('2026-10-25','2026-03-15')` → `2026-03-15`.
   - `prefillFromAres`: street = `nazevUlice ?? nazevCastiObce ?? nazevObce ?? ''`; house_number = `cisloDomovni` as string or null; orientation_number likewise; city = `nazevObce ?? ''`; zip = `psc` padded to 5 digits or `''`; country = `kodStatu ?? 'CZ'`. `addressText` = `textovaAdresa ?? ''`. `fuCode` = `financniUrad ?? null`. `vatGuess` = `dphAktivni === true ? 'platce' : 'neplatce'` (`[verify]` in the report: does ARES `stavZdrojeDph` also say AKTIVNI for an identified person? check https://ares.gov.cz/stranky/vyvojar-info and record the finding; do not change behaviour).

3. `schema.ts`: 
```ts
export const TAX_REGIME_ANSWERS = ['danova_evidence', 'pausalni_vydaje', 'pausalni_dan', 'nevim'] as const;
export const VAT_ANSWERS = ['neplatce', 'platce_monthly', 'platce_quarterly', 'identifikovana_osoba'] as const;
export const onboardingSchema: z.ZodType<OnboardingInput>;   // z.object(...).superRefine(...)
export type OnboardingInput = {
  ico: string; name: string; dic: string | null;
  street: string; houseNumber: string | null; orientationNumber: string | null; city: string; zip: string;
  fuCode: string | null; validFrom: string; slugBase: string;
  vat: (typeof VAT_ANSWERS)[number]; regime: (typeof TAX_REGIME_ANSWERS)[number];
  pausalRate: 80 | 60 | 40 | 30 | null; pausalDanBand: 1 | 2 | 3 | null;
};
export function toCreateFirmInput(input: OnboardingInput): Record<string, unknown>;
export function parseOnboardingForm(formData: FormData): ReturnType<typeof onboardingSchema.safeParse>;
```
   Rules: strings trimmed; `ico` must pass `isValidIco`; `name` 1–200; `dic` empty → null, else `/^CZ\d{8,10}$/` after upper-casing and removing spaces; `zip` `/^\d{3} ?\d{2}$/` normalised to 5 digits; `street`, `city` 1–100; `validFrom` `/^\d{4}-\d{2}-\d{2}$/`; `slugBase` `/^[a-z0-9-]{1,30}$/` else replaced by `firma` (do not fail). Form numbers arrive as strings (`'60'`), empty → null. superRefine (path = field): `regime 'pausalni_vydaje'` needs `pausalRate` (`pausal_rate_required`); `regime 'pausalni_dan'` needs `pausalDanBand` (`band_required`) and `vat` not `platce_*` (`pausal_dan_payer`); otherwise rate and band are forced to null (not an error).
   `toCreateFirmInput` maps: `vat 'platce_monthly'` → `vat_status 'platce', vat_period 'monthly'`; `'platce_quarterly'` → `'platce','quarterly'`; `'identifikovana_osoba'` → `'identifikovana_osoba','monthly'`; `'neplatce'` → `'neplatce', null`. `regime 'nevim'` → `'danova_evidence'` (comment `TODO(review-question confirm_profile)`). `address` = `{street, house_number, orientation_number, city, zip, country:'CZ'}`; `fu_code`, `valid_from`, `slug_base`, `pausal_rate`, `pausal_dan_band`, `name`, `ico`, `dic`.
   Form field names are the `OnboardingInput` keys.

4. `gate.ts`:
```ts
export interface MembershipCounter { countMemberships(): Promise<number | null> }  // null = query failed
export async function needsOnboarding(counter: MembershipCounter): Promise<boolean>;  // true only for 0
export function supabaseMembershipCounter(supabase: SupabaseLike): MembershipCounter;
```
   `supabaseMembershipCounter` runs `supabase.from('memberships').select('org_id', { count: 'exact', head: true })` and returns `count` when `error === null && typeof count === 'number'`, else `null`; a thrown error → `null`. (RLS limits `memberships` to the user's own orgs.) Type `SupabaseLike` minimally so the test can pass a fake.

5. `actions.ts` (`'use server'`):
```ts
export type LookupResult =
  | { status: 'found'; prefill: OnboardingPrefill }
  | { status: 'invalid' } | { status: 'not_found' } | { status: 'unavailable' };
export async function lookupIco(ico: string): Promise<LookupResult>;
export type OnboardingState =
  | { status: 'idle' }
  | { status: 'error'; code: 'invalid' | 'pausal_rate_required' | 'band_required' | 'pausal_dan_payer' | 'unknown' }
  | { status: 'done'; inboundAddress: string };
export async function completeOnboarding(prev: OnboardingState, formData: FormData): Promise<OnboardingState>;
```
   - `lookupIco`: trim and remove spaces; not `isValidIco` → `invalid`; require a signed-in user (`supabase.auth.getUser()`; none → `redirect('/prihlaseni')`); `createAresClient({ baseUrl: process.env.SHOEBOX_ARES_BASE_URL || undefined })`; `ok` → `found` with `prefillFromAres(data, today)` (today = Europe/Prague date via `new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague' }).format(new Date())`); `not_found` / `unavailable` pass through.
   - `completeOnboarding`: `parseOnboardingForm`; failure → error code = first issue's message if it is one of the three refine codes, else `invalid`. Then `supabase.rpc('create_firm', { p: toCreateFirmInput(data) })`. Error message containing `already_has_firm` → `redirect('/inbox')`. Other error or throw → `unknown`. Success → `done` with `${slug}-${secret.toLowerCase()}@${process.env.SHOEBOX_INBOUND_DOMAIN || 'in.shoebox.cz'}`.
   - Log nothing.

6. `(app)/layout.tsx`: at the top of `AppLayout` (before reading the theme cookie):
```ts
  if (await needsOnboarding(supabaseMembershipCounter(await createSupabaseServerClient()))) redirect('/vitejte');
```
   with imports `redirect` from `next/navigation`, `createSupabaseServerClient` from `../../src/supabase/server`, the two gate functions from `../../src/onboarding/gate`.

7. Tests (Vitest, `apps/web/test/`), each case below is one `it`:
   - prefill: the three `slugify` cases; the three `validFromFor` cases; `prefillFromAres` on the 0060 fixture shape (build the `AresSubject` inline: Alza values from `packages/registries/test/fixtures/ares-27082440.json`, `dphAktivni: true`) → address `{street:'Jankovcova', house_number:'1522', orientation_number:'53', city:'Praha', zip:'17000', country:'CZ'}`, `fuCode '013'`, `vatGuess 'platce'`, `validFrom '2026-01-01'`, `slugBase 'alza-cz-a-s'`; a subject with `psc: 1234` → zip `'01234'`; missing street → falls back to `nazevCastiObce`.
   - schema: a valid paušální výdaje 60 % non-payer passes and `toCreateFirmInput` equals the expected object; `platce_quarterly` maps to `('platce','quarterly')`; IO maps to monthly; `nevim` → `danova_evidence`; `pausalni_vydaje` without rate → issue `pausal_rate_required`; `pausalni_dan` + `platce_monthly` → `pausal_dan_payer`; IČO `12345678` fails; `dic ' cz 27082440'` → `CZ27082440`; zip `'170 00'` → `'17000'`; bad slugBase → `firma`; `danova_evidence` with a rate given → rate null.
   - gate: counter returning 0 → true; 1 → false; null → false; `supabaseMembershipCounter` with a fake whose query resolves `{ count: 0, error: null }` → 0, `{ count: null, error: {…} }` → null, a throw → null.

## 5. Do not touch

`apps/web/src/auth/**`, `apps/web/e2e/**`, `apps/web/middleware.ts`, `packages/**`, `supabase/config.toml`. No new third-party dependency.

## 6. Commands

- `pnpm --filter @shoebox/web test -- onboarding 2>&1 | tail -30` → all pass.
- `pnpm --filter @shoebox/web test 2>&1 | tail -15` → all pass (the gate must not break existing unit tests).
- `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` → no errors.
- `pnpm exec biome ci apps/web 2>&1 | tail -30` → clean.

## 7. Acceptance

- [ ] §6 passes.
- [ ] `git diff --stat` lists only §3 files plus the report.

## 8. Stop and ask

Stop and write the report if: an excerpt is not found; a test fails twice; 25 tool calls or about 50k tokens; a file outside §3 needs a change; `pnpm install` wants to change more than the workspace link.

## 9. Report

Write `docs/tasks/0062-report.md` (600 tokens at most) and set `Status: review`, including the `[verify]` finding.

## Risk list (for the reviewer)

`actions.ts` (auth check, no logging, error mapping), `(app)/layout.tsx` gate (fails open to the app on query error, never loops).

## Owner steps

None now. Later on Render: `SHOEBOX_INBOUND_DOMAIN` once the domain is chosen.
