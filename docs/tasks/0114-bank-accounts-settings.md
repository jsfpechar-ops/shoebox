# 0114: Bank accounts card in Settings

Status: done
Ticket: P2-BANK-04 (screen half) | Depends on: 0113 | Base commit: see branch | Branch: claude/project-thread-236iho | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Show the user, in Settings, the bank accounts the app learned from their statements, the last statement imported for each, the latest payments, and, in plain words, what to do with a statement file that could not be read. This is M11 Settings row (13) "Bank accounts"; no new screen.

## 2. Context

M11 §5.4 Settings row (13) "Bankovní účty (od fáze 2)" stored in `money_accounts`. Hard rules: English copy in `packages/i18n/messages/en.json` only; design tokens only (no raw colors); a "?" help on every term.

Tables (05 §6), read through the Supabase client with RLS (users may select them):
- `money_accounts (id, org_id, type, name, currency, account_number, bank_code, iban, ...)`
- `statement_imports (id, org_id, money_account_id, format, period_from, period_to, tx_total, tx_new, tx_duplicate, state, created_at, ...)`; `state` in `parsed | partially_parsed | failed | duplicate_file | needs_mapping | needs_account`.
- `transactions (id, org_id, money_account_id, booked_on, amount, currency, counterparty_name, message, ...)`

Existing code to copy from:
- `apps/web/src/settings/settings-data.ts`: `type SupabaseLike = Awaited<ReturnType<typeof createSupabaseServerClient>>;` and `loadSettings(supabase, orgId, userId, today)` querying with `supabase.from('<table>').select('...').eq('org_id', orgId)`.
- `apps/web/app/(app)/nastaveni/page.tsx`: cards are `<Card className="flex flex-col gap-4 p-6">` with `<h2 className="text-card-title">` and a `<dl className="flex flex-col gap-4">` of `<Row label help>` items; the page ends with the "Who has access" card:
```tsx
          <Card className="flex flex-col gap-4 p-6">
            <h2 className="text-card-title">{t('settings.team.title')}</h2>
```
- `@shoebox/ui`: `formatMoney(value: string, currency: string, signed = false)`, `formatLegalDate(date)`, `Card`.
- `en.json` line: `  "settings.empty": "We could not load your settings. Please reload the page.",`

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/web/src/settings/bank-data.ts` | new | view builder + loader |
| `apps/web/test/bank-data.test.ts` | new | verbatim below |
| `apps/web/app/(app)/nastaveni/page.tsx` | edit | load + render the card |
| `packages/i18n/messages/en.json` | edit | new `settings.bank.*` keys |

No other file may change.

## 4. Steps

1. New `apps/web/src/settings/bank-data.ts`:
```ts
import type { LegalDate } from '@shoebox/domain';
import type { MessageKey } from '@shoebox/i18n';
import type { createSupabaseServerClient } from '../supabase/server';

type SupabaseLike = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface AccountRow {
  id: string;
  name: string;
  currency: string;
  account_number: string | null;
  bank_code: string | null;
  iban: string | null;
}
export interface ImportRow {
  id: string;
  money_account_id: string | null;
  period_from: string | null;
  period_to: string | null;
  tx_new: number;
  state: string;
  created_at: string;
}
export interface TxRow {
  id: string;
  money_account_id: string;
  booked_on: string;
  amount: string;
  currency: string;
  counterparty_name: string | null;
  message: string | null;
}
export interface BankView {
  readonly accounts: readonly {
    id: string;
    /** '2400123455/2010', else the IBAN, else the name. */
    label: string;
    lastImport: { from: LegalDate | null; to: LegalDate | null; added: number } | null;
  }[];
  /** Latest imports that need the user (failed, needs_mapping, needs_account), newest first, at most 3. */
  readonly problems: readonly { id: string; message: MessageKey; at: string }[];
  /** Latest 10 transactions, newest booked_on first. */
  readonly payments: readonly {
    id: string;
    date: LegalDate;
    who: string;
    amount: string;
    currency: string;
  }[];
}

