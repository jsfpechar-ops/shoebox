# 0051: Document page: what we read and what needs attention

Status: todo
Ticket: P1 review screen, part 1 (trimmed, Phase 1 core loop) | Depends on: 0047, 0049, 0050 merged into phase/0 | Base commit: phase/0 after those merges | Branch: task/0051-document-detail | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Tapping a document in the Inbox opens its page: the file itself (photo inline, PDF one tap away), what we read from it in plain words, and, only when a check found something, a short list of what needs the user's attention. A clean document says "Everything checks out" and asks nothing.

## 2. Context

- Owner rules (07 rules 11–14): fewest buttons, plain words first with the official term in brackets only when it is a different word, no fine print (everything `text-body` or larger, never `text-sm`/`text-xs`/`text-muted-foreground`), tokens only. UI copy is English for now (0050): add keys to `packages/i18n/messages/en.json` only.
- Hard rule 3: org-scoped. Use `requireActiveRole(['owner','member','accountant','viewer'])` from `apps/web/src/auth/org-context.ts` and the user's Supabase client from `apps/web/src/supabase/server.ts` (RLS applies). Import only; never edit auth files.
- Data:
  - `documents`: `select('id, status, class, currency, total_net, total_vat, total_gross, issue_date, duzp, due_date, document_number, variable_symbol, partner_snapshot, pay_to_account, created_at, source_files(storage_path, mime_type, original_filename)').eq('id', id).eq('org_id', orgId).is('deleted_at', null).maybeSingle()`
  - `document_vat_summary`: `select('vat_rate_pct, base, vat').eq('document_id', id).order('vat_rate_pct', { ascending: false })`
  - `validation_results`: `select('rule_id, severity, params').eq('document_id', id).eq('state', 'open')`. Each row's `params.messageKey` is the i18n key of its message (written by the worker, 0049); the other params fill it in. A row without a known `messageKey` is skipped.
  - File link: `supabase.storage.from('org-files').createSignedUrl(storage_path, 300)`. Images (`image/*`) show inline as `<img>` (CSP allows the Supabase origin for images); a PDF gets one link that opens in a new tab (CSP forbids frames).
- `t`, `catalogs` and `type MessageKey` come from `@shoebox/i18n`; a string `k` is a key when `k in catalogs.en`. Date checks carry `params.field` like `issue_date`; when `proto.field.<field>` is a key, pass its translation as `field`.
- Existing labels in `en.json` to reuse: `proto.field.supplier_name` (Supplier), `proto.field.supplier_ico`, `proto.field.supplier_dic`, `proto.field.document_number`, `proto.field.variable_symbol`, `proto.field.issue_date`, `proto.field.due_date`, `proto.field.total_net`, `proto.field.total_vat`, `proto.field.total_gross`, `proto.field.account`, `proto.field.iban`. `StatusBadge`, `MoneyText`, `LegalDateText`, `Card` from `@shoebox/ui`.
- Inbox list rows (from 0047) in `apps/web/app/(app)/inbox/page.tsx`:

```tsx
                <span className="text-body text-foreground">
                  {row.title ?? t('inbox.row.unknown_supplier')}
                </span>
```

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/web/src/documents/detail-data.ts` | create | `detailOf` (pure) and `loadDocumentDetail` |
| `apps/web/test/detail-data.test.ts` | create | the test file below, verbatim |
| `apps/web/app/(app)/inbox/[id]/page.tsx` | create | the document page |
| `apps/web/app/(app)/inbox/page.tsx` | edit | the row title becomes a link |
| `packages/i18n/messages/en.json` | edit | the keys below |

No other file may change.

## 4. Steps

1. Add to `packages/i18n/messages/en.json` (keep the file's key order style; put them after the `inbox.*` keys):

```json
  "doc.detail.back": "Back to Inbox",
  "doc.detail.read_title": "What we read",
  "doc.detail.attention_title": "Needs your attention",
  "doc.detail.all_good": "Everything checks out. There is nothing for you to do.",
  "doc.detail.open_file": "Open the document",
  "doc.detail.preview_alt": "The uploaded document",
  "doc.detail.not_found": "We can't find this document.",
  "doc.detail.reading": "We're still reading this document. This page updates by itself.",
  "doc.detail.vat_line": "VAT {rate} %: base {base}, VAT {vat}",
  "doc.field.duzp": "Date of supply (DUZP)",
