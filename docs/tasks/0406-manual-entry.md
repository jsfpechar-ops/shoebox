# 0406: Add a document by hand

Status: todo
Ticket: lane D, M11 §5.1a | Depends on: 0401, 0404 | Branch: claude/project-thread-yn56ih | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

For a lost receipt, a cash expense or a document never issued, the user types the few facts (who, when, how much, how paid) on `/inbox/new` and gets a normal document that the checks run on. The Inbox gets an "Add by hand" link.

## 2. Context

- M11 §5.1a: creates `documents` with `entry_mode = 'manual'`, class from "Type" (`received_receipt` default, `received_invoice`, `issued_invoice`), `direction` `in` for received, `out` for issued, `source_file_id` null. One `document_lines` row from Amount + "What for". Typed fields have `field_source = 'user'`. "The document is missing or damaged" sets `substitute_reason ∈ {lost, damaged, never_issued, other}` and always shows the note `manual.substitute.note`. Partner: 8 digits = IČO, otherwise a plain name (no `partners` row).
- Click budget: "Add by hand" → type → "Save".
- Checks: `planCorrection` in `apps/web/src/documents/correction.ts` runs the checks on a field map: `planCorrection({ fields, documentClass, editKey, value, org, today })` returns `{ fields, rows, status }`. Use `editKey: 'totals.gross'`, `value: amount`.
- `normalizeInput(kind: 'text' | 'date' | 'money', raw)` in the same file returns `{ ok: true, value } | { ok: false, error: MessageKey }`; dates come back as `YYYY-MM-DD`, money as a decimal string.
- Insert pattern and column names: `apps/web/src/documents/correction-store.ts` (document_fields: `org_id, document_id, field_key, value_text, source: 'user', set_by`; validation_results: `org_id, document_id, rule_id, rule_version, severity, params`). The org's `ico, dic` come from `organizations` as there.
- Audit: `rpc('audit_document', { p_document, p_action: 'create_manual', p_diff: {} })`.
- Server action + `useActionState` pattern: `correction-actions.ts`, `fix-field.tsx`. UI: `Button, Input, Label, Card` from `@shoebox/ui`; native `<select>` and radio inputs styled like 0404's selects; labels above inputs (07); errors `role="alert"` and `aria-describedby`.

## 3. Files

| Path | Action |
|---|---|
| `apps/web/src/documents/manual-entry.ts` | new (pure) |
| `apps/web/test/manual-entry.test.ts` | new (below) |
| `apps/web/src/documents/manual-entry-actions.ts` | new (`'use server'`) |
| `apps/web/src/documents/manual-entry-form.tsx` | new (`'use client'`) |
| `apps/web/app/(app)/inbox/new/page.tsx` | new |
| `apps/web/app/(app)/inbox/page.tsx` | edit: one link |
| `packages/i18n/messages/en.json` | edit: keys |

## 4. Steps

1. `en.json` keys (after the `trash.*` block):
   ```
     "manual.cta": "Add by hand",
     "manual.title": "Add a document by hand",
     "manual.intro": "For a lost receipt, a cash payment or anything without a file. Type what you know; we check the rest.",
     "manual.kind": "Type",
     "manual.kind.received_receipt": "Receipt or cash expense",
     "manual.kind.received_invoice": "Invoice I received",
     "manual.kind.issued_invoice": "Invoice I issued",
     "manual.partner": "Who (company ID or name)",
     "manual.partner.hint": "Type the 8-digit company ID (IČO) if you have it, otherwise the name.",
     "manual.date": "Date",
     "manual.amount": "Amount in CZK",
     "manual.paid": "How was it paid?",
     "manual.paid.cash": "Cash",
     "manual.paid.card": "Card",
     "manual.paid.bank_transfer": "Bank transfer",
     "manual.paid.unpaid": "Not paid yet",
     "manual.note": "What for (optional)",
     "manual.missing": "The document is missing or damaged",
     "manual.reason": "Why",
     "manual.reason.lost": "Lost",
     "manual.reason.damaged": "Damaged",
     "manual.reason.never_issued": "Never issued",
     "manual.reason.other": "Other reason",
     "manual.substitute.note": "The expense can still count for income tax if you can prove the payment. VAT cannot be claimed without a proper tax document. Your accountant decides.",
     "manual.save": "Save",
     "manual.error.partner": "Type who it was from or for.",
     "manual.error.save": "We could not save it. Please try again.",
   ```
