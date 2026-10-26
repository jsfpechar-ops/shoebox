# 0409: Settings screen (Phase 1)

Status: todo
Ticket: lane D, M11 §5.4 | Depends on: none | Branch: claude/project-thread-yn56ih | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Settings shows, in plain words, what Sysel knows about the firm (name, IČO, DIČ, address) and the tax profile (VAT status, how expenses are deducted) with a "?" help next to each tax term, plus who has access. Everything is filled from onboarding; the user types nothing here in Phase 1.

## 2. Context

- 07 rules 11–14: look it up before asking; "?" help on every term (`HelpTip` in `apps/web/src/overview/help-tip.tsx`: `<HelpTip term={…} text={…} />`); no fine print (body size); official term in brackets only when different.
- `taxpayer_profiles` (0002): `org_id, valid_from, valid_to, vat_status, vat_period, tax_regime, pausal_rate, legal_name, ico, dic, address jsonb {street, house_number, orientation_number, city, zip, country}`. Current profile = the row with `valid_from <= today` and (`valid_to` null or `>= today`), latest `valid_from`.
- Existing labels (en.json): `onboarding.vat.neplatce` "No", `onboarding.vat.platce_monthly`, `onboarding.vat.platce_quarterly`, `onboarding.vat.identifikovana_osoba`, `onboarding.regime.danova_evidence`, `onboarding.regime.pausalni_vydaje`, `onboarding.regime.pausalni_dan`. Read lines 105–115 and 315–335 of en.json for the exact key names before using them.
- `memberships`: `org_id, user_id, role` (owner, member, accountant, viewer). The signed-in user id is `auth.userId` from `requireActiveRole`.

## 3. Files

| Path | Action |
|---|---|
| `apps/web/src/settings/settings-data.ts` | new |
| `apps/web/test/settings-data.test.ts` | new (below) |
| `apps/web/app/(app)/nastaveni/page.tsx` | edit (replace body) |
| `packages/i18n/messages/en.json` | edit: keys |

## 4. Steps

1. `en.json` keys (after `"settings.title"`):
   ```
     "settings.firm.title": "Your business",
     "settings.firm.name": "Name",
     "settings.firm.ico": "Company ID (IČO)",
     "settings.firm.dic": "VAT ID (DIČ)",
     "settings.firm.dic_none": "None",
     "settings.firm.address": "Address",
     "settings.firm.source": "Filled in from the public business register (ARES) when you signed up.",
     "settings.tax.title": "Taxes",
     "settings.tax.vat": "VAT payer",
     "settings.tax.regime": "Expenses",
     "settings.tax.since": "Since {date}",
     "settings.tax.flat_rate": "{rate} % of income",
     "settings.help.ico": "Your 8-digit company ID from the business register. Invoices you receive should show it.",
     "settings.help.dic": "Your tax ID, usually CZ plus your company ID. You have one if you are registered for VAT or as an identified person.",
     "settings.help.vat": "A VAT payer adds VAT to prices and files VAT returns. An identified person only reports some purchases from abroad.",
     "settings.help.regime": "How your expenses lower your income tax: from real receipts, as a fixed percentage of income, or not at all with the one monthly flat-rate payment.",
     "settings.team.title": "Who has access",
     "settings.team.you": "You",
     "settings.role.owner": "Owner",
     "settings.role.member": "Can add and fix documents",
     "settings.role.accountant": "Accountant",
     "settings.role.viewer": "Can only look",
     "settings.empty": "We could not load your settings. Please reload the page.",
   ```
   Also change the existing value of `"trash.note"` to `"Documents you moved here do not count in your totals. You can bring them back at any time."` (automatic deletion after 30 days is not built yet).