```

   Run `pnpm --filter @shoebox/i18n test 2>&1 | tail -30`. Expected: pass. Commit `0051 step 1`.
2. Create the test file below verbatim and `apps/web/src/documents/detail-data.ts`:

```ts
import type { DocumentClass, DocumentStatus, LegalDate } from '@shoebox/domain';
import type { MessageKey } from '@shoebox/i18n';
export interface DetailField { readonly label: MessageKey; readonly value: string; readonly kind: 'text' | 'date' | 'money' }
export interface DetailCheck { readonly severity: 'blocking' | 'warning'; readonly key: MessageKey; readonly params: Record<string, string | number> }
export interface DocumentDetail {
  readonly id: string; readonly status: DocumentStatus; readonly cls: DocumentClass;
  readonly title: string | null; readonly currency: string; readonly createdAt: string;
  readonly fields: readonly DetailField[];
  readonly vatLines: readonly { rate: string; base: string; vat: string }[];
  readonly checks: readonly DetailCheck[];     // blocking first, then warning
  readonly file: { readonly path: string; readonly mimeType: string; readonly name: string | null } | null;
}
export function detailOf(doc: unknown, vat: unknown, checks: unknown): DocumentDetail | null;
export function loadDocumentDetail(supabase: SupabaseLike, orgId: string, id: string): Promise<DocumentDetail | null>; // null on any error
```

   Field order and labels (only non-null values): supplier name `proto.field.supplier_name`, IČO `proto.field.supplier_ico`, DIČ `proto.field.supplier_dic`, document number `proto.field.document_number`, variable symbol `proto.field.variable_symbol`, issue date `proto.field.issue_date` (date), DUZP `doc.field.duzp` (date), due date `proto.field.due_date` (date), net `proto.field.total_net` (money), VAT `proto.field.total_vat` (money), gross `proto.field.total_gross` (money), account `proto.field.account` (`account/bank_code`), IBAN `proto.field.iban`. `SupabaseLike` is `Awaited<ReturnType<typeof createSupabaseServerClient>>`. `loadDocumentDetail` runs the three queries of §2 and calls `detailOf`. Run `pnpm --filter @shoebox/web exec vitest run test/detail-data.test.ts 2>&1 | tail -30`. Expected: pass. Commit `0051 step 2`.

```ts
import { describe, expect, it } from 'vitest';
import { detailOf } from '../src/documents/detail-data';

const doc = {
  id: '22222222-2222-4222-8222-222222222222',
  status: 'needs_review',
  class: 'received_invoice',
  currency: 'CZK',
  total_net: '100.00',
  total_vat: '30.00',
  total_gross: '130.00',
  issue_date: '2026-09-12',
  duzp: '2026-09-12',
  due_date: null,
  document_number: 'SYN-1',
  variable_symbol: null,
  partner_snapshot: { name: 'Synthetic s.r.o.', ico: '27082440', dic: null },
  pay_to_account: { account: '123', bank_code: '0100', iban: null },
  created_at: '2026-10-25T10:00:00Z',
  source_files: [{ storage_path: 'org/x/files/abc', mime_type: 'application/pdf', original_filename: 'f.pdf' }],
};

