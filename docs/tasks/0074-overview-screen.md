# 0074: Přehled (Overview) screen

Status: review
Ticket: P1-OVERVIEW (M11 §5.2, M09 §4.3–§4.8) | Depends on: 0073 | Base commit: phase/0 after 0073 | Branch: task/0074-overview-screen | PR base: phase/0
Executor: Sonnet 5.5 (reason: visual judgement) | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Replace the placeholder Přehled page with the real screen: the next payment at the top, the limit meters below it, this month's and this year's income and expenses, the next deadlines and one "Send to accountant" button. Before the first counted document the screen shows a friendly empty state with one way forward.

## 2. Context

Data: `loadOverview(orgId, asOf)` and `buildOverviewView(...)` from `apps/web/src/overview/` (brief 0073) return an `OverviewView`:
`{ asOf, profile: OverviewProfile | null, totals: { month: {income, expenses}, ytd: {income, expenses}, turnoverYtd, countedCount, pending: {count, grossCzk} }, meters: LimitMeter[] /* id, current, limit, percent, level, hint */, deadlines: Deadline[] /* kind, periodStart, periodEnd, legalDue, due, amount, amountIsMinimum */, nextPayment: Deadline | null, pausal: boolean }`. Amounts are `Money` (`.toFixed2()` gives a decimal string).

Active org: `getOrgContext()` from `apps/web/src/auth/org-context.ts` (import only, never edit) → `ctx?.active?.orgId`. Today: `pragueToday({ now: () => Date.now() })` from `@shoebox/domain`. No active org (the e2e fake server has no database) → `buildOverviewView({ profile: null, documents: [], asOf, rules: createCzRules() })`.

Design rules (07 §2 rules 11–14, §6, §8, §9; M11 §5.2, §8):

- Order (mockup agreed with the owner): 1) "Next payment" card, 2) limit meters, 3) "Income and expenses", 4) "Deadlines" (all deadlines of the next 60 days), 5) one primary link-button "Send to accountant" (`overview.send_accountant`) → `/ucetni`. Mobile: one column in that order; from `md` the meters and the totals may sit side by side.
- Empty state (`totals.countedCount === 0`): instead of 2), 3) and 5), one card "No documents yet" with body text and the primary link "Upload your first document" → `/inbox`. Meters stay hidden until there is a counted document. Without a profile the next-payment card says deadlines appear once the business details are filled in, with a link to `/nastaveni`.
- Meters (M09 §4.4): a bar with zone ticks at 80 % and 95 %, `role="meter"`, `aria-valuemin=0`, `aria-valuemax=100`, `aria-valuenow=min(percent,100)`, `aria-valuetext` = the printed text, `aria-labelledby` = the label's id. The number and the limit are always printed as text: "1 640 000 Kč of 2 000 000 Kč · 82 %". Fill colour: `ok` `bg-primary`, `warn` `bg-warning`, `alert`/`exceeded` `bg-destructive`; `warn`/`alert`/`exceeded` also show a Lucide icon (`TriangleAlert`, or `OctagonAlert` for exceeded) and the level sentence. Colour is never the only signal.
- A "?" beside every tax term (rule 12): `HelpTip` = native `<details><summary>` (no JS, no `aria-expanded`: `shell.spec.ts` asserts the page has none), the summary is a 44 px target with `aria-label` from `overview.help.label` and a Lucide `CircleHelp` icon; the open text is body size (rule 13: no grey fine print). Help keys take the limit as a parameter, so no law number is typed in copy.
- Amounts: whole crowns, tabular (`num` class), right-aligned in the totals table, Czech format. Due dates: "26. 10. (tomorrow)", relative words up to 14 days, year only when not this year.
- Tokens only (`bg-card`, `text-foreground`, `border-border`, `bg-muted`, `text-title`, `text-section`, `text-card-title`, `text-body`, `text-kpi`, `rounded-card`, `rounded-control`); no raw colours. Every string through `t()` (lint `no-jsx-literal-text`). Link-buttons use `focusRing` from `@shoebox/ui` plus `inline-flex min-h-11 items-center rounded-control px-4`.
- Server components only (no `'use client'`), bundle budget ≤ 170 KB.

