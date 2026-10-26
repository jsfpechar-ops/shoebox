# 0337: EPO drift monitors (`ops.drift_monitors`) and the version-bump runbook

Status: todo
Ticket: P3-VAT-06 (part b) | Depends on: 0328, 0336 | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 20 tool calls, 50k tokens

## 1. Objective

A nightly system job that notices when the tax office bumps an EPO structure version or changes an XSD we vendored, and alerts the maintainer once per change, plus the runbook that says what to do then. Pure detection; the fetch is injected (no network in tests).

## 2. Context

06 §3 drift monitors (pasted): "EPO structure versions: fetch `adisspr.mfcr.cz/dpr/adis/idpr_pub/epo2_info/popis_struktury_seznam.faces`; parse the versions of DPHDP3, DPHKH1, DPHSHV, DPFDP7 → alert when the version differs from `epo.forms`." "XSD content hash: fetch each vendored XSD's `source_url`, sha256, compare with `manifest.sha256` → alert on change." 06 §7: `epo-version-bump.md`: vendor the new XSD, diff the attributes, update `epo.dphdp3_row_map`, regenerate golden XML, run property tests.

Facts: `epo.forms` (0328) = `{DPHDP3: {version:'03.01.04', source_url, …}, DPHKH1: {version:'03.01.15'}, DPHSHV: {version:'02.01.05'}}` read via `createCzRules().at(today).get('epo.forms')`. Manifests via `readManifest(form, version)` (0336). Popis versions look like `03.01.04` and sit near the structure code on the list page (exact markup unknown here: **[verify]** with a recorded page; the parser is tolerant: the first `\d{2}\.\d{2}\.\d{2}` within 400 characters after the code). Job names: `'ops'` is a registered family in `packages/pipeline/src/jobs.ts` (`JOB_FAMILIES`), so `'ops.drift_monitors'` is a valid `JobName`; define it with `defineSystemJob({ name: 'ops.drift_monitors', payload: z.strictObject({}), cron: '15 4 * * *', retry: { retryLimit: 0 } })` (M12 §4.2 style like `retentionTrashPurgeJob`). Registration pattern: `apps/worker/src/retention/trash-purge.ts` (`registerTrashPurge(registry, db, env, logger)`), wired in `apps/worker/src/main.ts`. Logger: `Pick<Logger, 'info' | 'warn'>` from `@shoebox/platform`; never log page content beyond the parsed version strings.

