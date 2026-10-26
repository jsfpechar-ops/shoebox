# 0367: `POST /api/v1/podklady/{year}/dpfdp7-partial` (owner only, RČ never stored)

Status: todo
Ticket: P4-POD-06 (route) | Depends on: 0365, 0366 | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 22 tool calls, 55k tokens

## 1. Objective

The synchronous Route Handler that streams the partial DPFDP7 XML to flat-rate owners behind the feature flag, asks for the rodné číslo per request and lets it touch nothing but the response (M06 §4.10, M12 §4.6 RČ policy). A `DPFDP7_PARTIAL` filing row records only totals.

## 2. Context

M06 §4.10 (pasted): synchronous Route Handler, **not** a job. Body `{ rodneCislo, inputsVersion? }`. Offered only when `feature.dpfdp7_partial` is on (global product rule; per-org opt-in is an owner decision → `TODO(decision-dpfdp7-optin)`: for now the global flag alone) and `isPartialXmlAvailable(year, rules)` and the regime qualifies (`summary.partialXmlEligible` from 0359: `pausalni_vydaje`, or `pausalni_dan` with a return required; never `danova_evidence`/`ucetnictvi`) → otherwise **404** (no hint which condition failed). Role: owner only (403 for member/accountant/viewer). RČ format invalid → **422** `{ error: 'rodne_cislo_format' }`; checksum mismatch → proceed, add response header `X-Rodne-Cislo-Checksum: mismatch` (the UI shows a warning). Build XML in memory → `validateXml` (0336; unvalidated while the XSD is missing → still served, `xsd_valid: null`) → XSD-invalid → 422 generic (`{ error: 'xml_invalid' }`), errors to the logger **with the XML redacted** (`redactRodneCislo`) → stream as `Content-Type: application/xml; charset=utf-8`, `Content-Disposition: attachment; filename="DPFDP7-{year}-castecne.xml"`, `Cache-Control: no-store`. Never written to storage, DB, logs, Sentry, analytics or job tables; request-body logging is off for this route (the allowlist logger never serializes bodies; do not add the body to any log call); the field is `autocomplete="off"` on the screen (lane D). Filing row: `type 'DPFDP7_PARTIAL'`, `kind 'radne'`, `state 'downloaded'`, `period ⟨year⟩-01-01..12-31`, `totals { kc_prij7, kc_vyd7, rate, ledgerHash }`, `form_version 'DPFDP7 ' + epo.forms.DPFDP7.version`, `xsd_valid`, `xml_path null`, `inputs {}`; an open `DPFDP7_PARTIAL` of the year is superseded first. Each download asks for the RČ again.

Header values come from the taxpayer profile covering `⟨year⟩-12-31` (`taxpayer_profiles`: `fu_code`, `ufo_code`, `first_name`, `last_name`, `title`, `filing_email`, `filing_phone`, `main_activity_nace`, address JSON — see `packages/db/src/schema/tenancy.ts` for the exact column names). Numbers: `income = summary.flatRate.incomeKc`, `flat = summary.flatRate.flat`, `rate = summary.flatRate.rate` (0355 values are whole Kč). Summary and ledger hash come from 0365's `loadPodkladyPreview` internals: export a `loadPodkladySummary(orgId, year)` from `apps/web/src/podklady/load.ts` if 0365 did not, returning `{ summary, ledgerHash, profileAtYearEnd }`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/web/src/podklady/dpfdp7.ts` | create | `decidePartialXml`, `partialXmlLogFields`, `toDpfHeader`, `FILING_TOTALS` builder |
| `apps/web/src/podklady/load.ts` | edit | `loadPodkladySummary` (only if missing) |
| `apps/web/app/api/v1/podklady/[year]/dpfdp7-partial/route.ts` | create | POST |
| `apps/web/test/dpfdp7-route.test.ts` | create | below |

## 4. Steps