Existing page, `apps/web/app/(app)/prehled/page.tsx` (whole file):

```tsx
import { t } from '@shoebox/i18n';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: t('overview.title') };

export default function OverviewPage() {
  return <h1 className="text-title">{t('overview.title')}</h1>;
}
```

Existing anchor in `packages/i18n/messages/cs.json` and `en.json`: the line `"overview.title": …,`. Insert the new keys right after it in both files.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/i18n/messages/cs.json` | edit | the `overview.*` keys, English values for now |
| `packages/i18n/messages/en.json` | edit | the same keys, English |
| `packages/i18n/later/cs-overview.json` | create | dormant Czech copy (not loaded) |
| `apps/web/src/overview/format.ts` | create | `formatCzkWhole`, `formatDue`, `periodLabel`, `meterText` |
| `apps/web/test/overview-format.test.ts` | create | the test file below, verbatim |
| `apps/web/src/overview/help-tip.tsx` | create | `HelpTip` |
| `apps/web/src/overview/limit-meter.tsx` | create | `LimitMeterBar` |
| `apps/web/src/overview/overview-screen.tsx` | create | `OverviewScreen({ view })` |
| `apps/web/app/(app)/prehled/page.tsx` | edit | load the view, render the screen |
| `apps/web/e2e/overview.spec.ts` | create | the e2e file below, verbatim |

No other file may change.

## 4. Steps

1. **English UI for now (owner, 2026-10-25):** the app shows English until the product is further; Czech is kept dormant for later. So:
   - Create `packages/i18n/later/cs-overview.json` (not loaded by anything) holding the Czech copy below as a JSON object (wrap the lines in `{ }`, drop the trailing comma).
   - Add the **English** values (list after the Czech block) under the same keys to **both** `cs.json` and `en.json`, right after the `"overview.title"` line, so the screen is English whatever the default locale is.

Czech copy (dormant, for `later/cs-overview.json`):

```json
  "overview.next.title": "Nejbližší platba",
  "overview.next.none": "V příštích {days} dnech nic neplatíte.",
  "overview.next.no_profile": "Termíny plateb ukážeme, až doplníte údaje o podnikání.",
  "overview.next.no_profile_action": "Doplnit v Nastavení",
  "overview.next.minimum": "nejméně {amount}",
  "overview.next.amount_unknown": "Částku spočítáme z vašich dokladů.",
  "overview.kind.vat_return": "Přiznání a platba DPH",
  "overview.kind.kh": "Kontrolní hlášení",
  "overview.kind.pausalni_dan_advance": "Měsíční platba paušální daně",
  "overview.kind.social_advance": "Záloha na sociální pojištění",
  "overview.kind.health_advance": "Záloha na zdravotní pojištění",
  "overview.kind.dap": "Přiznání k dani z příjmů",
  "overview.period.month": "za {month}/{year}",
  "overview.period.quarter": "za {quarter}. čtvrtletí {year}",
  "overview.period.year": "za rok {year}",
  "overview.due.today": "dnes",
  "overview.due.tomorrow": "zítra",
  "overview.due.in_days": "{n, plural, one {za # den} few {za # dny} many {za # dne} other {za # dní}}",
  "overview.due.with_relative": "{date} ({relative})",
  "overview.meters.title": "Limity",
  "overview.meter.vat_calendar_year": "Limit pro DPH od příštího roku",
  "overview.meter.vat_immediate": "Limit pro DPH hned",
  "overview.meter.pausalni_dan_band": "Limit vašeho pásma paušální daně",
  "overview.meter.pausalni_dan_eligibility": "Limit pro paušální daň",
  "overview.meter.pausalni_vydaje_cap": "Kdy se paušální výdaje přestanou zvyšovat",
  "overview.meter.value": "{current} z {limit} · {percent} %",
  "overview.meter.level.warn": "Blížíte se limitu.",
  "overview.meter.level.alert": "Jste těsně pod limitem.",
  "overview.meter.level.exceeded": "Limit je překročený. Poraďte se s účetní, co dál.",
  "overview.meter.hint.set_activity_type": "Upřesněte typ činnosti v Nastavení, limit pak spočítáme přesně.",
  "overview.totals.title": "Příjmy a výdaje",
  "overview.totals.basis": "Podle dokladů, bez plateb z banky.",
  "overview.totals.month": "Tento měsíc",
  "overview.totals.ytd": "Od začátku roku",
  "overview.totals.income": "Příjmy",
  "overview.totals.expenses": "Výdaje",
  "overview.totals.expenses_note_pausal": "Máte paušál, takže skutečné výdaje daň nemění. Ukazujeme je jen pro přehled.",
  "overview.totals.pending": "{n, plural, one {# doklad za {amount} ještě čeká na kontrolu.} few {# doklady za {amount} ještě čekají na kontrolu.} many {# dokladu za {amount} ještě čeká na kontrolu.} other {# dokladů za {amount} ještě čeká na kontrolu.}}",
  "overview.deadlines.title": "Termíny",
  "overview.deadlines.none": "V příštích {days} dnech nemáte žádný termín.",
  "overview.send_accountant": "Poslat účetní",
  "overview.empty.title": "Zatím tu nejsou žádné doklady",
  "overview.empty.body": "Jakmile nahrajete první doklad, uvidíte tu příjmy, výdaje a jak blízko jste limitům.",
  "overview.empty.action": "Nahrát první doklad",
  "overview.help.label": "Co je {term}?",
  "overview.help.totals": "Sčítáme doklady, které už prošly kontrolou. Každý doklad počítáme ke dni plnění, jinak ke dni vystavení.",
  "overview.help.vat_calendar_year": "Když vaše příjmy za kalendářní rok přesáhnou {limit}, stanete se od 1. ledna plátcem DPH. Pak k cenám připočítáváte DPH a podáváte přiznání.",
  "overview.help.vat_immediate": "Když příjmy za rok přesáhnou {limit}, jste plátcem DPH už od následujícího dne. Je potřeba se hned zaregistrovat.",
  "overview.help.pausalni_dan_band": "Paušální daň má tři pásma podle výše příjmů. Když příjmy přesáhnou limit vašeho pásma ({limit}), zaplatíte za rok víc.",
  "overview.help.pausalni_dan_eligibility": "Paušální daň můžete mít, jen když roční příjmy z podnikání nepřesáhnou {limit}. Nad tímto limitem se vracíte k běžnému přiznání.",
  "overview.help.pausalni_vydaje_cap": "Paušální výdaje jsou procento z příjmů, ale jen do určité výše. Nad {limit} příjmů už se nezvyšují.",
  "overview.help.kind.vat_return": "Plátci DPH hlásí finančnímu úřadu, kolik DPH vybrali a kolik zaplatili. Rozdíl ve stejný den pošlou na účet úřadu.",
  "overview.help.kind.kh": "Kontrolní hlášení je seznam faktur s DPH, který plátci posílají spolu s přiznáním k DPH. Úřad podle něj porovnává faktury mezi firmami.",
  "overview.help.kind.pausalni_dan_advance": "Paušální daň je jedna měsíční platba, ve které je daň z příjmů, sociální i zdravotní pojištění. Posílá se na účet finančního úřadu.",
  "overview.help.kind.social_advance": "Každý měsíc posíláte zálohu na sociální pojištění správě sociálního zabezpečení. Ukazujeme nejnižší možnou částku, můžete platit víc.",
  "overview.help.kind.health_advance": "Každý měsíc posíláte zálohu na zdravotní pojištění své pojišťovně. Ukazujeme nejnižší možnou částku, můžete platit víc.",
  "overview.help.kind.dap": "Jednou za rok podáváte přiznání k dani z příjmů za minulý rok. Elektronicky ho stačí podat do začátku května.",