describe('detailOf', () => {
  it('lists what was read, in order, skipping empty values', () => {
    const detail = detailOf(doc, [{ vat_rate_pct: '21.00', base: '100.00', vat: '30.00' }], []);
    expect(detail?.title).toBe('Synthetic s.r.o.');
    expect(detail?.fields.map((f) => f.label)).toEqual([
      'proto.field.supplier_name',
      'proto.field.supplier_ico',
      'proto.field.document_number',
      'proto.field.issue_date',
      'doc.field.duzp',
      'proto.field.total_net',
      'proto.field.total_vat',
      'proto.field.total_gross',
      'proto.field.account',
    ]);
    expect(detail?.fields.find((f) => f.label === 'proto.field.account')?.value).toBe('123/0100');
    expect(detail?.fields.find((f) => f.label === 'proto.field.total_gross')).toEqual({
      label: 'proto.field.total_gross', value: '130.00', kind: 'money',
    });
    expect(detail?.vatLines).toEqual([{ rate: '21.00', base: '100.00', vat: '30.00' }]);
    expect(detail?.file).toEqual({ path: 'org/x/files/abc', mimeType: 'application/pdf', name: 'f.pdf' });
  });

  it('keeps checks with a known message key, blocking first, and translates the field param', () => {
    const detail = detailOf(doc, [], [
      { rule_id: 'PROTO_DIC_FORMAT', severity: 'warning', params: { messageKey: 'proto.check.dic_format.warn', dic: 'DE1' } },
      { rule_id: 'PROTO_X', severity: 'blocking', params: { messageKey: 'no.such.key' } },
      { rule_id: 'PROTO_VAT_RATE_MATH', severity: 'blocking', params: { messageKey: 'proto.check.vat_rate_math.fail', rate: '21', vat: '30.00', base: '100.00', expected: '21.00' } },
      { rule_id: 'PROTO_DATE_DUE', severity: 'blocking', params: { messageKey: 'proto.check.date.fail_invalid', field: 'due_date' } },
    ]);
    expect(detail?.checks.map((c) => c.key)).toEqual([
      'proto.check.vat_rate_math.fail',
      'proto.check.date.fail_invalid',
      'proto.check.dic_format.warn',
    ]);
    expect(detail?.checks[0]?.params).toEqual({ rate: '21', vat: '30.00', base: '100.00', expected: '21.00' });
    expect(detail?.checks[1]?.params.field).toBe('Due date');
  });

  it('returns null for a malformed document', () => {
    expect(detailOf(null, [], [])).toBeNull();
    expect(detailOf({ id: 3 }, [], [])).toBeNull();
  });
});
```

3. Create `apps/web/app/(app)/inbox/[id]/page.tsx` (server component, `async`; Next 15: `params: Promise<{ id: string }>`). Layout in `<div className="flex flex-col gap-6">`:
   - a link `t('doc.detail.back')` to `/inbox` (Next `Link`, `text-body underline`);
   - `<h1 className="text-title">` the title (or `t('inbox.row.unknown_supplier')`) and the `StatusBadge`;
   - while the status is one of the processing statuses (`PROCESSING_STATUSES` from `../../../../src/documents/inbox-data`): `<p className="text-body">{t('doc.detail.reading')}</p>` and `<AutoRefresh active />`;
   - otherwise a `Card` "What we read" (`text-card-title` heading) with a `<dl>`: each field label (`t(label)`) and value (`MoneyText` for money with the document currency, `LegalDateText` for dates, text otherwise), then each VAT line with `t('doc.detail.vat_line', { rate, base, vat })`;
   - a `Card` "Needs your attention" listing each check as `<li className="text-body">` with `t(key, params)`; blocking rows get the `Badge` tone that `StatusBadge` uses for needs_review (look in `packages/ui/src/components/status-badge.tsx`, read only, do not edit). With no checks and a non-processing status: `<p className="text-body">{t('doc.detail.all_good')}</p>` instead;
   - the file: signed URL via `createSignedUrl(path, 300)`; image → `<img src alt={t('doc.detail.preview_alt')} className="max-w-full rounded-control border border-border">`; PDF → one link `t('doc.detail.open_file')` with `target="_blank" rel="noopener noreferrer"`.
   - Not found or not allowed: `<p className="text-body">{t('doc.detail.not_found')}</p>` plus the back link.
   Run `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`. Commit `0051 step 3`.
4. Edit `apps/web/app/(app)/inbox/page.tsx`: wrap the quoted `<span>` content in `<Link href={\`/inbox/${row.id}\`} className="underline">…</Link>` (import `Link` from `next/link`). Run `pnpm exec biome check --write apps/web/src/documents apps/web/test/detail-data.test.ts "apps/web/app/(app)/inbox" 2>&1 | tail -5`, `pnpm exec biome ci apps/web packages/i18n 2>&1 | tail -10`, `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`, `pnpm --filter @shoebox/web check:i18n 2>&1 | tail -10` (if that script exists). Expected: clean. Commit `0051 step 4`.

## 5. Do not touch

`apps/web/src/auth/**`, `apps/web/e2e/**`, `packages/ui/**`, `packages/i18n/messages/cs.json`, `apps/web/src/documents/upload*.ts`, `inbox-data.ts`, `auto-refresh.tsx`. Hard rules 3, 6.

## 6. Commands

The commands of each step, each ending `2>&1 | tail -30`.

## 7. Acceptance

- [ ] The test file is unchanged (biome formatting aside) and passes; i18n test passes.
- [ ] No literal UI text in the `.tsx` files; no raw colors, no `text-sm`/`text-xs`/`text-muted-foreground`.
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

Write `docs/tasks/0051-report.md` (600 tokens at most) and set `Status: review`. The report has the files changed, each command with the last 5 lines of output, §7 ticked, deviations, questions, owner steps left.

## Risk list (for the reviewer)

`apps/web/app/(app)/inbox/[id]/page.tsx` (org scope, signed URL lifetime).

## Owner steps

None.