2. New `apps/web/src/settings/settings-data.ts`:
   ```ts
   import type { LegalDate } from '@shoebox/domain';
   import type { MessageKey } from '@shoebox/i18n';
   export interface SettingsView {
     readonly firm: { name: string; ico: string; dic: string | null; address: string | null };
     readonly tax: { vat: MessageKey; regime: MessageKey; flatRate: number | null; since: LegalDate } | null;
     readonly team: readonly { userId: string; role: MessageKey; isYou: boolean }[];
   }
   /** One line: "Jankovcova 1522/53, 170 00 Praha". null when street and city are both missing. */
   export function formatAddress(raw: unknown): string | null;
   /** The profile valid on `today` (latest valid_from), or null. */
   export function currentProfile<T extends { valid_from: string; valid_to: string | null }>(rows: readonly T[], today: LegalDate): T | null;
   /** vat_status + vat_period → the onboarding label key; tax_regime → its label key. */
   export function vatLabel(status: string, period: string | null): MessageKey;
   export function regimeLabel(regime: string): MessageKey;
   export async function loadSettings(supabase: SupabaseLike, orgId: string, userId: string, today: LegalDate): Promise<SettingsView | null>;
   ```
   `formatAddress`: street + ' ' + house_number (+ '/' + orientation_number when set), then ', ', zip as `NNN NN`, ' ', city; parts missing are left out. `vatLabel`: `neplatce` → `onboarding.vat.neplatce`; `platce` + `monthly` → `onboarding.vat.platce_monthly`, + `quarterly` → `…_quarterly`, + null → `…_monthly`; `identifikovana_osoba` → `onboarding.vat.identifikovana_osoba`; unknown → `onboarding.vat.neplatce`. (Check the real enum values in en.json key names; if the vat_status enum value is not `platce`, read `packages/db/migrations/0001_enums.sql` line with `vat_status` and use it.) `regimeLabel`: `onboarding.regime.<regime>`, unknown → `onboarding.regime.nevim`. `loadSettings`: organizations `name, ico, dic` by id; taxpayer_profiles of the org; memberships of the org (`user_id, role`); role label `settings.role.<role>`; owner first; errors → null.
   Test `apps/web/test/settings-data.test.ts` (do not edit):
   ```ts
   import type { LegalDate } from '@shoebox/domain';
   import { describe, expect, it } from 'vitest';
   import { currentProfile, formatAddress, regimeLabel, vatLabel } from '../src/settings/settings-data';

   describe('formatAddress', () => {
     it('writes one Czech address line', () => {
       expect(formatAddress({ street: 'Jankovcova', house_number: '1522', orientation_number: '53', city: 'Praha', zip: '17000', country: 'CZ' })).toBe('Jankovcova 1522/53, 170 00 Praha');
       expect(formatAddress({ house_number: '12', city: 'Lhota', zip: '25001' })).toBe('12, 250 01 Lhota');
       expect(formatAddress(null)).toBeNull();
     });
   });

   describe('currentProfile', () => {
     const rows = [
       { valid_from: '2025-01-01', valid_to: '2026-07-31', id: 'old' },
       { valid_from: '2026-08-01', valid_to: null, id: 'new' },
       { valid_from: '2027-01-01', valid_to: null, id: 'future' },
     ];
     it('picks the profile valid today', () => {
       expect(currentProfile(rows, '2026-10-26' as LegalDate)?.id).toBe('new');
       expect(currentProfile(rows, '2026-03-01' as LegalDate)?.id).toBe('old');
       expect(currentProfile(rows, '2024-01-01' as LegalDate)).toBeNull();
     });
   });

   describe('labels', () => {
     it('maps profile values to the onboarding words', () => {
       expect(vatLabel('neplatce', null)).toBe('onboarding.vat.neplatce');
       expect(vatLabel('identifikovana_osoba', null)).toBe('onboarding.vat.identifikovana_osoba');
       expect(regimeLabel('pausalni_vydaje')).toBe('onboarding.regime.pausalni_vydaje');
       expect(regimeLabel('bogus')).toBe('onboarding.regime.nevim');
     });
   });
   ```
3. `nastaveni/page.tsx` (keep metadata): `requireActiveRole(['owner','member','accountant','viewer'])`; `view = auth.ok ? await loadSettings(…, pragueToday({ now: () => Date.now() })) : null`; null → `Card` with `settings.empty`. Else three `Card`s (`p-6 flex flex-col gap-4`, `<h2 className="text-card-title">`), each a `<dl>` of rows `<div className="flex flex-wrap items-center justify-between gap-2"><dt className="flex items-center gap-1 text-body">label [HelpTip]</dt><dd className="text-body">value</dd></div>`: Firm (name; IČO + HelpTip `settings.help.ico`; DIČ or `settings.firm.dic_none` + HelpTip `settings.help.dic`; address when set) then `<p className="text-body">` `settings.firm.source`; Taxes (VAT payer `t(vat)` + HelpTip `settings.help.vat`; Expenses `t(regime)` plus ` · ` `settings.tax.flat_rate` when flatRate + HelpTip `settings.help.regime`; `settings.tax.since` with `formatLegalDate`) — when `tax` is null leave the card out; Who has access (one row per member: role label, and `settings.team.you` for the signed-in user). HelpTip `term` = the row label text.
4. `pnpm --filter @shoebox/web test -- settings-data 2>&1 | tail -20`, `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`, `pnpm --filter @shoebox/i18n test 2>&1 | tail -5`, `pnpm exec biome check apps/web packages/i18n 2>&1 | tail -15` (fix your files with `--write`).

## 5. Do not touch

Onboarding files, migrations. No editing of tax data here (later brief). Hard rules 3, 6.

## 6. Commands

As in step 4.

## 7. Acceptance

- [ ] settings-data tests pass; typecheck 0; biome clean.

## 8. Stop and ask

As TEMPLATE §8.

## 9. Report

`docs/tasks/0409-report.md`, 150 tokens at most. Set `Status: review`.