/** Pure: builds the card's view from rows (imports and txs in any order). */
export function bankView(accounts: readonly AccountRow[], imports: readonly ImportRow[], txs: readonly TxRow[]): BankView;
/** Reads the three tables for the org (imports newest 50, transactions newest 10) and calls bankView. */
export async function loadBankView(supabase: SupabaseLike, orgId: string): Promise<BankView>;
```
Rules: account `lastImport` = the newest (by `created_at`) import of that account whose state is `parsed` or `partially_parsed`, else null. `problems` message keys: `failed` → `'settings.bank.problem.failed'`, `needs_mapping` → `'settings.bank.problem.needs_mapping'`, `needs_account` → `'settings.bank.problem.needs_account'`; other states are not problems. `payments.who` = `counterparty_name ?? message ?? ''` trimmed and cut to 40 chars. Payments sorted by `booked_on` desc, then `id` desc. Implement until step 2's test passes. Commit `0114 step 1`.

2. New `apps/web/test/bank-data.test.ts`, verbatim; run `pnpm --filter @shoebox/web test -- bank-data 2>&1 | tail -30` → pass. Commit `0114 step 2`.
```ts
import { describe, expect, it } from 'vitest';
import { type AccountRow, bankView, type ImportRow, type TxRow } from '../src/settings/bank-data';

const acc = (over: Partial<AccountRow> = {}): AccountRow => ({
  id: 'a1',
  name: 'Bank account',
  currency: 'CZK',
  account_number: '2400123455',
  bank_code: '2010',
  iban: 'CZ8720100000002400123455',
  ...over,
});
const imp = (over: Partial<ImportRow>): ImportRow => ({
  id: 'i',
  money_account_id: 'a1',
  period_from: '2026-09-01',
  period_to: '2026-09-30',
  tx_new: 5,
  state: 'parsed',
  created_at: '2026-10-01T10:00:00Z',
  ...over,
});
const tx = (over: Partial<TxRow>): TxRow => ({
  id: 't',
  money_account_id: 'a1',
  booked_on: '2026-09-15',
  amount: '-89.00',
  currency: 'CZK',
  counterparty_name: null,
  message: null,
  ...over,
});

describe('bankView', () => {
  it('labels accounts and picks the newest good import', () => {
    const view = bankView(
      [acc(), acc({ id: 'a2', account_number: null, bank_code: null }), acc({ id: 'a3', account_number: null, bank_code: null, iban: null, name: 'Cash' })],
      [
        imp({ id: 'old', period_from: '2026-08-01', period_to: '2026-08-31', created_at: '2026-09-01T10:00:00Z' }),
        imp({ id: 'new', tx_new: 7 }),
        imp({ id: 'bad', state: 'failed', created_at: '2026-10-02T10:00:00Z' }),
      ],
      [],
    );
    expect(view.accounts).toEqual([
      { id: 'a1', label: '2400123455/2010', lastImport: { from: '2026-09-01', to: '2026-09-30', added: 7 } },
      { id: 'a2', label: 'CZ8720100000002400123455', lastImport: null },
      { id: 'a3', label: 'Cash', lastImport: null },
    ]);
  });

  it('lists at most three problems, newest first', () => {
    const view = bankView(
      [acc()],
      [
        imp({ id: 'p1', money_account_id: null, state: 'needs_mapping', created_at: '2026-10-01T10:00:00Z' }),
        imp({ id: 'p2', money_account_id: null, state: 'failed', created_at: '2026-10-02T10:00:00Z' }),
        imp({ id: 'p3', money_account_id: null, state: 'needs_account', created_at: '2026-10-03T10:00:00Z' }),
        imp({ id: 'p4', money_account_id: null, state: 'failed', created_at: '2026-09-01T10:00:00Z' }),
        imp({ id: 'ok', state: 'duplicate_file' }),
      ],
      [],
    );
    expect(view.problems).toEqual([
      { id: 'p3', message: 'settings.bank.problem.needs_account', at: '2026-10-03T10:00:00Z' },
      { id: 'p2', message: 'settings.bank.problem.failed', at: '2026-10-02T10:00:00Z' },
      { id: 'p1', message: 'settings.bank.problem.needs_mapping', at: '2026-10-01T10:00:00Z' },
    ]);
  });

  it('shows the latest payments with who paid or what for', () => {
    const view = bankView(
      [acc()],
      [],
      [
        tx({ id: 't1', booked_on: '2026-09-14', counterparty_name: 'ODBERATEL SRO', amount: '12100.00' }),
        tx({ id: 't2', booked_on: '2026-09-16', message: '  NAKUP: KAVARNA PRAHA A MOC DLOUHY TEXT ZA NIM  ' }),
        tx({ id: 't3', booked_on: '2026-09-16' }),
      ],
    );
    expect(view.payments).toEqual([
      { id: 't3', date: '2026-09-16', who: '', amount: '-89.00', currency: 'CZK' },
      { id: 't2', date: '2026-09-16', who: 'NAKUP: KAVARNA PRAHA A MOC DLOUHY TEXT Z', amount: '-89.00', currency: 'CZK' },
      { id: 't1', date: '2026-09-14', who: 'ODBERATEL SRO', amount: '12100.00', currency: 'CZK' },
    ]);
  });
});
```

3. `en.json`: after the `settings.empty` line add
```json
  "settings.bank.title": "Bank accounts",
  "settings.bank.help": "We add an account the first time you upload one of its statements. Upload statements in the Inbox, the same way as invoices.",
  "settings.bank.none": "No bank account yet. Download a statement from your internet banking as GPC (ABO), CAMT.053 XML or MT940 and drop it into the Inbox.",
  "settings.bank.last_import": "Statement {from} – {to}, {n, plural, one {# new payment} other {# new payments}}",
  "settings.bank.no_import": "No statement yet",
  "settings.bank.payments": "Latest payments",
  "settings.bank.problem.failed": "A statement file could not be read. Download it again from your internet banking as GPC (ABO), CAMT.053 XML or MT940; PDF statements cannot be read.",
  "settings.bank.problem.needs_mapping": "We do not know this statement format yet. Download it as GPC (ABO), CAMT.053 XML or MT940 instead.",
  "settings.bank.problem.needs_account": "A statement did not say which account it belongs to. Download it again with the account number included.",
