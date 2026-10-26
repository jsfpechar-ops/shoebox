# 0321: P1-CAT-04e API routes: answer a review question, edit a line's classification

Status: todo
Ticket: P1-CAT-04 | Depends on: 0317 (job definition), 0318 (payload contract) | Base commit: lane branch head | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 25 tool calls, 50k tokens

## 1. Objective

Two thin `/api` routes (M04 §6.4) that write the user's decision under RLS and re-queue `doc.categorize` so the worker applies it (0318/0320): `POST /api/review-questions/{id}/answer` (owner, member, accountant; viewer 403) and `PATCH /api/documents/{id}/lines/{lineId}/classification` (owner, member). The response is `202 {documentId, status:'queued'}`; the new `summary_cs` arrives through the detail's auto-refresh (the deviation from "returns the new summary_cs" in the backlog is recorded in the report: the categorize stage is a job, not a request).

## 2. Context

- Pattern: `apps/web/app/api/documents/route.ts` (origin check, `requireActiveRole`, `createSupabaseServerClient`), `apps/web/src/documents/correction-store.ts` (supabase writes with `.eq('org_id', …)`, `document_fields` insert with `is_current`), `apps/web/src/documents/enqueue.ts` (`boss()`, `jobKey`, `jobIdFromKey`).
- Next.js route handlers with dynamic segments: `export async function POST(request: Request, { params }: { params: Promise<{ id: string }> })` → `const { id } = await params;` (App Router 15+; check an existing dynamic route under `apps/web/app` with `grep -rn "params" apps/web/app --include=route.ts | head -3`; if none exists, use this form).
- Review-deck contract (0318 §2): `payload.options[].value`; the answer stored is `{"value": "<option value>"}`; `answered_by = userId`, `answered_at = now()`. An already-answered question → 409. A value outside the options → 400. Lane D's deck may also write answers directly; both paths end in the same `doc.categorize` run, so the route must be safe to call twice (second call 409, no second enqueue).
- RLS: `review_questions` has the tenant write policy for owner/member plus `review_questions_accountant_update` (answer columns only). `document_fields` has the tenant write policy. The web writes run under the user's session, so a cross-org id simply matches no row → 404.
- Line edit body (M04 §6.4): `{category_code?, vat_treatment?, business_share_pct?, remember?: 'this'|'vendor'|'always'}`. Writes one `document_fields` row per given key with `source='user'`, `set_by=userId`, `is_current=true`, after flipping the current rows of that key to `is_current=false`: keys `lines[{position}].category_code`, `lines[{position}].business_share_pct`, `lines[{position}].vat_treatment` (position looked up from `document_lines` by `lineId`). `vat_treatment` edits are stored but the worker's derivation wins unless lane B's override check exists (TODO(cat-04-vat-override)); `remember` is stored as `document_fields` key `lines[{position}].remember` (`value_text` = remember) for 0322's learning step. Validation: `category_code` ∈ `CATEGORY_CODES` (`@shoebox/domain`); `business_share_pct` an integer string 0–100; `vat_treatment` ∈ `VAT_TREATMENT_VALUES`; at least one key present.
- Enqueue: `enqueueDocCategorize(orgId, documentId, revision, trigger, nonce)` with `trigger 'question_answered'` (answer) or `'user_reprocess'` (line edit), `nonce = Date.now()`; `revision` read from `documents.revision`. Finalized documents (`status = 'finalized'`) → 409 `{error: 'finalized'}` (edit-impact flow is LEDG-03 later).

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/web/src/documents/classification.ts` | create | pure parsers + the two store functions |
| `apps/web/src/documents/enqueue.ts` | edit | `enqueueDocCategorize` |
| `apps/web/app/api/review-questions/[id]/answer/route.ts` | create | POST |
| `apps/web/app/api/documents/[id]/lines/[lineId]/classification/route.ts` | create | PATCH |
| `apps/web/test/classification.test.ts` | create | the test below, verbatim |

## 4. Steps

1. Create `apps/web/src/documents/classification.ts` exporting exactly:
```ts
import type { createSupabaseServerClient } from '../supabase/server';
type SupabaseLike = Awaited<ReturnType<typeof createSupabaseServerClient>>;
export interface AnswerBody { readonly value: string; }
export function parseAnswerBody(json: unknown): AnswerBody | null;                 // {value: non-empty string ≤ 120 chars}
export interface ClassificationPatch { readonly categoryCode?: string; readonly vatTreatment?: string; readonly businessSharePct?: string; readonly remember?: 'this' | 'vendor' | 'always'; }
export function parseClassificationPatch(json: unknown): ClassificationPatch | null;  // snake_case body → camelCase; null when empty or invalid
export type StoreResult = { ok: true; documentId: string; revision: number } | { ok: false; status: 400 | 404 | 409; error: string };
/** Answers one question: loads it (org-scoped), checks it is unanswered and the value is one of its options, writes answer/answered_by/answered_at. */
export async function storeAnswer(supabase: SupabaseLike, input: { orgId: string; userId: string; questionId: string; value: string }): Promise<StoreResult>;
/** Writes the user fields of one line (see §2) after checking the document is not finalized and the line belongs to it. */
export async function storeClassificationPatch(supabase: SupabaseLike, input: { orgId: string; userId: string; documentId: string; lineId: string; patch: ClassificationPatch }): Promise<StoreResult>;
```
   `storeAnswer` reads `review_questions` columns `id, org_id, document_id, payload, answer` with `.eq('org_id', orgId)`; a question without `document_id` (transaction question, M07) → 400 `'no_document'`. Then reads `documents.revision, status` for the document.
   Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` → 0 errors.