```

English values, in the same key order: "Next payment", "Nothing to pay in the next {days} days.", "We will show payment dates once your business details are filled in.", "Fill in Settings", "at least {amount}", "We will work the amount out from your documents.", "VAT return and payment", "Control statement", "Monthly flat-rate tax payment", "Social insurance advance", "Health insurance advance", "Income tax return", "for {month}/{year}", "for Q{quarter} {year}", "for {year}", "today", "tomorrow", "{n, plural, one {in # day} other {in # days}}", "{date} ({relative})", "Limits", "VAT limit from next year", "VAT limit right away", "Your flat-tax band limit", "Flat-tax limit", "When flat-rate expenses stop growing", "{current} of {limit} · {percent} %", "You are getting close to the limit.", "You are just below the limit.", "The limit is exceeded. Ask your accountant what to do next.", "Set your activity type in Settings so we can work out the limit exactly.", "Income and expenses", "From documents, without bank payments.", "This month", "Since the start of the year", "Income", "Expenses", "You use flat-rate expenses, so real expenses do not change your tax. They are shown for your overview only.", "{n, plural, one {# document for {amount} is still waiting for review.} other {# documents for {amount} are still waiting for review.}}", "Deadlines", "No deadlines in the next {days} days.", "Send to accountant", "No documents yet", "Once you upload your first document, you will see income, expenses and how close you are to the limits.", "Upload your first document", "What is {term}?", then English versions of the 12 help texts with the same `{limit}` parameters (plain, two sentences each).

Command: `pnpm --filter @shoebox/i18n test 2>&1 | tail -30` → passes.

2. Create `apps/web/test/overview-format.test.ts` with exactly:

```ts
import { Money, parseLegalDate } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import { formatCzkWhole, formatDue, meterText, periodLabel } from '../src/overview/format';

