# 0122: Pay card on the document page (checks, QR Platba, "pay anyway")

Status: todo
Ticket: P2-PAY-01 (UI half, M07 §4.9.1–§4.9.2, §7.1 copy) | Depends on: 0121 | Branch: claude/project-thread-236iho | PR base: phase/0
Executor: Sonnet 5.5 (visual judgement: the card's two states, checks + QR and blocking without QR, are laid out on the document page and judged in the browser) | Fits one session: 30 tool calls, 60k tokens
<!-- Risk: HIGH (money). The card never initiates a payment; it shows a QR the user scans in their own bank app. -->

## 1. Objective

On an unpaid received CZK document that names a pay-to account, `/inbox/[id]` shows a "Pay" card: the pre-payment checks in plain words and the QR Platba code for the open amount. A blocking check hides the QR until the user presses "I understand, pay anyway", which is audit-logged and snapshotted in `payment_orders`/`payment_order_items`. No new screen, one button at most, nothing moves money.

## 2. Context

- Pure pieces from 0121 (`@shoebox/bank`): `payToIban`, `buildSpayd`, `spaydSymbol`, `prePaymentChecks`, `toRegistryLookup`, types `PayToAccount`, `PrePaymentInput`, `PrePaymentResult`, `PaymentCheck`, `RegistryLookup`. `MATCHER_CONFIG.roundingToleranceCzk` (`'1.00'`) is the tolerance. Threshold: `createCzRules().at(asOf).get('vat.ruceni_cash_threshold')` (number, whole CZK), `asOf = pragueToday({ now: () => Date.now() })` (both from `@shoebox/domain`, pattern: `apps/web/app/(app)/prehled/page.tsx` lines 1–33).
- CRPDPH: `createCrpdphClient({ timeoutMs: 3000 })` from `@shoebox/registries` (web already depends on it); `client.status([digits])` returns `{ status: 'ok', data: { subjects }, fetchedAt } | { status: 'not_found' } | { status: 'unavailable', ... }`. The DIČ digits come from `partner_snapshot.dic` matching `/^CZ(\d{8,10})$/`; `subjects.find(s => s.dic === digits)`. Copy the shape from `apps/worker/src/doc-extract/registry-checks.ts` lines 70–90. Result ≤ 1 h old: no cache in this brief, one live call per page render with a 3 s timeout (`TODO(M07-crpdph-cache)`); a throw or non-`ok` status → `{ status: 'unavailable' }`; no CZ DIČ → `{ status: 'skipped' }`.
- Tables (`packages/db/migrations/0020_money.sql` lines 142–159, full tenant RLS, users may insert): `payment_orders(id, org_id, kind 'qr'|'abo', money_account_id, file_path, total numeric, item_count int, created_by, created_at)`, `payment_order_items(order_id, org_id, document_id, amount numeric, account text, variable_symbol, checks jsonb, risk_acknowledged_by)`. `payment_links(document_id, link_type, amount)`; open amount = `total_gross` − Σ(`payment`,`offset`,`platform_payout`,`fx_difference`) + Σ(`refund`), as Money (`::text` casts, ADR-007).
- `audit_log` is read-only for users; writes go through `public.audit_document(p_document, p_action, p_diff)` (`packages/db/migrations/0050_audit_document.sql`), whose action list is closed. Step 1 adds `'pay_anyway'` with a new migration (lane A range).
- Web patterns: `apps/web/src/documents/payment.ts` (store over `SupabaseLike`, pure view, `loadPaymentView` never throws), `payment-actions.ts` (`'use server'`, `requireActiveRole(['owner','member'])`, `useActionState`), `payment-card.tsx`, `trash-actions.ts` line 38 (`supabase.rpc('audit_document', ...)`). Page: `apps/web/app/(app)/inbox/[id]/page.tsx` (0119's `PaymentCard` block at lines 101–104). `direction` enum: `'in'` = received (we pay), `'out'` = issued. `vat_status` from `taxpayer_profiles` as `apps/web/src/overview/load.ts` lines 38–45 (`vat_status` column; none → `'neplatce'`).
- QR: `writeBarcode(text, { format: 'QRCode', ecLevel: 'M', scale: 6, withQuietZones: true })` from `zxing-wasm/writer` returns `{ svg, error }` (`packages/extraction/test/scan.test.ts` uses the same writer). Add `"zxing-wasm": "3.1.5"` to `apps/web/package.json` dependencies (already in the lockfile; `pnpm install --offline`). Render the `svg` string inline in a server component (`dangerouslySetInnerHTML`), labelled "QR Platba", about 200 px square (≥ 23 mm). If the wasm cannot load in the web runtime, pass `prepareZXingModule({ overrides: { locateFile } })` pointing at `node_modules/zxing-wasm/dist/writer/zxing_writer.wasm` and record it in the report.
- Copy: English only (`packages/i18n/messages/en.json`); the spec's Czech lines (M07 §7.1 `bank.pay.*`) are the meaning, not the text.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/migrations/0021_audit_pay_anyway.sql` | new | copy of 0050's `create or replace function` with `'pay_anyway'` added to the action list; same `revoke`/`grant` lines |
| `packages/db/test/migrations/audit-document.db.test.ts` | edit | one more `it`: `pay_anyway` writes a row (owner); unknown action still `22023` |
| `docs/v3/05-data-model.md` | edit | one line next to `audit_log` action notes: `pay_anyway` (M07 §4.9.1) |
| `apps/web/package.json` | edit | `zxing-wasm` dependency |
| `apps/web/src/documents/pay.ts` | new | `PayStore`, `supabasePayStore`, pure `payView`, `loadPayView` |
| `apps/web/src/documents/pay-qr.ts` | new | `spaydSvg(text): Promise<string \| null>` |
| `apps/web/src/documents/pay-actions.ts` | new | `payAnywayAction` |
| `apps/web/src/documents/pay-card.tsx` | new | server card + small client `PayAnywayButton` (may be a second file `pay-anyway-button.tsx`) |
| `apps/web/app/(app)/inbox/[id]/page.tsx` | edit | load view, render card after `PaymentCard` |
| `apps/web/test/pay.test.ts` | new | `payView` tests (step 3) |
| `packages/i18n/messages/en.json` | edit | keys in step 4 |

No other file may change. No new vendor.

## 4. Steps

1. **Migration + test.** `0021_audit_pay_anyway.sql` re-creates `public.audit_document` with `('edit_field', 'trash', 'restore', 'create_manual', 'answer_question', 'pay_anyway')`; nothing else changes. Test: `it('accepts pay_anyway', ...)` next to the `edit_field` case (skipped without `DATABASE_URL`, like the file). Run `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30`. Commit `0122 step 1`.

2. **Store + view** (`pay.ts`). `PayStore`: `document(id)` → `{ id, status, direction, paidAt, totalGross: string, currency, payTo: PayToAccount | null, partnerId, partnerDic, partnerName, documentNumber, variableSymbol, dueDate }` or null; `links(documentId)` → `{ linkType, amount: string }[]`; `vatStatus(asOf)`; `earlierIbans(partnerId, exceptDocumentId)` → IBANs of up to 50 other documents of the partner with `paid_at` not null, via `payToIban` (ok kind only, unique); `acknowledgedAt(documentId)` → newest `payment_orders.created_at` joined from `payment_order_items` where `document_id` = id and `risk_acknowledged_by` is not null, or null. `PayDeps = { crpdph: CrpdphClient; now: () => number }`.
   Pure `payView(input: { doc, links, vatStatus, registry: RegistryLookup, earlierIbans, acknowledgedAt, thresholdCzk, asOf, nowIso })` → `PayView | null`:
   - null when `direction !== 'in'`, `paidAt !== null`, `currency !== 'CZK'` or `payToIban(payTo).kind === 'none'` (no card at all: fewest things on screen).
   - `openAmount` as above (never below zero: clamp to `0.00`); `result = prePaymentChecks({...})`; `acknowledged = acknowledgedAt !== null && now − acknowledgedAt < 24 h`; `showQr = result.qrAllowed || (acknowledged && result.iban !== null)`; `spayd` = `buildSpayd({ iban, bic, amount: openAmount, vs: spaydSymbol(variableSymbol, documentNumber), dueDate, message: 'Uhrada ' + (documentNumber ?? ''), recipientName: partnerName ?? undefined }, asOf)` only when `showQr`, else null.
   - `PayView = { documentId, openAmount: string, checks: PaymentCheck[], blocking, acknowledged, showQr, spayd: string | null, iban: string | null, verifiedAt: string | null (registry fetchedAt), variableSymbol: string | null }`.
   `loadPayView(supabase, orgId, documentId, deps)` composes the store, the registry call and `payView`; never throws (null on any error). Commit `0122 step 2`.

3. **Tests** `apps/web/test/pay.test.ts` for `payView` (fakes, no Supabase): unpaid CZK received invoice with a published account → one `REGISTRY_OK` check, `showQr`, `spayd` starts with `SPD*1.0*ACC:` and contains `AM:`; unreliable + platce → `blocking`, `spayd === null`; same with `acknowledgedAt` 10 minutes ago → `showQr` and a `spayd`; `acknowledgedAt` 2 days ago → no QR; issued (`'out'`), paid, EUR, no account → null; links reduce the open amount (`total_gross 1210.00`, payment `210.00` → `AM:1000.00`). Run `pnpm --filter @shoebox/web exec vitest run test/pay.test.ts 2>&1 | tail -30`. Commit `0122 step 3`.

4. **Action + card + page + copy.** `payAnywayAction(prev, form)`: role owner/member; field `document` (uuid); `loadPayView` again server-side; refuse (`doc.pay.error`) when the view is null or `!blocking`; insert `payment_orders` `{ org_id, kind: 'qr', total: openAmount, item_count: 1, created_by: userId }` returning `id`; insert `payment_order_items` `{ order_id, org_id, document_id, amount: openAmount, account: iban ?? '', variable_symbol, checks: { verifiedAt, checks }, risk_acknowledged_by: userId }`; `supabase.rpc('audit_document', { p_document, p_action: 'pay_anyway', p_diff: { checks: codes } })`; `revalidatePath('/inbox/' + id)`; state `{ error: MessageKey | null; done: boolean }`.
   Card (server component, `Card` from `@shoebox/ui`): title `doc.pay.title`; amount line `doc.pay.amount` with `<MoneyText>`; one line per check (`ok` in body text, `info`/`warning` in `text-muted` with a leading "Note:", `blocking` with a leading "Stop:"; design tokens only, no raw colors; keys below), then `doc.pay.verified_at` with the time when `verifiedAt` is set; then either the QR (`<figure>` with the inline svg, `<figcaption>` `doc.pay.qr_label`, and the IBAN + VS in `text-muted` under it so the user can also type it) or, when `blocking && !acknowledged && canAct`, `doc.pay.blocked` + one secondary `<Button>` `doc.pay.pay_anyway` (client `PayAnywayButton` with `useActionState`; after `done` render `<AutoRefresh active />`). No other buttons. Page: `const payView = await loadPayView(supabase, orgId, detail.id, { crpdph: createCrpdphClient({ timeoutMs: 3000 }), now: Date.now })` next to `paymentView`; render `{payView ? <PayCard view={payView} canAct={canAct} /> : null}` directly after the `PaymentCard` block (anchor: `<PaymentCard documentId={detail.id} view={paymentView} canAct={canAct} />` + `) : null}`).
   Keys (append in the `doc.` block of `en.json`):
   - `"doc.pay.title": "Pay"`, `"doc.pay.amount": "To pay"`, `"doc.pay.qr_label": "QR Platba: scan it in your bank app"`
   - `"doc.pay.check.registry_ok": "The supplier is a reliable VAT payer and this account is published in the VAT register."`
   - `"doc.pay.check.unreliable_payer": "The supplier is an unreliable VAT payer. If you pay, you may be liable for their VAT."`
   - `"doc.pay.check.account_not_published": "This account is not published in the VAT register for this supplier."`
   - `"doc.pay.check.account_changed": "This account differs from the one you paid before. Check it with the supplier."`
   - `"doc.pay.check.registry_unavailable": "We couldn't reach the VAT register right now. We'll check again later."`
   - `"doc.pay.check.already_paid": "This invoice looks paid already."`, `"doc.pay.check.account_invalid": "The account number on the invoice is not valid."`, `"doc.pay.check.no_account": "The invoice has no account to pay to."`, `"doc.pay.check.foreign_currency": "Not in CZK, so there is no QR code."`
   - `"doc.pay.verified_at": "Checked {time}. If you pay later, we check again."`
   - `"doc.pay.blocked": "We hid the QR code because of the warning above."`, `"doc.pay.pay_anyway": "I understand, pay anyway"`, `"doc.pay.acknowledged": "You chose to pay anyway."`
   - `"doc.pay.error": "That didn't work. Please try again."`
   Run `pnpm --filter @shoebox/i18n test 2>&1 | tail -30`, `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`, `pnpm --filter @shoebox/web exec vitest run test/pay.test.ts 2>&1 | tail -30`. Commit `0122 step 4`.

## 5. Do not touch

`PaymentCard` (0119), the matcher, worker, `cs.json`, other screens. Never `Number()` on an amount. Every query `.eq('org_id', orgId)`. No document content in logs.

## 6. Commands

Those in the steps; `pnpm biome check apps/web packages/db 2>&1 | tail -5` → 0 errors; `pnpm --filter @shoebox/web e2e -- inbox 2>&1 | tail -30` if an inbox spec exists (report only).

## 7. Acceptance

- [ ] No card on issued, paid, non-CZK or account-less documents. - [ ] Blocking hides the QR; "pay anyway" writes one `payment_orders` + one item with `risk_acknowledged_by` and one `audit_log` row with action `pay_anyway`, then the QR shows for 24 h. - [ ] A registry outage shows a note and still shows the QR. - [ ] The QR decodes to the `spayd` string (state how you checked).

## 8. Stop and ask

Stop and write the report if a file outside §3 needs a change, the wasm cannot be loaded in the web runtime after the `locateFile` override, a test fails twice, or you reach 25 tool calls / 50k tokens.

## 9. Report

`docs/tasks/0122-report.md` (600 tokens at most), `Status: review`: files changed, each command with its last 5 lines, deviations, and a screenshot path if one was taken.
