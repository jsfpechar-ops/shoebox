// ops.drift_monitors (06 §3): nightly check that the tax office has not bumped an EPO structure
// version or changed a vendored XSD. Detection only: findings are logged as warnings, once per key.
import { createHash } from 'node:crypto';
import { type CZ_EPO_FORMS, createCzRules, type LegalDate, pragueToday } from '@shoebox/domain';
import { opsDriftMonitorsJob } from '@shoebox/pipeline';
import type { Logger } from '@shoebox/platform';
import { readManifest } from '@shoebox/tax-xml';
import type { JobRegistry, SystemHandler } from '../../registry';

export const EPO_LIST_URL =
  'https://adisspr.mfcr.cz/dpr/adis/idpr_pub/epo2_info/popis_struktury_seznam.faces';
export const MONITORED_FORMS = ['DPHDP3', 'DPHKH1', 'DPHSHV'] as const;
export type MonitoredForm = (typeof MONITORED_FORMS)[number];

const VERSION = /(?<!\d)\d{2}\.\d{2}\.\d{2}(?!\d)/;
const VERSION_WINDOW = 400;
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Reads the structure version of each monitored form from the list page: the first version-like
 * string within 400 characters after an occurrence of the form code. Tags and entities are skipped.
 * [verify] the real list-page markup against a recorded page.
 */
export function parseEpoVersions(html: string): Partial<Record<MonitoredForm, string>> {
  const out: Partial<Record<MonitoredForm, string>> = {};
  for (const form of MONITORED_FORMS) {
    let at = html.indexOf(form);
    while (at >= 0) {
      const from = at + form.length;
      const match = VERSION.exec(html.slice(from, from + VERSION_WINDOW));
      if (match) {
        out[form] = match[0];
        break;
      }
      at = html.indexOf(form, from);
    }
  }
  return out;
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export interface DriftFinding {
  readonly kind: 'version' | 'xsd' | 'fetch_failed';
  readonly form: MonitoredForm;
  readonly expected: string | null;
  readonly observed: string | null;
  readonly key: string;
}

export interface DriftInputs {
  readonly expectedVersions: Record<MonitoredForm, string>;
  readonly listHtml: string | null;
  readonly manifests: Partial<
    Record<
      MonitoredForm,
      { readonly version: string; readonly sha256: string | null; readonly source_url: string }
    >
  >;
  readonly xsdBodies: Partial<Record<MonitoredForm, string | null>>;
}

export function detectDrift(inputs: DriftInputs): DriftFinding[] {
  const findings: DriftFinding[] = [];
  if (inputs.listHtml === null) {
    findings.push({
      kind: 'fetch_failed',
      form: MONITORED_FORMS[0],
      expected: null,
      observed: null,
      key: 'fetch:list',
    });
  }
  const observed = inputs.listHtml === null ? {} : parseEpoVersions(inputs.listHtml);
  for (const form of MONITORED_FORMS) {
    const expected = inputs.expectedVersions[form];
    const seen = observed[form];
    if (seen !== undefined && seen !== expected) {
      findings.push({
        kind: 'version',
        form,
        expected,
        observed: seen,
        key: `version:${form}:${seen}`,
      });
    }
    const manifest = inputs.manifests[form];
    if (!manifest || manifest.sha256 === null) continue;
    const body = inputs.xsdBodies[form];
    if (body === null || body === undefined) {
      findings.push({
        kind: 'fetch_failed',
        form,
        expected: manifest.sha256,
        observed: null,
        key: `fetch:${form}`,
      });
      continue;
    }
    const hash = sha256Hex(body);
    if (hash !== manifest.sha256) {
      findings.push({
        kind: 'xsd',
        form,
        expected: manifest.sha256,
        observed: hash,
        key: `xsd:${form}:${hash}`,
      });
    }
  }
  return findings;
}

export interface DriftState {
  get(): Promise<Set<string>>;
  set(keys: Set<string>): Promise<void>;
}

// TODO(decision-drift-state): persist in a global table or Sentry fingerprinting.
export function memoryDriftState(): DriftState {
  let keys = new Set<string>();
  return {
    async get() {
      return new Set(keys);
    },
    async set(next) {
      keys = new Set(next);
    },
  };
}

export interface DriftDeps {
  readonly fetchText: (url: string) => Promise<string | null>;
  readonly logger: Pick<Logger, 'info' | 'warn'>;
  readonly state?: DriftState;
  readonly today?: () => LegalDate;
  readonly rules?: ReturnType<typeof createCzRules>;
}

export function createDriftMonitorsHandler(deps: DriftDeps): SystemHandler<Record<string, never>> {
  const state = deps.state ?? memoryDriftState();
  const rules = deps.rules ?? createCzRules();
  const today = deps.today ?? (() => pragueToday({ now: () => Date.now() }));
  return async () => {
    const forms = rules.at(today()).get('epo.forms') as typeof CZ_EPO_FORMS;
    const expectedVersions = {} as Record<MonitoredForm, string>;
    const manifests: DriftInputs['manifests'] = {};
    for (const form of MONITORED_FORMS) {
      const version = forms[form].version;
      expectedVersions[form] = version;
      const manifest = readManifest(form, version);
      if (manifest) manifests[form] = manifest;
    }
    const listHtml = await deps.fetchText(EPO_LIST_URL);
    const xsdBodies: DriftInputs['xsdBodies'] = {};
    for (const form of MONITORED_FORMS) {
      const manifest = manifests[form];
      if (manifest?.sha256) xsdBodies[form] = await deps.fetchText(manifest.source_url);
    }
    const findings = detectDrift({ expectedVersions, listHtml, manifests, xsdBodies });
    const alerted = await state.get();
    const next = new Set(alerted);
    let count = 0;
    for (const f of findings) {
      if (alerted.has(f.key)) continue;
      deps.logger.warn(
        {
          event: 'ops.drift',
          kind: f.kind,
          form: f.form,
          expected: f.expected,
          observed: f.observed,
        },
        'EPO drift detected',
      );
      count += 1;
      // fetch failures are retried next night, so they are never stored
      if (f.kind !== 'fetch_failed') next.add(f.key);
    }
    await state.set(next);
    deps.logger.info({ findings: findings.length, alerted: count }, 'ops.drift_monitors done');
  };
}

async function fetchTextDefault(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function registerDriftMonitors(
  registry: Pick<JobRegistry, 'registerSystem'>,
  env: Readonly<Record<string, string | undefined>>,
  logger: Pick<Logger, 'info' | 'warn'>,
): boolean {
  void env;
  registry.registerSystem(
    opsDriftMonitorsJob,
    createDriftMonitorsHandler({ fetchText: fetchTextDefault, logger }),
  );
  return true;
}