const d = parseLegalDate;
const asOf = d('2026-10-25');
const czk = (s: string) => Money.parse(s, 'CZK');
const plain = (s: string) => s.replace(/ | /g, ' ');

describe('overview formatting', () => {
  it('whole crowns, Czech grouping', () => {
    expect(plain(formatCzkWhole(czk('1640000.40')))).toBe('1 640 000 Kč');
    expect(plain(formatCzkWhole(czk('0')))).toBe('0 Kč');
  });

  it('due dates with relative words up to 14 days, the year only when it differs', () => {
    expect(formatDue(d('2026-10-25'), asOf)).toBe('25. 10. (today)');
    expect(formatDue(d('2026-10-26'), asOf)).toBe('26. 10. (tomorrow)');
    expect(formatDue(d('2026-10-27'), asOf)).toBe('27. 10. (in 2 days)');
    expect(formatDue(d('2026-10-30'), asOf)).toBe('30. 10. (in 5 days)');
    expect(formatDue(d('2026-11-08'), asOf)).toBe('8. 11. (in 14 days)');
    expect(formatDue(d('2026-11-09'), asOf)).toBe('9. 11.');
    expect(formatDue(d('2027-01-08'), asOf)).toBe('8. 1. 2027');
  });

  it('period labels for a month, a quarter and a year', () => {
    expect(periodLabel({ periodStart: d('2026-09-01'), periodEnd: d('2026-09-30') })).toBe(
      'for 9/2026',
    );
    expect(periodLabel({ periodStart: d('2026-07-01'), periodEnd: d('2026-09-30') })).toBe(
      'for Q3 2026',
    );
    expect(periodLabel({ periodStart: d('2025-01-01'), periodEnd: d('2025-12-31') })).toBe(
      'for 2025',
    );
  });

  it('meter text prints the amount, the limit and the percent', () => {
    expect(plain(meterText({ current: czk('1640000'), limit: czk('2000000'), percent: 82 }))).toBe(
      '1 640 000 Kč of 2 000 000 Kč · 82 %',
    );
  });
});
```

3. Create `apps/web/src/overview/format.ts` exporting exactly:

```ts
export function formatCzkWhole(amount: Money): string;   // Intl cs-CZ, CZK, 0 fraction digits, from amount.toFixed2()
export function formatDue(due: LegalDate, asOf: LegalDate): string;
export function periodLabel(p: { readonly periodStart: LegalDate; readonly periodEnd: LegalDate }): string;
export function meterText(m: { readonly current: Money; readonly limit: Money; readonly percent: number }): string;
```

Use `t()` from `@shoebox/i18n` for every word; pass years, months and percents as strings (a number parameter would get a group separator). A period is a year when it starts on 1 Jan and ends on 31 Dec, a quarter when it spans three months, else a month.
Command: `pnpm --filter @shoebox/web test -- overview-format 2>&1 | tail -30` → passes.

4. Create `help-tip.tsx` (`HelpTip({ term, text }: { term: string; text: string })`), `limit-meter.tsx` (`LimitMeterBar({ meter }: { meter: LimitMeter })`, label + `HelpTip` with `overview.help.<id>` and `{ limit: formatCzkWhole(meter.limit) }`, bar, text, level line, hint line) and `overview-screen.tsx` (`OverviewScreen({ view }: { view: OverviewView })`, keeps `<h1 className="text-title">{t('overview.title')}</h1>` as its first element) following §2. Window for the "none" texts: `days: '60'`.

5. Replace `apps/web/app/(app)/prehled/page.tsx` with an async server component that keeps `export const metadata: Metadata = { title: t('overview.title') };`, resolves the view as in §2 and returns `<OverviewScreen view={view} />`. Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` → 0 errors.

