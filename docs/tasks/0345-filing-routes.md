# 0345: Filing API routes: read, download (409 on stale), mark filed

Status: todo
Ticket: P3-VAT-09 (part c) | Depends on: 0343 (tables + helpers), 0344 (totals shape) | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 25 tool calls, 55k tokens

## 1. Objective

`GET /api/v1/filings/{id}`, `GET /api/v1/filings/{id}/download?format=xml|zip`, `POST /api/v1/filings/{id}/mark-filed`: the user gets the XML only while the period is unchanged and the filing is XSD-valid, and tells us "Mám podáno" with a date. Pure decision helpers carry the logic and the tests; routes stay thin. No screen (lane D).

## 2. Context

M05 §6 routes (pasted): `GET /filings/{id}` · `GET /filings/{id}/download?format=xml|pdf|xlsx|zip` (re-runs classifier; 409 `period_changed` if no longer simple or ledger hash changed) · `POST /filings/{id}/mark-filed {filedOn, submissionRef?}`. Roles: owner/member write; accountant read + workbook + download; viewer read. M05 §4.11: download moves `generated → downloaded` (first download); mark filed allowed from `generated|downloaded`, sets `marked_filed_at`, `filed_on`, `submission_ref`, obligation → `done`; `opravne` → the amended filing `superseded`. §4.8: XSD-invalid or unvalidated → **no XML download for users** (`vat.filing.error.xsd`). Audit actions `filing.downloaded`, `filing.marked_filed` (log lines for now: the web app has no audit helper; `TODO(audit)`). Owner MFA (`aal2`) for download: `TODO(decision-mfa)`, not enforced here.