"Alert once": a finding is alerted when its key (`'version:DPHDP3:03.01.05'`, `'xsd:DPHDP3:<sha256>'`) was not alerted before; state is an injected `DriftState { get(): Promise<Set<string>>; set(keys: Set<string>): Promise<void> }` with an in-memory default (`// TODO(decision-drift-state): persist in a global table or Sentry fingerprinting`).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/pipeline/src/jobs.ts` | edit | append `opsDriftMonitorsJob` after `retentionTrashPurgeJob` |
| `apps/worker/src/jobs/ops/drift-monitors.ts` | create | pure parser/detector + handler + register |
| `apps/worker/src/main.ts` | edit | import + `registerDriftMonitors(registry, process.env, logger);` after the trash-purge line |
| `apps/worker/test/drift-monitors.test.ts` | create | below |
| `docs/runbooks/epo-version-bump.md` | create | ≤ 40 lines, numbered steps (below) |

## 4. Steps

1. jobs.ts: add the system job definition (§2). `pnpm --filter @shoebox/pipeline typecheck 2>&1 | tail -30`.
2. `drift-monitors.ts` exports exactly:
```ts
export const EPO_LIST_URL = 'https://adisspr.mfcr.cz/dpr/adis/idpr_pub/epo2_info/popis_struktury_seznam.faces';
export const MONITORED_FORMS = ['DPHDP3', 'DPHKH1', 'DPHSHV'] as const;
export type MonitoredForm = (typeof MONITORED_FORMS)[number];
export function parseEpoVersions(html: string): Partial<Record<MonitoredForm, string>>;   // tolerant, see §2; HTML entities and tags between code and version are ignored
export function sha256Hex(text: string): string;
export interface DriftFinding { readonly kind: 'version' | 'xsd' | 'fetch_failed'; readonly form: MonitoredForm; readonly expected: string | null; readonly observed: string | null; readonly key: string }
export interface DriftInputs { readonly expectedVersions: Record<MonitoredForm, string>; readonly listHtml: string | null; readonly manifests: Partial<Record<MonitoredForm, { readonly version: string; readonly sha256: string | null; readonly source_url: string }>>; readonly xsdBodies: Partial<Record<MonitoredForm, string | null>> }
export function detectDrift(inputs: DriftInputs): DriftFinding[];   // version differs → 'version'; manifest sha256 non-null and body hash differs → 'xsd'; listHtml null or a body null where a manifest sha256 exists → 'fetch_failed' (key 'fetch:<form>' or 'fetch:list')
export interface DriftState { get(): Promise<Set<string>>; set(keys: Set<string>): Promise<void> }
export function memoryDriftState(): DriftState;
export interface DriftDeps { readonly fetchText: (url: string) => Promise<string | null>; readonly logger: Pick<Logger, 'info' | 'warn'>; readonly state?: DriftState; readonly today?: () => LegalDate; readonly rules?: ReturnType<typeof createCzRules> }
export function createDriftMonitorsHandler(deps: DriftDeps): SystemHandler<Record<string, never>>;
export function registerDriftMonitors(registry: Pick<JobRegistry, 'registerSystem'>, env: Readonly<Record<string, string | undefined>>, logger: Pick<Logger, 'info' | 'warn'>): boolean;   // default fetchText: global fetch with a 15 s AbortController timeout, returns null on any failure; registers always (no secrets needed)
```
Handler: read `epo.forms` at today, manifests via `readManifest` (0336) for each form's version, fetch list + each XSD whose manifest has a `sha256`, `detectDrift`, then for each finding not in state → `logger.warn({ event: 'ops.drift', kind, form, expected, observed }, 'EPO drift detected')`; `fetch_failed` is logged with `warn` but never stored in state (retried next night); store the union of alerted keys; `logger.info({ findings: n, alerted: m }, 'ops.drift_monitors done')`.
3. main.ts wiring. `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30`.
4. Test file verbatim:
```ts
import { describe, expect, it, vi } from 'vitest';
import { createDriftMonitorsHandler, detectDrift, memoryDriftState, parseEpoVersions, sha256Hex } from '../src/jobs/ops/drift-monitors';

const ctx = { jobId: 'j', attempt: 1, signal: new AbortController().signal };
const LIST = `<table><tr><td><a href="detail?zkratka=DPHDP3">DPHDP3</a></td><td>Přiznání k DPH</td><td>03.01.05</td><td>11.08.2026</td></tr>
<tr><td>DPHKH1</td><td>Kontrolní hlášení</td><td>03.01.15</td></tr><tr><td>DPHSHV</td><td>Souhrnné hlášení</td><td>02.01.05</td></tr></table>`;
const EXPECTED = { DPHDP3: '03.01.04', DPHKH1: '03.01.15', DPHSHV: '02.01.05' };
const XSD_OLD = '<xs:schema old/>';

describe('parseEpoVersions / detectDrift', () => {
  it('reads the three versions from a recorded-style list page', () => {
    expect(parseEpoVersions(LIST)).toEqual({ DPHDP3: '03.01.05', DPHKH1: '03.01.15', DPHSHV: '02.01.05' });
    expect(parseEpoVersions('<html>nothing</html>')).toEqual({});
  });
  it('reports a version bump and an XSD hash change, and fetch failures separately', () => {
    const findings = detectDrift({ expectedVersions: EXPECTED, listHtml: LIST,
      manifests: { DPHDP3: { version: '03.01.04', sha256: sha256Hex(XSD_OLD), source_url: 'u1' }, DPHKH1: { version: '03.01.15', sha256: null, source_url: 'u2' }, DPHSHV: { version: '02.01.05', sha256: sha256Hex(XSD_OLD), source_url: 'u3' } },
      xsdBodies: { DPHDP3: '<xs:schema new/>', DPHSHV: null } });
    expect(findings.map((f) => [f.kind, f.form, f.expected, f.observed])).toEqual([
      ['version', 'DPHDP3', '03.01.04', '03.01.05'],
      ['xsd', 'DPHDP3', sha256Hex(XSD_OLD), sha256Hex('<xs:schema new/>')],
      ['fetch_failed', 'DPHSHV', sha256Hex(XSD_OLD), null],
    ]);
    expect(detectDrift({ expectedVersions: EXPECTED, listHtml: null, manifests: {}, xsdBodies: {} })).toEqual([{ kind: 'fetch_failed', form: 'DPHDP3', expected: null, observed: null, key: 'fetch:list' }]);
  });
});