6. Create `apps/web/e2e/overview.spec.ts` with exactly:

```ts
import { expect, test } from './fixtures';

test('Overview without documents: empty state, one way forward, no meters', async ({ page }) => {
  await page.goto('/prehled');
  await expect(page.getByRole('heading', { name: 'No documents yet' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Upload your first document' })).toHaveAttribute(
    'href',
    '/inbox',
  );
  await expect(page.getByRole('meter')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Next payment' })).toBeVisible();
});
```

Run e2e with the preinstalled Chromium only (never `playwright install`): if Playwright reports a missing `chromium-NNNN` folder, make a shim directory in your scratchpad with symlinks `chromium-NNNN → /opt/pw-browsers/chromium-1243` and `chromium_headless_shell-NNNN → /opt/pw-browsers/chromium_headless_shell-1243` (use the numbers from the error) and export `PLAYWRIGHT_BROWSERS_PATH` to it. Command: `pnpm --filter @shoebox/web e2e -- overview shell --project=setup --project=desktop-chromium --project=mobile-chromium 2>&1 | tail -30` → all pass (axe runs automatically). Take one 375 px screenshot of `/prehled` (mobile-chromium, `page.screenshot`) into `docs/tasks/0074-prehled-375.png`; do not commit it if `.gitignore` excludes png, just name its path in the report.

7. Command: `pnpm exec biome check apps/web packages/i18n 2>&1 | tail -30` → clean.

## 5. Do not touch

`apps/web/src/auth/**`, `apps/web/e2e/fixtures.ts`, the login e2e files (`auth*.ts`, `fake-auth-server.mjs`), `supabase/config.toml`, `apps/web/src/overview/{rows,view,load}.ts`, `packages/domain`, `packages/ui`. Hard rules 1 (format only from `Money.toFixed2()` strings), 6 (every string through `packages/i18n`, English for now per the owner; tokens only), 7 (no new dependency, screen or setting).

## 6. Commands

- `pnpm --filter @shoebox/i18n test 2>&1 | tail -30` → passes.
- `pnpm --filter @shoebox/web test -- overview 2>&1 | tail -30` → passes.
- `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` → 0 errors.
- `pnpm --filter @shoebox/web e2e -- overview shell --project=setup --project=desktop-chromium --project=mobile-chromium 2>&1 | tail -30` → passes, axe 0 violations.
- `python3 scripts/context_lint.py 2>&1 | tail -30` → OK (after the report).

## 7. Acceptance

- [ ] Both test files are byte-identical to §4 and pass; `shell.spec.ts` still passes.
- [ ] Only tokens from 07 §3; no raw hex. Lucide icons only, no emoji; meter level = icon + words + colour.
- [ ] Visible focus on every link and "?"; targets ≥ 44 px; works at 375 px with no horizontal page scroll.
- [ ] Amounts tabular, right-aligned, Czech format, whole crowns.
- [ ] Every tax term has a "?" (rule 12); no grey fine print (rule 13); plain words (rule 14).
- [ ] axe 0 violations; 375 px screenshot path in the report.

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

Write `docs/tasks/0074-report.md` (600 tokens at most) and set `Status: review`. The report has:

1. The files changed (`git diff --stat`).
2. Each command, with the last 5 lines of its output.
3. Anything you were unsure about.