1. `dpfdp7.ts` exports exactly:
```ts
export interface PartialXmlContext { readonly role: MemberRole; readonly flagOn: boolean; readonly xsdAvailable: boolean; readonly partialXmlEligible: boolean; readonly flatRate: FlatRateComparison | null; readonly body: unknown }
export type PartialXmlDecision =
  | { readonly ok: true; readonly rodneCislo: string; readonly checksumOk: boolean }
  | { readonly ok: false; readonly status: 403 | 404 | 422; readonly error: 'forbidden' | 'not_found' | 'rodne_cislo_format' };
export function decidePartialXml(ctx: PartialXmlContext): PartialXmlDecision;     // order: role → 403; flag/xsd/eligibility/flatRate null → 404; body.rodneCislo string + validateRodneCislo → 422 on format error
export function toDpfHeader(profile: ProfileRowLike): DpfHeader;                   // ProfileRowLike = the subset of taxpayer_profiles columns listed in §2
export function buildPartialFilingTotals(fr: FlatRateComparison, ledgerHash: string): { kc_prij7: string; kc_vyd7: string; rate: number; ledgerHash: string };
export function partialXmlLogFields(orgId: string, year: number, filingId: string | null, xsdValid: boolean | null): Record<string, string | number | boolean | null>;   // the only fields the route may log
```
2. Route: `requireActiveRole(['owner', 'member', 'accountant', 'viewer'])` then `decidePartialXml` (so a non-owner gets 403, not 401); on `ok`: load summary + profile; `xml = serializeDpfdp7Partial({ year, header, income, flat, rate, appVersion }, rodneCislo, rules)`; `v = await validateXml(xml, 'DPFDP7')` (0336 signature; read it); invalid → log `partialXmlLogFields` + `redactRodneCislo(errorsAsText)`, 422; else supersede + insert the filing row (Supabase insert under RLS, columns in §2), respond with the XML string and the headers above. Wrap the handler so that any thrown error is logged through `partialXmlLogFields` only (never `error.message` if it might contain the XML: log `error.name`).
3. Test file (pure helpers + a string-level privacy check):
```ts
describe('decidePartialXml', () => {
  it('member/accountant/viewer → 403 forbidden even when everything else qualifies', …);
  it('flag off → 404; xsd missing → 404; not eligible (danova_evidence, or pausalni_dan without a return) → 404; flatRate null → 404', …);
  it('rodneCislo missing or malformed → 422 rodne_cislo_format; valid with slash → ok with normalized digits; bad checksum → ok with checksumOk false', …);
});
describe('toDpfHeader / totals / log fields', () => {
  it('maps the profile columns; empty strings become null', …);
  it('totals carry kc_prij7, kc_vyd7, rate, ledgerHash only (S3: 3500000.00 / 1200000.00 / 60)', …);
  it('log fields contain no key named rodneCislo/rod_c and no 9–10 digit token when given the S3 context', …);
});
describe('general 5 at the unit level', () => {
  it('JSON of the filing insert built by the route helpers does not contain 7801011229 anywhere', …);
});
```
Command: `pnpm --filter @shoebox/web test -- dpfdp7-route 2>&1 | tail -30`.
4. `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`. Commit `feat(web): partial DPFDP7 route, RČ never stored (0367)`.

## 5. Do not touch

`packages/tax-xml` (0366), screens, logger configuration (if the logger needs a redaction hook for Sentry `beforeSend`, report it as a follow-up for the platform owner instead of adding it here).

## 6. Commands

`pnpm --filter @shoebox/web test -- dpfdp7-route 2>&1 | tail -30` · `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`

## 7. Acceptance

- [ ] `danova_evidence` and `pausalni_dan` (no return) orgs → 404; flag off → 404; missing XSD year → 404 (P4-POD-06 second acceptance); owner with S3 → XML response with `no-store` and the attachment name.
- [ ] The test RČ appears in no filing row, log field or job payload built by this code (unit level; the full "DB dump / Sentry transport" sweep is the Phase 4 gate).

## 8. Stop and ask

TEMPLATE §8. Stop if the only way to insert the filing from the web app would require writing the RČ anywhere (it must not; the row carries totals only).

## 9. Report

`docs/tasks/0367-report.md`.

## Risk list

Privacy (RČ), tax XML.

## Owner steps

1. Decide the per-org opt-in for `feature.dpfdp7_partial` (a settings toggle is a new setting, rule 7): until then the global flag alone, default off.
2. Keep the flag off until the XSD is vendored and the follow-up brief after 0366 validates the golden.