describe('ops.drift_monitors handler', () => {
  it('alerts each change once across runs; fetch failures retry', async () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const state = memoryDriftState();
    const fetchText = vi.fn(async (url: string) => (url.includes('popis_struktury_seznam') ? LIST : null));
    const handler = createDriftMonitorsHandler({ fetchText, logger, state });
    await handler({}, ctx);
    const warned = () => logger.warn.mock.calls.map((c) => (c[0] as { kind: string; form: string }).kind + ':' + (c[0] as { form: string }).form);
    expect(warned()).toContain('version:DPHDP3');
    const first = logger.warn.mock.calls.length;
    await handler({}, ctx);
    // the version alert is not repeated; fetch_failed (if any manifest has a sha256) is
    expect(warned().slice(first).filter((w) => w.startsWith('version:'))).toEqual([]);
    expect(logger.info).toHaveBeenLastCalledWith(expect.objectContaining({ findings: expect.any(Number) }), 'ops.drift_monitors done');
  });
});
```
Command: `pnpm --filter @shoebox/worker test -- drift-monitors 2>&1 | tail -30`.
5. Runbook `docs/runbooks/epo-version-bump.md`:
```
# EPO version bump (DPHDP3 / DPHKH1 / DPHSHV)
Trigger: `ops.drift_monitors` warned `EPO drift detected`, or the yearly January check.
1. Open the structure list (EPO_LIST_URL) and the detail page `popis_struktury_detail.faces?zkratka=<CODE>`; note the new version and date.
2. Download the new XSD set (main file + includes) into `packages/tax-xml/xsd/<FORM>/<new version>/`; write `manifest.json` (sha256sum of the main file, fetched_at, valid_for_periods_from = first period the new structure applies to).
3. Diff attributes against the previous version (`diff <(grep -o 'name="[^"]*"' old.xsd | sort) <(… new.xsd …)`); for each changed attribute update `packages/domain/src/rules/cz/epo.ts` (`CZ_DPHDP3_ROW_MAP`, `CZ_DPHDP3_DERIVED_ROWS`) and `packages/tax-xml/src/forms.ts`.
4. Add the new version to `epo.forms` in `packages/domain/src/rules/cz/<year>.ts` as a new segment (never edit the old one).
5. Regenerate golden XML (`testdata/golden-v1/expected/vat/`) only if attributes changed; review the diff by hand against the filed return.
6. Run: `pnpm --filter @shoebox/tax-xml test`, `pnpm --filter @shoebox/domain test -- kh-dp3 dphdp3 epo-rows rules`, `pnpm eval --quick`.
7. PR with the drift finding, the version page link and the hash; owner merges; `[verify]` items in 22 T-02 updated.
```
6. Commit `feat(worker): EPO drift monitors + runbook (0337)`.

## 5. Do not touch

`packages/tax-xml` (import only), db, `apps/worker/src/worker.ts`.

## 6. Commands

`pnpm --filter @shoebox/pipeline typecheck 2>&1 | tail -30` · `pnpm --filter @shoebox/worker test -- drift-monitors 2>&1 | tail -30` · `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30`

## 7. Acceptance

- [ ] Tests green, worker typecheck clean, `main.ts` registers the job, runbook present.
- [ ] Report: `[verify]` the real list-page markup (parser tolerance), alert channel (log only; Sentry/notification is `TODO(decision-drift-state)`).

## 8. Stop and ask

TEMPLATE §8; if `'ops.drift_monitors'` fails `checkName`, report (do not edit `JOB_FAMILIES`).

## 9. Report

`docs/tasks/0337-report.md`.

## Risk list

`drift-monitors.ts` (outbound fetch; no payload beyond URLs).

## Owner steps

1. Decisions line: "2026-10-26 ops.drift_monitors runs nightly 04:15 (log alert; persisted dedupe TODO)".
