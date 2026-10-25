# 0053: Fix a value on the document page, and the checks run again

Status: review
Ticket: P1 review screen, part 2b (trimmed, Phase 1 core loop) | Depends on: 0051 and 0052 merged into phase/0 | Base commit: see branch | Branch: task/0053-fix-a-value | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

On the document page, every value we read that the checks look at has a small "Fix" link. Tapping it opens one input in place, with Save and Cancel. Saving stores the user's value, runs the checks again on the corrected data (hard rule 2), and sets the document to `ready` when no blocking check is left, or to `needs_review` otherwise. There is no separate confirm button: a clean document is done.

## 2. Context

- Owner rules: fewest buttons, plain words, no fine print (`text-body` or larger), tokens only, English keys in `packages/i18n/messages/en.json` only (rule 6).
- 0052 exports from `@shoebox/validation`: `runProtoChecks(input, { today, org? })`, `checkInputFromFields(fields, documentClass?)`, `validationRowsOf(results)` and `type ValidationRow` (`{ ruleId, ruleVersion, severity: 'blocking' | 'warning', params }`). `apps/web` does not depend on `@shoebox/validation` yet (it is a workspace package, so no owner line is needed).
- `isLegalDate(s)`, `pragueToday(clock)` and `type LegalDate` come from `@shoebox/domain`; the web gets today as `pragueToday({ now: () => Date.now() })` (see `apps/web/app/(app)/prehled/page.tsx`).
- Auth: `requireActiveRole(['owner', 'member'])` from `apps/web/src/auth/org-context.ts` returns `{ ok: true, orgId, userId, role }` or `{ ok: false, code }`. `createSupabaseServerClient()` from `apps/web/src/supabase/server.ts` is the user's client (RLS: owner and member may write `documents`, `document_fields`, `validation_results`). Import only; never edit auth files.
- Forms: `apps/web/src/auth/login-form.tsx` shows the pattern (`'use client'`, `useActionState(action, initial)`, `<form action={action}>`, `Button`, `Input` from `@shoebox/ui`; `Button` has `variant` `primary | secondary | ghost | link`).
- Tables (05): `document_fields (org_id, document_id, field_key, value_text, source field_source, set_by uuid, is_current boolean)`; `validation_results (org_id, document_id, rule_id, rule_version, severity, state 'open'|'resolved'|'dismissed', params jsonb, unique (document_id, rule_id))`; `documents` columns `status, class, partner_snapshot jsonb, document_number, variable_symbol, issue_date, duzp, due_date, total_net, total_vat, total_gross`.
- The page from 0051 is `apps/web/app/(app)/inbox/[id]/page.tsx`; it renders each `detail.fields` entry as:

```tsx
                <div key={field.label} className="flex flex-wrap justify-between gap-2">
                  <dt className="text-body text-foreground">{t(field.label)}</dt>
                  <dd className="text-body">
```

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/web/package.json` | edit | add `"@shoebox/validation": "workspace:*"` to dependencies |
| `pnpm-lock.yaml` | regenerate | `pnpm install --offline` only, never by hand |
| `apps/web/src/documents/correction.ts` | create | pure: `EDITABLE`, `editKeyOf`, `normalizeInput`, `planCorrection` |
| `apps/web/test/correction.test.ts` | create | the test file below, verbatim |
| `apps/web/src/documents/correction-store.ts` | create | `applyCorrection` (the writes) |
| `apps/web/src/documents/correction-actions.ts` | create | the server action |
| `apps/web/src/documents/fix-field.tsx` | create | the Fix / Save / Cancel client component |
| `apps/web/app/(app)/inbox/[id]/page.tsx` | edit | show `FixField` next to editable values |
| `packages/i18n/messages/en.json` | edit | the keys below |

No other file may change.

## 4. Steps

1. Add `"@shoebox/validation": "workspace:*"` to `apps/web/package.json` dependencies (alphabetical, after `@shoebox/ui`), run `pnpm install --offline 2>&1 | tail -5`. Add to `en.json` after the `doc.detail.*` keys:

```json
  "doc.fix.cta": "Fix",
  "doc.fix.save": "Save",
  "doc.fix.cancel": "Cancel",
  "doc.fix.saved": "Saved. We checked the document again.",
  "doc.fix.error.empty": "Type a value.",
  "doc.fix.error.long": "That is too long.",
  "doc.fix.error.date": "Use a date like 2026-10-25.",
  "doc.fix.error.money": "Use an amount like 1210.50.",
  "doc.fix.error.locked": "This document can't be changed now.",
  "doc.fix.error.save": "We couldn't save that. Please try again.",