2. New `apps/web/src/documents/manual-entry.ts`:
   ```ts
   import type { LegalDate } from '@shoebox/domain';
   import type { MessageKey } from '@shoebox/i18n';
   export const MANUAL_KINDS = ['received_receipt', 'received_invoice', 'issued_invoice'] as const;
   export const MANUAL_PAID = ['cash', 'card', 'bank_transfer', 'unpaid'] as const;
   export const MANUAL_REASONS = ['lost', 'damaged', 'never_issued', 'other'] as const;
   export interface ManualEntry {
     readonly kind: (typeof MANUAL_KINDS)[number];
     readonly partnerName: string | null; readonly partnerIco: string | null;
     readonly date: LegalDate; readonly amount: string;
     readonly paid: (typeof MANUAL_PAID)[number]; readonly note: string | null;
     readonly substituteReason: (typeof MANUAL_REASONS)[number] | null;
   }
   export type ManualParse = { ok: true; value: ManualEntry } | { ok: false; errors: Partial<Record<'partner' | 'date' | 'amount', MessageKey>> };
   export function parseManualEntry(form: Readonly<Record<string, string>>): ManualParse;
   /** The `document_fields` map (field key → text) the checks and the document page read. */
   export function manualFields(entry: ManualEntry): Record<string, string>;
   /** The `documents` columns of the new row (status and org are added by the caller). */
   export function manualDocumentColumns(entry: ManualEntry): Record<string, unknown>;
   ```
   Rules: form keys `kind, partner, date, amount, paid, note, missing, reason`. Unknown kind → `received_receipt`; unknown paid → `cash`. Partner trimmed: empty → error `manual.error.partner`; `/^\d{8}$/` → partnerIco, else partnerName (≤ 200 chars). Date via `normalizeInput('date', …)`, amount via `normalizeInput('money', …)` (their errors go to `errors.date` / `errors.amount`). `note` trimmed ≤ 200, empty → null. `substituteReason` only when `missing === 'on'`: reason if valid else `'other'`. `manualFields`: party prefix `supplier` for received kinds, `buyer` for `issued_invoice`; keys `<party>.name` / `<party>.ico` (only those set), `dates.issue_date`, `totals.gross`, `currency` = `CZK`, `payment.method` (only when not `unpaid`). `manualDocumentColumns`: `entry_mode: 'manual'`, `class: kind`, `direction: kind === 'issued_invoice' ? 'out' : 'in'`, `partner_snapshot: { name, ico }` (only set keys), `issue_date: date`, `currency: 'CZK'`, `total_gross: amount`, `payment_method: paid === 'unpaid' ? null : paid`, `is_paid_per_document: paid !== 'unpaid'`, `substitute_reason`.
   Test `apps/web/test/manual-entry.test.ts` (do not edit):
   ```ts
   import { describe, expect, it } from 'vitest';
   import { manualDocumentColumns, manualFields, parseManualEntry } from '../src/documents/manual-entry';

   const base = { kind: 'received_receipt', partner: 'Parkoviště Anděl', date: '2026-09-09', amount: '350', paid: 'cash' };

   describe('parseManualEntry', () => {
     it('reads a cash receipt', () => {
       const r = parseManualEntry(base);
       expect(r.ok).toBe(true);
       if (!r.ok) return;
       expect(r.value).toMatchObject({ kind: 'received_receipt', partnerName: 'Parkoviště Anděl', partnerIco: null, date: '2026-09-09', paid: 'cash', note: null, substituteReason: null });
     });
     it('an 8-digit partner is a company ID', () => {
       const r = parseManualEntry({ ...base, partner: ' 27082440 ' });
       expect(r.ok && r.value.partnerIco).toBe('27082440');
     });
     it('needs a partner, a date and an amount', () => {
       const r = parseManualEntry({ ...base, partner: ' ', date: 'yesterday', amount: 'abc' });
       expect(r.ok).toBe(false);
       if (r.ok) return;
       expect(r.errors.partner).toBe('manual.error.partner');
       expect(r.errors.date).toBeDefined();
       expect(r.errors.amount).toBeDefined();
     });
     it('the reason counts only when the document is marked missing', () => {
       const off = parseManualEntry({ ...base, reason: 'lost' });
       expect(off.ok && off.value.substituteReason).toBeNull();
       const on = parseManualEntry({ ...base, missing: 'on', reason: 'bogus' });
       expect(on.ok && on.value.substituteReason).toBe('other');
     });
   });

   describe('rows', () => {
     it('a received receipt fills supplier fields and an expense document', () => {
       const r = parseManualEntry({ ...base, partner: '27082440', paid: 'unpaid', kind: 'received_invoice' });
       if (!r.ok) throw new Error('parse');
       expect(manualFields(r.value)).toEqual({ 'supplier.ico': '27082440', 'dates.issue_date': '2026-09-09', 'totals.gross': r.value.amount, currency: 'CZK' });
       expect(manualDocumentColumns(r.value)).toMatchObject({ entry_mode: 'manual', class: 'received_invoice', direction: 'in', payment_method: null, is_paid_per_document: false, partner_snapshot: { ico: '27082440' } });
     });
     it('an issued invoice is income with buyer fields', () => {
       const r = parseManualEntry({ ...base, kind: 'issued_invoice', paid: 'bank_transfer' });
       if (!r.ok) throw new Error('parse');
       expect(manualFields(r.value)['buyer.name']).toBe('Parkoviště Anděl');
       expect(manualFields(r.value)['payment.method']).toBe('bank_transfer');
       expect(manualDocumentColumns(r.value)).toMatchObject({ direction: 'out', is_paid_per_document: true });
     });
   });
   ```
   (The form's date input sends ISO dates, so the test uses `2026-09-09`.)
3. New `manual-entry-actions.ts`: `export type ManualState = { errors: Partial<Record<'partner'|'date'|'amount'|'form', MessageKey>> }` and `export async function saveManualEntryAction(_prev: ManualState, form: FormData): Promise<ManualState>`. Steps: `requireActiveRole(['owner','member'])` (not ok → `{ errors: { form: 'manual.error.save' } }`); collect the form keys as strings; `parseManualEntry` (errors → return them); load org `ico, dic`; `plan = planCorrection({ fields: manualFields(v), documentClass: v.kind, editKey: 'totals.gross', value: v.amount, org, today: pragueToday({ now: () => Date.now() }) })`; insert `documents` `{ org_id, ...manualDocumentColumns(v), status: 'needs_review' }` `.select('id').single()`; insert `document_fields` rows for each `plan.fields` entry (source `user`, `set_by: auth.userId`); insert one `document_lines` `{ org_id, document_id, position: 1, description: v.note, gross: v.amount }`; insert `plan.rows` into `validation_results` (as in correction-store); update status to `plan.status`; `rpc('audit_document', …'create_manual'…)`; any error → `{ errors: { form: 'manual.error.save' } }`; success → `revalidatePath('/inbox')` and `redirect(\`/inbox/${id}\`)`. Never log values.
4. New `manual-entry-form.tsx` (`'use client'`): `useActionState(saveManualEntryAction, { errors: {} })`; a `<form action={action} className="flex flex-col gap-4">` with, in order: Type `<select name="kind">` (3 options), Who `Input name="partner"` with hint, Date `Input name="date" type="date"` (default today: `new Date().toISOString().slice(0, 10)`), Amount `Input name="amount" inputMode="decimal"`, "How was it paid?" `<fieldset>` + `<legend>` with 4 radios (`name="paid"`, cash checked), What for `Input name="note"`, a checkbox `name="missing"` with label `manual.missing` — when checked (local `useState`) show Why `<select name="reason">` and `<p className="text-body">` `manual.substitute.note`; a `role="alert"` paragraph for `errors.form`; submit `Button` `manual.save` (disabled while pending). Each field error renders under its input with `role="alert"` and the input gets `aria-invalid` + `aria-describedby`.
5. New `apps/web/app/(app)/inbox/new/page.tsx`: server component; `requireActiveRole(['owner','member'])`; not ok → `redirect('/inbox')`. Renders a back link (`doc.detail.back` → `/inbox`), `<h1 className="text-title">` `manual.title`, `<p className="text-body">` `manual.intro`, `<Card className="p-6"><ManualEntryForm /></Card>`. `export const metadata = { title: t('manual.title') }`.
6. Inbox `page.tsx`: directly after `<UploadDropzone />` add `<Link href="/inbox/new" className="text-body underline">{t('manual.cta')}</Link>` (already imports `Link`).
7. `pnpm --filter @shoebox/web test -- manual-entry 2>&1 | tail -20`, `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`, `pnpm --filter @shoebox/i18n test 2>&1 | tail -5`, `pnpm exec biome check apps/web packages/i18n 2>&1 | tail -15` (fix your files with `--write`).

## 5. Do not touch

`correction.ts`, `correction-store.ts`, other screens. Hard rules 1 (money stays a string), 2 (status only from the checks), 3, 6.

## 6. Commands

As in step 7.

## 7. Acceptance

- [ ] manual-entry tests pass; typecheck 0; biome clean.

## 8. Stop and ask

As TEMPLATE §8.

## 9. Report

`docs/tasks/0406-report.md`, 150 tokens at most. Set `Status: review`.
