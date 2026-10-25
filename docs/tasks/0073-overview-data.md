# 0073: Přehled data loader and view model

Status: review
Ticket: P1-OVERVIEW (M09 §4.3–§4.8, M11 §5.2) | Depends on: 0070, 0071, 0072 | Base commit: phase/0 after 0072 | Branch: task/0073-overview-data | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Load the active taxpayer profile and this year's documents of the active org, map the rows into the pure domain types of 0070–0072, and build one view model for the Přehled screen (brief 0074). Without a profile or documents the view model is empty, so the screen can show its empty state.

## 2. Context

Hard rule 3: every query is org-scoped (`.eq('org_id', orgId)`; RLS applies too, the client runs under the user's session). Hard rule 1: amounts travel as decimal strings; select numeric columns with a `::text` cast so PostgREST never turns them into floats. Fail closed like `apps/web/src/auth/org-context.ts`: a failed query or a row that does not parse counts as no data (skip that row), never as an error page.

Domain functions now in `packages/domain/src/overview/`: `computeOverviewTotals(docs, vatStatus, asOf)` and the types `OverviewDocument`, `OverviewLine`, `OverviewTotals` (totals.ts); `computeLimitMeters(profile, { incomeYtd, turnoverYtd }, rulesAt)`, `MeterProfile`, `LimitMeter` (meters.ts); `upcomingDeadlines(profile, asOf, rules)`, `DeadlineProfile`, `Deadline` (deadlines.ts). Rules: `createCzRules()` from `@shoebox/domain`; `rules.at(asOf)` is the `RulesAt` that meters take.

M09/M11 display rules used by the view model:

- Meters are hidden until at least one counted document exists (M11 §8 empty states): `meters = []` when `totals.countedCount === 0`.
- `nextPayment` = the first deadline whose kind is not `kh` (the control statement is a filing, not a payment); null when none.
- `pausal` = `taxRegime` is `pausalni_vydaje` or `pausalni_dan` (the screen adds a note under expenses).
- `insuranceSelfPaid` = `organizations.settings.insurance_reminders !== false` (default true, M09 §4.7).

Existing excerpt, `packages/domain/src/index.ts` (whole file):

```ts
export const packageName = '@shoebox/domain' as const;
export * from './clock/index';
export * from './dates/index';
export * from './enums/index';
export * from './money/index';
export * from './rules/index';
```

Server client: `createSupabaseServerClient()` from `apps/web/src/supabase/server.ts`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/src/index.ts` | edit | export the three overview modules |
| `apps/web/src/overview/rows.ts` | create | zod row schemas, `toOverviewDocument`, `toOverviewProfile` |
| `apps/web/src/overview/view.ts` | create | `OverviewView`, `buildOverviewView` |
| `apps/web/src/overview/load.ts` | create | `loadOverview(orgId, asOf)` (server only) |
| `apps/web/test/overview-view.test.ts` | create | the test file below, verbatim |

No other file may change.

## 4. Steps

1. Edit `packages/domain/src/index.ts`: after `export * from './money/index';` add

```ts
export * from './overview/deadlines';
export * from './overview/meters';
export * from './overview/totals';
```

Command: `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30` → 0 errors (if two modules export the same name, STOP, §8).

2. Create `apps/web/test/overview-view.test.ts` with exactly:

```ts
import { createCzRules, parseLegalDate } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import { toOverviewDocument, toOverviewProfile } from '../src/overview/rows';
import { buildOverviewView } from '../src/overview/view';

const rules = createCzRules();
const asOf = parseLegalDate('2026-10-25');

const docRow = {
  status: 'ready',
  class: 'issued_invoice',
  direction: 'out',
  business_flag: 'business',
  deleted_at: null,
  duzp: '2026-10-05',
  issue_date: '2026-10-05',
  received_date: null,
  service_period_to: null,
  currency: 'CZK',
  fx_rate: null,
  total_gross: '1640000.00',
  partners: { country: 'CZ', vat_id: null },
  document_lines: [
    {
      line_type: 'item',
      net: '1640000.00',
      gross: '1640000.00',
      vat_treatment: null,
      business_share_pct: '100.00',
      categories: { tax_effect: 'taxable_income' },
    },
  ],
};

const profileRow = {
  vat_status: 'neplatce',
  vat_period: null,
  tax_regime: 'danova_evidence',
  pausal_rate: null,
  pausal_dan_band: null,
  has_accountant: true,
};

describe('rows', () => {
  it('maps a documents row with its lines, partner and category', () => {
    const doc = toOverviewDocument(docRow);
    expect(doc?.class).toBe('issued_invoice');
    expect(doc?.businessFlag).toBe('business');
    expect(doc?.deleted).toBe(false);
    expect(doc?.duzp).toBe('2026-10-05');
    expect(doc?.partnerCountry).toBe('CZ');
    expect(doc?.lines[0]?.taxEffect).toBe('taxable_income');
    expect(doc?.lines[0]?.businessSharePct).toBe('100.00');
  });

  it('a line without a category has no tax effect; a row without a partner is fine', () => {
    const doc = toOverviewDocument({
      ...docRow,
      partners: null,
      document_lines: [{ ...docRow.document_lines[0], categories: null }],
    });
    expect(doc?.partnerCountry).toBeNull();
    expect(doc?.lines[0]?.taxEffect).toBeNull();
  });

  it('returns null for a row that does not parse', () => {
    expect(toOverviewDocument({ ...docRow, status: 'nonsense' })).toBeNull();
    expect(toOverviewDocument(null)).toBeNull();
    expect(toOverviewProfile({ ...profileRow, vat_status: 'x' }, true)).toBeNull();
  });

  it('maps a profile row', () => {
    const profile = toOverviewProfile(profileRow, false);
    expect(profile).toEqual({
      vatStatus: 'neplatce',
      vatPeriod: null,
      taxRegime: 'danova_evidence',
      pausalRate: null,
      pausalDanBand: null,
      hasAccountant: true,
      insuranceSelfPaid: false,
    });
  });
});

describe('buildOverviewView', () => {
  it('is empty without a profile and without documents', () => {
    const view = buildOverviewView({ profile: null, documents: [], asOf, rules });
    expect(view.profile).toBeNull();
    expect(view.totals.countedCount).toBe(0);
    expect(view.meters).toEqual([]);
    expect(view.deadlines).toEqual([]);
    expect(view.nextPayment).toBeNull();
    expect(view.pausal).toBe(false);
  });

  it('shows deadlines from the profile even before the first document, but no meters', () => {
    const profile = toOverviewProfile(profileRow, true);
    if (profile === null) throw new Error('profile');
    const view = buildOverviewView({ profile, documents: [], asOf, rules });
    expect(view.meters).toEqual([]);
    expect(view.deadlines.map((x) => x.kind)).toEqual([
      'social_advance',
      'health_advance',
      'social_advance',
      'health_advance',
    ]);
    expect(view.nextPayment?.kind).toBe('social_advance');
    expect(view.nextPayment?.due).toBe('2026-10-30');
  });

  it('computes totals and meters once a counted document exists', () => {
    const profile = toOverviewProfile(profileRow, true);
    const doc = toOverviewDocument(docRow);
    if (profile === null || doc === null) throw new Error('fixture');
    const view = buildOverviewView({ profile, documents: [doc], asOf, rules });
    expect(view.totals.month.income.toFixed2()).toBe('1640000.00');
    expect(view.meters.map((m) => `${m.id} ${m.percent} ${m.level}`)).toEqual([
      'vat_calendar_year 82 warn',
      'vat_immediate 64 ok',
    ]);
  });

  it('the control statement is never the next payment', () => {
    const profile = toOverviewProfile(
      { ...profileRow, vat_status: 'platce', vat_period: 'monthly' },
      false,
    );
    if (profile === null) throw new Error('profile');
    const view = buildOverviewView({ profile, documents: [], asOf, rules });
    expect(view.deadlines[0]?.kind).toBe('vat_return');
    expect(view.nextPayment?.kind).toBe('vat_return');
    const pausal = toOverviewProfile({ ...profileRow, tax_regime: 'pausalni_dan' }, false);
    if (pausal === null) throw new Error('profile');
    expect(buildOverviewView({ profile: pausal, documents: [], asOf, rules }).pausal).toBe(true);
  });
});
```

3. Create `apps/web/src/overview/rows.ts` exporting exactly:

```ts
/** PostgREST select for `documents` (numeric columns cast to text, ADR-007). */
export const DOCUMENTS_SELECT =
  'status, class, direction, business_flag, deleted_at, duzp, issue_date, received_date, service_period_to, currency, fx_rate::text, total_gross::text, partners(country, vat_id), document_lines(line_type, net::text, gross::text, vat_treatment, business_share_pct::text, categories(tax_effect))';
export const PROFILE_SELECT =
  'vat_status, vat_period, tax_regime, pausal_rate, pausal_dan_band, has_accountant';
export interface OverviewProfile extends MeterProfile, DeadlineProfile {
  readonly hasAccountant: boolean;
}
export function toOverviewDocument(row: unknown): OverviewDocument | null;
export function toOverviewProfile(row: unknown, insuranceSelfPaid: boolean): OverviewProfile | null;
```

Use zod (`import { z } from 'zod'`, already a dependency of apps/web) with the enum value arrays from `@shoebox/domain` (`DOCUMENT_STATUS_VALUES`, `DOCUMENT_CLASS_VALUES`, `DIRECTION_VALUES`, `LINE_TYPE_VALUES`, `VAT_TREATMENT_VALUES`, `TAX_EFFECT_VALUES`, `VAT_STATUS_VALUES`, `VAT_PERIOD_VALUES`, `TAX_REGIME_VALUES`). Dates go through `parseLegalDate`. `partners` and `categories` may be null. `pausal_rate` ∈ 80/60/40/30 or null, `pausal_dan_band` ∈ 1/2/3 or null.

4. Create `apps/web/src/overview/view.ts` exporting exactly:

```ts
export interface OverviewView {
  readonly asOf: LegalDate;
  readonly profile: OverviewProfile | null;
  readonly totals: OverviewTotals;
  readonly meters: readonly LimitMeter[];
  readonly deadlines: readonly Deadline[];
  readonly nextPayment: Deadline | null;
  readonly pausal: boolean;
}
export function buildOverviewView(input: {
  readonly profile: OverviewProfile | null;
  readonly documents: readonly OverviewDocument[];
  readonly asOf: LegalDate;
  readonly rules: ReturnType<typeof createCzRules>;
}): OverviewView;
```

Without a profile, totals use `vatStatus 'neplatce'`, meters and deadlines are `[]`. Implement §2 until the tests pass. Do not edit the test file.
Command: `pnpm --filter @shoebox/web test -- overview-view 2>&1 | tail -30` → all pass.

5. Create `apps/web/src/overview/load.ts`:

```ts
export async function loadOverview(orgId: string, asOf: LegalDate): Promise<OverviewView>;
```

Steps inside: `createSupabaseServerClient()`; in one `try` (any throw or `error` → treat as no data):
- profile: `from('taxpayer_profiles').select(PROFILE_SELECT).eq('org_id', orgId).lte('valid_from', asOf).or(`valid_to.is.null,valid_to.gte.${asOf}`).order('valid_from', { ascending: false }).limit(1)`;
- settings: `from('organizations').select('settings').eq('id', orgId).maybeSingle()`; `insuranceSelfPaid = settings?.insurance_reminders !== false`;
- documents: `from('documents').select(DOCUMENTS_SELECT).eq('org_id', orgId).is('deleted_at', null).or(`duzp.gte.${y}-01-01,issue_date.gte.${y}-01-01,received_date.gte.${y}-01-01,service_period_to.gte.${y}-01-01,and(duzp.is.null,issue_date.is.null,received_date.is.null)`).limit(5000)` where `y` is `asOf`'s year;
- map rows with `toOverviewDocument` / `toOverviewProfile`, drop nulls, return `buildOverviewView({ ..., rules: createCzRules() })`.

No unit test (needs a database); the e2e of 0074 covers the fail-closed path. Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` → 0 errors.

6. Command: `pnpm exec biome check apps/web/src/overview apps/web/test/overview-view.test.ts packages/domain/src/index.ts 2>&1 | tail -30` → clean.

## 5. Do not touch

`apps/web/src/auth/**`, `apps/web/e2e/**`, `supabase/config.toml`, `apps/web/app/**` (brief 0074), every migration. Hard rules 1, 3, 4 (no document content in logs: do not `console.log` rows).

## 6. Commands

- `pnpm --filter @shoebox/web test -- overview-view 2>&1 | tail -30` → passes.
- `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` and `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30` → 0 errors.
- `python3 scripts/context_lint.py 2>&1 | tail -30` → OK (after the report).

## 7. Acceptance

- [ ] The test file is byte-identical to §4 step 2 and passes.
- [ ] Every query in `load.ts` has `.eq('org_id', orgId)` (or `.eq('id', orgId)` for organizations); numeric columns are selected `::text`.
- [ ] Typecheck and biome clean.

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

Write `docs/tasks/0073-report.md` (600 tokens at most) and set `Status: review`. The report has:

1. The files changed (`git diff --stat`).
2. Each command, with the last 5 lines of its output.
3. Anything you were unsure about.