```

   Run `pnpm --filter @shoebox/i18n test 2>&1 | tail -30`. Expected: pass. Commit `0053 step 1`.
2. Create `apps/web/src/documents/correction.ts` exactly:

```ts
import type { LegalDate } from '@shoebox/domain';
import { isLegalDate } from '@shoebox/domain';
import type { MessageKey } from '@shoebox/i18n';
import {
  checkInputFromFields,
  runProtoChecks,
  type ValidationRow,
  validationRowsOf,
} from '@shoebox/validation';

export type FixKind = 'text' | 'date' | 'money';

/** The values a user may fix: the M02 field key, how it is typed, its label and its `documents` column. */
export const EDITABLE = {
  'supplier.ico': { kind: 'text', label: 'proto.field.supplier_ico', column: 'partner_snapshot.ico' },
  'supplier.dic': { kind: 'text', label: 'proto.field.supplier_dic', column: 'partner_snapshot.dic' },
  'document.number': { kind: 'text', label: 'proto.field.document_number', column: 'document_number' },
  'document.variable_symbol': { kind: 'text', label: 'proto.field.variable_symbol', column: 'variable_symbol' },
  'dates.issue_date': { kind: 'date', label: 'proto.field.issue_date', column: 'issue_date' },
  'dates.duzp': { kind: 'date', label: 'doc.field.duzp', column: 'duzp' },
  'dates.due_date': { kind: 'date', label: 'proto.field.due_date', column: 'due_date' },
  'totals.net': { kind: 'money', label: 'proto.field.total_net', column: 'total_net' },
  'totals.vat': { kind: 'money', label: 'proto.field.total_vat', column: 'total_vat' },
  'totals.gross': { kind: 'money', label: 'proto.field.total_gross', column: 'total_gross' },
} as const satisfies Record<string, { kind: FixKind; label: MessageKey; column: string }>;

export type EditKey = keyof typeof EDITABLE;

export function isEditKey(key: string): key is EditKey {
  return Object.hasOwn(EDITABLE, key);
}

/** The edit key shown next to a detail field with this label, if that value can be fixed. */
export function editKeyOf(label: MessageKey): EditKey | null {
  for (const [key, spec] of Object.entries(EDITABLE)) if (spec.label === label) return key as EditKey;
  return null;
}

export type Normalized = { ok: true; value: string } | { ok: false; error: MessageKey };

/** Turns what the user typed into the stored text, or names what is wrong with it. */
export function normalizeInput(kind: FixKind, raw: string): Normalized {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: false, error: 'doc.fix.error.empty' };
  if (trimmed.length > 64) return { ok: false, error: 'doc.fix.error.long' };
  if (kind === 'date') return isLegalDate(trimmed) ? { ok: true, value: trimmed } : { ok: false, error: 'doc.fix.error.date' };
  if (kind === 'money') {
    const compact = trimmed.replace(/[\s  ]/g, '').replace(',', '.');
    if (!/^-?\d+(\.\d{1,2})?$/.test(compact)) return { ok: false, error: 'doc.fix.error.money' };
    const [whole, cents = ''] = compact.split('.');
    return { ok: true, value: `${whole}.${cents.padEnd(2, '0')}` };
  }
  return { ok: true, value: trimmed };
}

export interface CorrectionPlan {
  readonly fields: Readonly<Record<string, string>>;
  readonly rows: readonly ValidationRow[];
  readonly status: 'ready' | 'needs_review';
}

/** The corrected fields, the checks run again on them, and the status that follows (hard rule 2). */
export function planCorrection(input: {
  fields: Readonly<Record<string, string>>;
  documentClass: string;
  editKey: EditKey;
  value: string;
  org: { ico: string | null; dic: string | null } | null;
  today: LegalDate;
}): CorrectionPlan {
  const fields = { ...input.fields, [input.editKey]: input.value };
  const checks = runProtoChecks(
    checkInputFromFields(fields, input.documentClass),
    input.org === null ? { today: input.today } : { today: input.today, org: input.org },
  );
  const rows = validationRowsOf(checks);
  const unsure = input.documentClass === 'unknown' || input.documentClass === 'unreadable';
  const status = unsure || rows.some((r) => r.severity === 'blocking') ? 'needs_review' : 'ready';
  return { fields, rows, status };
}
```

   If the type of `runProtoChecks`'s `org` option differs, adapt only the call. Create the test file below verbatim. Run `pnpm --filter @shoebox/web exec vitest run test/correction.test.ts 2>&1 | tail -30`. Expected: pass. Commit `0053 step 2`.

```ts
import { describe, expect, it } from 'vitest';
import { editKeyOf, isEditKey, normalizeInput, planCorrection } from '../src/documents/correction';