```
Commit `0114 step 3`.

4. `page.tsx`: import `formatMoney` next to `Card, formatLegalDate`, and `import { loadBankView } from '../../../src/settings/bank-data';`. Load `const bank = auth.ok && supabase ? await loadBankView(supabase, auth.orgId) : null;` after `view`. Insert, just before the "Who has access" card shown in §2, when `bank !== null`:
```tsx
          <Card className="flex flex-col gap-4 p-6">
            <h2 className="flex items-center gap-1 text-card-title">
              {t('settings.bank.title')}
              <HelpTip term={t('settings.bank.title')} text={t('settings.bank.help')} />
            </h2>
            {bank.accounts.length === 0 ? (
              <p className="text-body">{t('settings.bank.none')}</p>
            ) : (
              <dl className="flex flex-col gap-4">
                {bank.accounts.map((account) => (
                  <Row key={account.id} label={account.label}>
                    {account.lastImport === null
                      ? t('settings.bank.no_import')
                      : t('settings.bank.last_import', {
                          from: account.lastImport.from === null ? '' : formatLegalDate(account.lastImport.from),
                          to: account.lastImport.to === null ? '' : formatLegalDate(account.lastImport.to),
                          n: account.lastImport.added,
                        })}
                  </Row>
                ))}
              </dl>
            )}
            {bank.problems.map((problem) => (
              <p key={problem.id} role="status" className="text-body text-warning-foreground">
                {t(problem.message)}
              </p>
            ))}
            {bank.payments.length === 0 ? null : (
              <>
                <h3 className="text-body font-medium">{t('settings.bank.payments')}</h3>
                <ul className="flex flex-col gap-2">
                  {bank.payments.map((p) => (
                    <li key={p.id} className="flex flex-wrap justify-between gap-2 text-body">
                      <span>
                        {formatLegalDate(p.date)} · {p.who}
                      </span>
                      <span className="tabular-nums">{formatMoney(p.amount, p.currency, true)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
```
If `text-warning-foreground` is not a design token class in this repo (`grep -rn "warning-foreground" packages/ui apps/web/app/globals.css | head -3` finds nothing), use `text-muted-foreground` instead and say so. Run `pnpm --filter @shoebox/web typecheck 2>&1 | tail -10`. Commit `0114 step 4`.

## 5. Do not touch

`cs.json`, `packages/` except `en.json`, other web files, the worker. Hard rules: English copy through i18n only; design tokens only; no new screen, no new dependency.

## 6. Commands

- `pnpm --filter @shoebox/web test -- bank-data settings 2>&1 | tail -30` → pass.
- `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` → no errors.
- `pnpm --filter @shoebox/i18n test 2>&1 | tail -30` → pass.
- `pnpm biome check apps/web packages/i18n 2>&1 | tail -30` → clean (`--write` once for formatting only).

## 7. Acceptance

- [ ] The test file matches §4 (formatting aside) and passes.
- [ ] Typecheck, i18n test and biome clean. No screenshot needed (no new layout pattern; the card reuses Settings rows).

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found;
- a test fails twice, or a test the brief wrote seems wrong (say which assertion and why);
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a file outside §3 needs a change;
- a step is unclear.

## 9. Report

Write `docs/tasks/0114-report.md` (600 tokens at most) and set `Status: review`. The report has:

1. The files changed (`git diff --stat`).
2. Each command, with the last 5 lines of its output.
3. Anything you could not do, and why.