Web conventions: routes under `apps/web/app/api/...` use `requireActiveRole([...])` (`src/auth/org-context.ts`, returns `{ ok, orgId, role, code }`) and the Supabase server client (`createSupabaseServerClient()`; queries run under the user's RLS); Storage: `supabase.storage.from('org-files').download(path)`; ZIP: `createZip(entries, at)` from `@shoebox/exports`. Example: `apps/web/app/api/export/route.ts`. Tests in `apps/web/test` cover pure helpers only (no HTTP harness): put all decisions into `apps/web/src/vat/filings.ts`.

"Re-runs classifier": the web cannot run the worker's classifier; the ledger hash check (`ledgerHashOf` from `@shoebox/db`, computed from `vat_ledger_entries (document_id, build_version)` of the filing's period) is the staleness test; a changed ledger has already re-run `vat.period.evaluate` (0344). Record this reading in the report.

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/web/src/vat/filings.ts` | create | pure helpers + Supabase loaders |
| `apps/web/app/api/v1/filings/[id]/route.ts` | create | GET |
| `apps/web/app/api/v1/filings/[id]/download/route.ts` | create | GET |
| `apps/web/app/api/v1/filings/[id]/mark-filed/route.ts` | create | POST |
| `apps/web/test/vat-filings.test.ts` | create | below |

## 4. Steps

1. `filings.ts` exports exactly:
```ts
export interface FilingView { readonly id: string; readonly type: string; readonly kind: string; readonly origin: string; readonly periodStart: string; readonly periodEnd: string; readonly state: string; readonly bundleId: string | null; readonly xsdValid: boolean | null; readonly totals: Record<string, unknown>; readonly simpleCheck: Record<string, unknown>; readonly xmlPath: string | null; readonly filedOn: string | null; readonly submissionRef: string | null; readonly generatedAt: string | null }
export type DownloadDecision = { readonly ok: true; readonly paths: readonly { path: string; name: string }[]; readonly markDownloaded: boolean } | { readonly ok: false; readonly status: 404 | 409 | 403 | 400; readonly error: 'not_found' | 'period_changed' | 'xsd_invalid' | 'not_generated' | 'bad_format' };
export function decideDownload(filing: FilingView | null, bundle: readonly FilingView[], currentLedgerHash: string, format: string | null): DownloadDecision;
export type MarkFiledDecision = { readonly ok: true; readonly filedOn: string; readonly submissionRef: string | null; readonly supersedeFilingId: string | null } | { readonly ok: false; readonly status: 400 | 404 | 409; readonly error: 'bad_body' | 'not_found' | 'wrong_state' };
export function decideMarkFiled(filing: FilingView | null, body: unknown, today: string, amendsFilingId: string | null): MarkFiledDecision;
export function xmlFileName(f: Pick<FilingView, 'type' | 'periodStart' | 'kind'>): string;   // 'DPHDP3-2026-08-radne.xml'
export const FILING_WRITE_ROLES: readonly MemberRole[]; export const FILING_READ_ROLES: readonly MemberRole[]; export const FILING_DOWNLOAD_ROLES: readonly MemberRole[];   // owner,member · +accountant,viewer · owner,member,accountant
export async function loadFiling(supabase: SupabaseClient, orgId: string, id: string): Promise<FilingView | null>;
export async function loadBundle(supabase: SupabaseClient, orgId: string, bundleId: string): Promise<FilingView[]>;
export async function currentLedgerHash(supabase: SupabaseClient, orgId: string, periodStart: string): Promise<string>;   // select document_id, build_version from vat_ledger_entries where period_start = … → ledgerHashOf
export async function applyMarkFiled(supabase: SupabaseClient, orgId: string, filing: FilingView, d: Extract<MarkFiledDecision, { ok: true }>, now: Date): Promise<void>;   // update filings (state, marked_filed_at, filed_on, submission_ref); supersede amended; update obligations state='done', done_at, done_source='filing' where kind matches type (DPHDP3→vat_return, DPHKH1→kh, DPHSHV→sh) and period_start
```
Rules: `decideDownload`: null → 404; `format` not `xml`/`zip` → 400 `bad_format`; state not in (`generated`,`downloaded`,`marked_filed`) → 409 `not_generated`; `xsdValid !== true` → 403 `xsd_invalid`; `totals.ledgerHash !== currentLedgerHash` and state ≠ `marked_filed` → 409 `period_changed`; `xml` → the one file; `zip` → every filing of the bundle in state ≥ generated (sorted DPHDP3, DPHKH1, DPHSHV); `markDownloaded = state === 'generated'`. `decideMarkFiled`: body must be `{ filedOn: 'YYYY-MM-DD' (≤ today, ≥ periodEnd), submissionRef?: string ≤ 60 }`; state must be `generated|downloaded`; `supersedeFilingId = kind === 'opravne' ? amendsFilingId : null`.
2. Routes: GET filing → `FILING_READ_ROLES`, 200 `FilingView` (never `xml_path` to viewers: strip `xmlPath`). Download → `FILING_DOWNLOAD_ROLES`; on ok: fetch each path from Storage; `xml` → `Content-Type: application/xml; charset=utf-8`, `Content-Disposition: attachment; filename="<xmlFileName>"`; `zip` → `application/zip`, name `DPH-<periodStart>.zip`; then `update filings set state='downloaded'` when `markDownloaded`; log `filing.downloaded`. Mark filed → `FILING_WRITE_ROLES`, JSON body, `applyMarkFiled`, 200 `{ state: 'marked_filed' }`; log `filing.marked_filed`.
3. Test file verbatim:
```ts
import { describe, expect, it } from 'vitest';
import { decideDownload, decideMarkFiled, type FilingView, xmlFileName } from '../src/vat/filings';

const f = (o: Partial<FilingView> = {}): FilingView => ({ id: 'f1', type: 'DPHDP3', kind: 'radne', origin: 'generated', periodStart: '2026-08-01', periodEnd: '2026-08-31', state: 'generated', bundleId: 'b1', xsdValid: true, totals: { ledgerHash: 'h1' }, simpleCheck: {}, xmlPath: 'org/o/filings/b1/DPHDP3.xml', filedOn: null, submissionRef: null, generatedAt: '2026-09-20T10:00:00Z', ...o });