const fields = {
  'supplier.ico': '27082440',
  'supplier.dic': 'CZ27082440',
  'supplier.country': 'CZ',
  'dates.issue_date': '2026-10-01',
  'dates.duzp': '2026-10-01',
  'dates.due_date': '2026-10-15',
  currency: 'CZK',
  'totals.net': '1000',
  'totals.vat': '210',
  'totals.gross': '1210',
  'vat_recap[0].rate_pct': '21',
  'vat_recap[0].base': '1000',
  'vat_recap[0].vat': '210',
  'flags.non_vat_payer_text': 'false',
  'flags.reverse_charge_text': 'false',
  'flags.paid_text': 'false',
};
const today = '2026-10-20' as never;

describe('normalizeInput', () => {
  it('accepts Czech-style amounts and pads cents', () => {
    expect(normalizeInput('money', ' 1 210,5 ')).toEqual({ ok: true, value: '1210.50' });
    expect(normalizeInput('money', '1210')).toEqual({ ok: true, value: '1210.00' });
    expect(normalizeInput('money', '12.345')).toEqual({ ok: false, error: 'doc.fix.error.money' });
  });
  it('checks dates and empty input', () => {
    expect(normalizeInput('date', '2026-10-25')).toEqual({ ok: true, value: '2026-10-25' });
    expect(normalizeInput('date', '25.10.2026')).toEqual({ ok: false, error: 'doc.fix.error.date' });
    expect(normalizeInput('text', '   ')).toEqual({ ok: false, error: 'doc.fix.error.empty' });
  });
});

describe('edit keys', () => {
  it('maps labels to keys and rejects unknown keys', () => {
    expect(editKeyOf('proto.field.total_gross')).toBe('totals.gross');
    expect(editKeyOf('proto.field.supplier_name')).toBeNull();
    expect(isEditKey('totals.gross')).toBe(true);
    expect(isEditKey('toString')).toBe(false);
  });
});