2. Edit `apps/web/src/documents/enqueue.ts`: extend the import to `import { type CategorizeTrigger, docCategorizeJob, docExtractJob, jobIdFromKey, jobKey } from '@shoebox/pipeline';` and append:
```ts
/** Queues `doc.categorize` for a user action; `nonce` keeps two quick answers from collapsing into one job. */
export async function enqueueDocCategorize(orgId: string, documentId: string, revision: number, trigger: CategorizeTrigger, nonce: number = Date.now()): Promise<void> {
  const payload = docCategorizeJob.payload.parse({ orgId, documentId, revision, trigger, nonce });
  const key = jobKey(docCategorizeJob, payload);
  await (await boss()).send(docCategorizeJob.name, payload, { id: jobIdFromKey(key), singletonKey: key });
}
```

3. Create `apps/web/app/api/review-questions/[id]/answer/route.ts`:
```ts
import { requireActiveRole } from '../../../../../src/auth/org-context';
import { parseAnswerBody, storeAnswer } from '../../../../../src/documents/classification';
import { enqueueDocCategorize } from '../../../../../src/documents/enqueue';
import { appOrigin, createSupabaseServerClient } from '../../../../../src/supabase/server';
export const runtime = 'nodejs';
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (request.headers.get('origin') !== appOrigin()) return Response.json({ error: 'origin' }, { status: 403 });
  const auth = await requireActiveRole(['owner', 'member', 'accountant']);
  if (!auth.ok) return Response.json({ error: auth.code }, { status: auth.code === 'unauthenticated' ? 401 : 403 });
  const body = parseAnswerBody(await request.json().catch(() => null));
  if (body === null) return Response.json({ error: 'body' }, { status: 400 });
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const result = await storeAnswer(supabase, { orgId: auth.orgId, userId: auth.userId, questionId: id, value: body.value });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  await enqueueDocCategorize(auth.orgId, result.documentId, result.revision, 'question_answered');
  return Response.json({ documentId: result.documentId, status: 'queued' }, { status: 202 });
}
```
   Fix the relative import depth to the real one (count the directories). Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` → 0 errors.

4. Create `apps/web/app/api/documents/[id]/lines/[lineId]/classification/route.ts` with `PATCH`, roles `['owner', 'member']`, `parseClassificationPatch`, `storeClassificationPatch({…, documentId: id, lineId})`, trigger `'user_reprocess'`, same responses. Command: typecheck → 0 errors.

5. Create `apps/web/test/classification.test.ts` verbatim; implement until it passes, do not edit it:
```ts
import { describe, expect, it } from 'vitest';
import { parseAnswerBody, parseClassificationPatch, storeAnswer } from '../src/documents/classification';

describe('parsers', () => {
  it('answer body', () => {
    expect(parseAnswerBody({ value: 'personal' })).toEqual({ value: 'personal' });
    expect(parseAnswerBody({ value: '' })).toBeNull();
    expect(parseAnswerBody({ value: 'x'.repeat(121) })).toBeNull();
    expect(parseAnswerBody('personal')).toBeNull();
  });
  it('classification patch', () => {
    expect(parseClassificationPatch({ category_code: 'exp_cleaning', business_share_pct: '80', remember: 'vendor' })).toEqual({ categoryCode: 'exp_cleaning', businessSharePct: '80', remember: 'vendor' });
    expect(parseClassificationPatch({ vat_treatment: 'rcv_domestic_no_vat' })).toEqual({ vatTreatment: 'rcv_domestic_no_vat' });
    expect(parseClassificationPatch({})).toBeNull();
    expect(parseClassificationPatch({ category_code: 'nope' })).toBeNull();
    expect(parseClassificationPatch({ business_share_pct: '101' })).toBeNull();
    expect(parseClassificationPatch({ business_share_pct: '80.5' })).toBeNull();
    expect(parseClassificationPatch({ remember: 'forever' })).toBeNull();
  });
});