describe('decideDownload (M05 §9 #13)', () => {
  it('xml of a generated, valid, unchanged filing; marks downloaded once', () => {
    expect(decideDownload(f(), [f()], 'h1', 'xml')).toEqual({ ok: true, paths: [{ path: 'org/o/filings/b1/DPHDP3.xml', name: 'DPHDP3-2026-08-radne.xml' }], markDownloaded: true });
    expect(decideDownload(f({ state: 'downloaded' }), [f()], 'h1', 'xml')).toMatchObject({ ok: true, markDownloaded: false });
  });
  it('stale ledger → 409 period_changed; a filed one still downloads', () => {
    expect(decideDownload(f(), [f()], 'h2', 'xml')).toEqual({ ok: false, status: 409, error: 'period_changed' });
    expect(decideDownload(f({ state: 'marked_filed' }), [f()], 'h2', 'xml')).toMatchObject({ ok: true });
  });
  it('draft / invalid / bad format / missing', () => {
    expect(decideDownload(f({ state: 'draft', xsdValid: null }), [], 'h1', 'xml')).toMatchObject({ ok: false, status: 409, error: 'not_generated' });
    expect(decideDownload(f({ xsdValid: false }), [], 'h1', 'xml')).toMatchObject({ ok: false, status: 403, error: 'xsd_invalid' });
    expect(decideDownload(f({ xsdValid: null }), [], 'h1', 'xml')).toMatchObject({ ok: false, status: 403, error: 'xsd_invalid' });
    expect(decideDownload(f(), [], 'h1', 'pdf')).toMatchObject({ ok: false, status: 400 });
    expect(decideDownload(null, [], 'h1', 'xml')).toMatchObject({ ok: false, status: 404 });
  });
  it('zip bundles DP3, KH, SH in order and skips drafts', () => {
    const kh = f({ id: 'f2', type: 'DPHKH1', xmlPath: 'org/o/filings/b1/DPHKH1.xml' });
    const sh = f({ id: 'f3', type: 'DPHSHV', xmlPath: 'org/o/filings/b1/DPHSHV.xml', state: 'draft' });
    const d = decideDownload(kh, [sh, kh, f()], 'h1', 'zip');
    expect(d.ok && d.paths.map((p) => p.name)).toEqual(['DPHDP3-2026-08-radne.xml', 'DPHKH1-2026-08-radne.xml']);
  });
});

describe('decideMarkFiled', () => {
  it('valid body from generated; opravne supersedes the amended filing', () => {
    expect(decideMarkFiled(f(), { filedOn: '2026-09-20', submissionRef: ' 1234567/26 ' }, '2026-09-21', null)).toEqual({ ok: true, filedOn: '2026-09-20', submissionRef: '1234567/26', supersedeFilingId: null });
    expect(decideMarkFiled(f({ kind: 'opravne', state: 'downloaded' }), { filedOn: '2026-09-21' }, '2026-09-21', 'f0')).toMatchObject({ ok: true, supersedeFilingId: 'f0' });
  });
  it('rejects future dates, dates before the period end, long refs, wrong states', () => {
    expect(decideMarkFiled(f(), { filedOn: '2026-09-22' }, '2026-09-21', null)).toMatchObject({ ok: false, status: 400 });
    expect(decideMarkFiled(f(), { filedOn: '2026-08-15' }, '2026-09-21', null)).toMatchObject({ ok: false, status: 400 });
    expect(decideMarkFiled(f(), { filedOn: '2026-09-20', submissionRef: 'x'.repeat(61) }, '2026-09-21', null)).toMatchObject({ ok: false, status: 400 });
    expect(decideMarkFiled(f({ state: 'draft' }), { filedOn: '2026-09-20' }, '2026-09-21', null)).toMatchObject({ ok: false, status: 409, error: 'wrong_state' });
    expect(decideMarkFiled(f({ state: 'marked_filed' }), { filedOn: '2026-09-20' }, '2026-09-21', null)).toMatchObject({ ok: false, status: 409 });
    expect(decideMarkFiled(null, {}, '2026-09-21', null)).toMatchObject({ ok: false, status: 404 });
  });
  it('xmlFileName', () => expect(xmlFileName({ type: 'DPHKH1', periodStart: '2026-07-01', kind: 'nasledne' })).toBe('DPHKH1-2026-07-nasledne.xml'));
});
```
Command: `pnpm --filter @shoebox/web test -- vat-filings 2>&1 | tail -30`; `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`.
4. Commit `feat(web): filing read/download/mark-filed routes (0345)`.

## 5. Do not touch

Screens/components, `packages/*`, other routes. Never return `xsd_errors` to non-owners.

## 6. Commands

`pnpm --filter @shoebox/web test -- vat-filings 2>&1 | tail -30` · `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`

## 7. Acceptance

- [ ] Tests green; typecheck clean; routes compile with `runtime = 'nodejs'`.
- [ ] Report: reading of "re-runs classifier" (hash check), `TODO(decision-mfa)`, `TODO(audit)`.

## 8. Stop and ask

TEMPLATE §8.

## 9. Report

`docs/tasks/0345-report.md`.

## Risk list

Download route (what leaves the system), `applyMarkFiled`.

## Owner steps

1. Lane D follow-up: filing cards, preview sheet, download guide (`vat.submit.steps.*` with `verified_at`), mark-filed dialog, disclaimers (P3-VAT-12 screen part).