describe('planCorrection', () => {
  it('a wrong total blocks, and fixing it makes the document ready', () => {
    const broken = planCorrection({ fields, documentClass: 'received_invoice', editKey: 'totals.gross', value: '1300.00', org: null, today });
    expect(broken.status).toBe('needs_review');
    expect(broken.rows.some((r) => r.severity === 'blocking')).toBe(true);
    const fixed = planCorrection({ fields: broken.fields, documentClass: 'received_invoice', editKey: 'totals.gross', value: '1210.00', org: null, today });
    expect(fixed.status).toBe('ready');
    expect(fixed.fields['totals.gross']).toBe('1210.00');
  });
  it('an unknown class stays in review', () => {
    expect(planCorrection({ fields, documentClass: 'unknown', editKey: 'totals.gross', value: '1210.00', org: null, today }).status).toBe('needs_review');
  });
});
```

   If the "wrong total blocks" test fails because no check blocks a gross of 1300 against a recap of 1000 + 210, stop and report (do not change the test).
3. Create `apps/web/src/documents/correction-store.ts`, `applyCorrection(supabase, input): Promise<{ ok: true; status: 'ready' | 'needs_review' } | { ok: false; error: MessageKey }>` with `input = { orgId, userId, documentId, editKey: EditKey, value: string, today: LegalDate }` and `type SupabaseLike = Awaited<ReturnType<typeof createSupabaseServerClient>>`. Wrap everything in `try { … } catch { return { ok: false, error: 'doc.fix.error.save' } }`; any Supabase `error` also returns `doc.fix.error.save`. In this order:
   1. Read `documents` `select('id, status, class, partner_snapshot').eq('id', documentId).eq('org_id', orgId).is('deleted_at', null).maybeSingle()`. Missing → `doc.fix.error.save`. `status` not `ready` or `needs_review` → `doc.fix.error.locked`.
   2. Read current fields `document_fields` `select('field_key, value_text').eq('document_id', documentId).eq('is_current', true)` into a `Record<string, string>` (skip null `value_text`); the org `organizations` `select('ico, dic').eq('id', orgId).maybeSingle()` (null when missing or both null); and the rule ids already settled by the user, `validation_results` `select('rule_id').eq('document_id', documentId).neq('state', 'open')`.
   3. `plan = planCorrection({ fields, documentClass: doc.class, editKey, value, org, today })`.
   4. Writes, each checked for `error`, in this order (the first one makes sure a half-saved document is never left `ready`):
      - `documents.update({ status: 'needs_review' })` for this id and org;
      - `document_fields.update({ is_current: false })` `.eq('document_id', documentId).eq('field_key', editKey).eq('is_current', true)`;
      - `document_fields.insert({ org_id: orgId, document_id: documentId, field_key: editKey, value_text: value, source: 'user', set_by: userId })`;
      - `documents.update(patch)` where `patch` is `{ partner_snapshot: { ...(doc.partner_snapshot ?? {}), ico|dic: value } }` for a `partner_snapshot.*` column, else `{ [column]: value }`;
      - `validation_results.delete().eq('document_id', documentId).eq('state', 'open')`;
      - when there are rows whose `ruleId` is not settled: `validation_results.insert(rows.map((r) => ({ org_id: orgId, document_id: documentId, rule_id: r.ruleId, rule_version: r.ruleVersion, severity: r.severity, params: r.params })))`;
      - `documents.update({ status: plan.status })` for this id and org.
   5. Return `{ ok: true, status: plan.status }`.

   Run `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`. Expected: clean. Commit `0053 step 3`.
4. Create `apps/web/src/documents/correction-actions.ts`:

```ts
'use server';
// FixState = { error: MessageKey | null; saved: boolean }
export async function fixFieldAction(_prev: FixState, form: FormData): Promise<FixState>
```

   It reads `id`, `key`, `value` as strings from `form`; `requireActiveRole(['owner', 'member'])` not ok → `{ error: 'doc.fix.error.locked', saved: false }`; `!isEditKey(key)` → `doc.fix.error.save`; `normalizeInput(EDITABLE[key].kind, value)` not ok → its error; then `applyCorrection(await createSupabaseServerClient(), { orgId, userId, documentId: id, editKey: key, value: normalized.value, today: pragueToday({ now: () => Date.now() }) })`; on success `revalidatePath(`/inbox/${id}`)` (from `next/cache`) and return `{ error: null, saved: true }`. Export `type FixState` from `correction.ts` instead if `'use server'` files may only export async functions. Never log the value.

   Create `apps/web/src/documents/fix-field.tsx` (`'use client'`), `FixField({ documentId, editKey, kind, label, current }: { documentId: string; editKey: EditKey; kind: FixKind; label: MessageKey; current: string })`:
   - closed: one `<Button variant="link" type="button">` with `t('doc.fix.cta')` and `aria-label` = `` `${t('doc.fix.cta')}: ${t(label)}` ``;
   - open: a `<form action={action}>` with hidden `id` and `key`, one `Input` named `value` (`defaultValue={current}`, `type="date"` for dates, `inputMode="decimal"` for money, `autoFocus`, `aria-label={t(label)}`, `aria-invalid` and `aria-describedby` pointing at the error when there is one), a `Button type="submit"` Save (`disabled={pending}`, `aria-busy={pending}`) and a `Button variant="ghost" type="button"` Cancel that closes it;
   - after `state.saved` it closes and shows `t('doc.fix.saved')` in a `<p role="status" className="text-body">`; an error shows in `<p id=… role="alert" className="text-body text-destructive">` (use the token class that exists in `packages/ui`; if `text-destructive` is not a token, use the one `Alert` uses).
5. Edit `apps/web/app/(app)/inbox/[id]/page.tsx`: get `canFix = auth.ok && (auth.role === 'owner' || auth.role === 'member') && (detail.status === 'ready' || detail.status === 'needs_review')`. In the field row, after the `<dd>`, render `{canFix && editKeyOf(field.label) ? <FixField documentId={detail.id} editKey={…} kind={EDITABLE[key].kind} label={field.label} current={field.value} /> : null}` (compute the key once). Leave everything else on the page as it is. Run `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` and `pnpm --filter @shoebox/web test 2>&1 | tail -30`. Expected: clean, pass. Commit `0053 step 5`.
6. Run `pnpm exec biome ci apps/web packages/i18n 2>&1 | tail -30` (fix with `pnpm exec biome check --write <file>`), `pnpm exec depcruise apps packages --config .dependency-cruiser.cjs 2>&1 | tail -10` and `python3 scripts/context_lint.py 2>&1 | tail -30`. Expected: clean. Commit `0053 step 6`.

## 5. Do not touch

`apps/web/src/auth/**`, `apps/web/e2e/**`, `apps/worker/**`, `packages/validation/**`, `packages/db/**`, `apps/web/src/documents/detail-data.ts`, every other `en.json` key, `cs.json`.

## 6. Commands

The commands of steps 1–6, each ending `2>&1 | tail -30`.

## 7. Acceptance

- [ ] A wrong total blocks; fixing it re-runs the checks and gives `ready` (test).
- [ ] The first write sets `needs_review`, the last sets the planned status; a dismissed or resolved rule is never re-inserted.
- [ ] Only owner and member see Fix, and only on `ready` / `needs_review` documents; the action re-checks the role.
- [ ] web tests, typecheck, biome and depcruise are clean.

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found;
- a test fails twice, or a test the brief wrote seems wrong;
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a new outside dependency seems needed;
- a file outside §3 needs a change, or §5 would be touched;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy.

## 9. Report

Write `docs/tasks/0053-report.md` (600 tokens at most) and set `Status: review`. The report has the files changed, each command with the last 5 lines of output, §7 ticked, deviations, questions, owner steps left.

## Risk list (for the reviewer)

`correction-store.ts` (write order, settled rules, org scope), `planCorrection` (status rule).

## Owner steps

None.