type Row = Record<string, unknown>;
/** A tiny PostgREST stand-in: `tables[name]` rows; supports select/eq/is/maybeSingle/update/insert as the store uses them. */
function fakeSupabase(tables: Record<string, Row[]>) {
  const writes: Array<{ table: string; op: 'update' | 'insert'; values: unknown; filters: Row }> = [];
  function from(table: string) {
    const filters: Row = {};
    const rows = () => (tables[table] ?? []).filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (k: string, v: unknown) => { filters[k] = v; return chain; },
      is: (k: string, v: unknown) => { filters[k] = v; return chain; },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => void) => resolve({ data: rows(), error: null }),
      update: (values: Row) => { writes.push({ table, op: 'update', values, filters }); for (const r of rows()) Object.assign(r, values); return chain; },
      insert: (values: unknown) => { writes.push({ table, op: 'insert', values, filters: { ...filters } }); return { select: () => chain, then: (resolve: (v: unknown) => void) => resolve({ data: null, error: null }) }; },
    };
    return chain;
  }
  return { client: { from } as never, writes };
}
const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '44444444-4444-4444-8444-444444444444';
const DOC = '22222222-2222-4222-8222-222222222222';
const Q = '55555555-5555-4555-8555-555555555555';

describe('storeAnswer', () => {
  const question = () => ({ id: Q, org_id: ORG, document_id: DOC, answer: null, payload: { question: 'categorize.question.business_or_personal', options: [{ value: 'business', label: 'a' }, { value: 'personal', label: 'b' }] } });
  it('writes the answer and returns the document revision', async () => {
    const fake = fakeSupabase({ review_questions: [question()], documents: [{ id: DOC, org_id: ORG, revision: 3, status: 'needs_review' }] });
    const r = await storeAnswer(fake.client, { orgId: ORG, userId: USER, questionId: Q, value: 'personal' });
    expect(r).toEqual({ ok: true, documentId: DOC, revision: 3 });
    const update = fake.writes.find((w) => w.table === 'review_questions' && w.op === 'update');
    expect(update?.values).toMatchObject({ answer: { value: 'personal' }, answered_by: USER });
    expect((update?.values as Row).answered_at).toBeTruthy();
    expect(update?.filters).toMatchObject({ id: Q, org_id: ORG });
  });
  it('404 for another org, 409 when already answered, 400 for a value outside the options', async () => {
    expect(await storeAnswer(fakeSupabase({ review_questions: [{ ...question(), org_id: 'other' }] }).client, { orgId: ORG, userId: USER, questionId: Q, value: 'personal' })).toMatchObject({ ok: false, status: 404 });
    expect(await storeAnswer(fakeSupabase({ review_questions: [{ ...question(), answer: { value: 'business' } }] }).client, { orgId: ORG, userId: USER, questionId: Q, value: 'personal' })).toMatchObject({ ok: false, status: 409 });
    expect(await storeAnswer(fakeSupabase({ review_questions: [question()] }).client, { orgId: ORG, userId: USER, questionId: Q, value: 'maybe' })).toMatchObject({ ok: false, status: 400 });
  });
});
```
   Command: `pnpm --filter @shoebox/web test -- classification 2>&1 | tail -30` → all pass.

## 5. Do not touch

Screens and components (lane D), `correction*.ts`, `packages/*`. Hard rules 3 (every query carries `.eq('org_id', orgId)`), 8.

## 6. Commands

`pnpm --filter @shoebox/web test -- classification 2>&1 | tail -30`; `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`.

## 7. Acceptance

- [ ] Tests pass; typecheck clean. - [ ] Viewer gets 403 on both routes, accountant 403 on PATCH (role arrays as in §4). - [ ] Finalized document → 409.

## 8. Stop and ask

Per TEMPLATE §8. If the supabase client's typed `from()` rejects the fake in the test (type error only), cast in the store with a local `SupabaseLike` type exactly as `correction-store.ts` does; never change the test.

## 9. Report

`docs/tasks/0321-report.md`. Note for lane D: the deck can call `POST /api/review-questions/{id}/answer` instead of writing `review_questions` itself; if it keeps writing directly, it must also call `enqueueDocCategorize(orgId, documentId, revision, 'question_answered')`.

## Risk list

`classification.ts` (org scoping, finalized guard), both routes (roles).

## Owner steps

None.
