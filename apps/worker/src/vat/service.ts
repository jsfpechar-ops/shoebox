// M05 §4.11 worker service: evaluate a VAT period and generate a filing bundle. Never submits
// anything anywhere (AGENTS rule 8). Logs carry ids and counts only, never document content.

import {
  insertDocumentLinks,
  insertFiling,
  listFilings,
  type PeriodEntryRow,
  type PeriodLedger,
  type ProfileVersionRow,
  readGovernmentFilingFields,
  readPeriodLedger,
  setFilingState,
  supersedeOpenFilings,
  type TenantTx,
  upsertVatObligations,
} from '@shoebox/db';
import {
  buildEpoHeader,
  classifyPeriod,
  compareWithImported,
  computeDphdp3,
  computeKh,
  computeShv,
  createCzRules,
  type Dphdp3Computation,
  dicDigits,
  type EpoForm,
  type EpoHeader,
  FILING_KIND_VALUES,
  FILING_STATE_VALUES,
  FILING_TYPE_VALUES,
  type FilingKind,
  IO_RETURN_ROWS,
  type KhComputation,
  type LegalDate,
  type Money,
  monthAfter,
  periodEndOf,
  periodFor,
  pragueDateOf,
  reconcileKhDp3,
  type ShvComputation,
  type SimpleCheckResult,
  type SimpleVerdict,
  VAT_PERIOD_VALUES,
  type VatFilingSummary,
  type VatPeriodRange,
  type VatPeriodSummary,
  vatObligationsFor,
} from '@shoebox/domain';
import {
  type TenantJobDefinition,
  vatAmendmentDetectJob,
  vatWorkbookGenerateJob,
} from '@shoebox/pipeline';
import type { BlobStore, Logger } from '@shoebox/platform';
import {
  serializeDphdp3,
  serializeKh,
  serializeShv,
  type validateXml,
  validateXmlOrStructural,
} from '@shoebox/tax-xml';
import { z } from 'zod';
import { type ImportedStore, registerImportedFilings } from './imported';
import {
  foreignPolicyOf,
  khLookup,
  oneOf,
  profileAt,
  toClassifierInput,
  toEntryDraft,
  toEpoProfile,
  vatStatusOf,
} from './map';

export interface VatStore {
  readonly readPeriodLedger: typeof readPeriodLedger;
  readonly insertFiling: typeof insertFiling;
  readonly supersedeOpenFilings: typeof supersedeOpenFilings;
  readonly listFilings: typeof listFilings;
  readonly setFilingState: typeof setFilingState;
  readonly upsertVatObligations: typeof upsertVatObligations;
  /** Optional: without these the imported filing check is skipped. */
  readonly readGovernmentFilingFields?: typeof readGovernmentFilingFields;
  readonly insertDocumentLinks?: typeof insertDocumentLinks;
}

export const dbVatStore: VatStore = {
  readPeriodLedger,
  insertFiling,
  supersedeOpenFilings,
  listFilings,
  setFilingState,
  upsertVatObligations,
  readGovernmentFilingFields,
  insertDocumentLinks,
};

export type Validate = typeof validateXml;

export interface VatDeps {
  readonly store?: VatStore;
  readonly blobs: Pick<BlobStore, 'put'>;
  readonly rules?: ReturnType<typeof createCzRules>;
  readonly logger: Pick<Logger, 'info' | 'warn'>;
  readonly now?: () => number;
  readonly appVersion?: string;
  readonly validate?: Validate;
  readonly enqueue: <P extends { orgId: string }>(
    def: TenantJobDefinition<P>,
    payload: P,
  ) => Promise<string | null>;
}

export interface EvaluateResult {
  readonly verdict: SimpleVerdict;
  readonly family: 'IO' | 'PAYER';
  readonly ledgerHash: string;
  readonly draftFilingId: string | null;
  readonly obligations: number;
  /** Our DPHDP3 equals the imported filed return; null when none or not a simple return. */
  readonly matchesFiled: boolean | null;
}

export type GenerateOutcome =
  | {
      readonly outcome: 'generated' | 'draft_invalid_xsd' | 'draft_unvalidated';
      readonly bundleId: string;
      readonly filingIds: readonly string[];
    }
  | {
      readonly outcome: 'not_simple';
      readonly verdict: SimpleVerdict;
      readonly draftFilingId: string | null;
    }
  | { readonly outcome: 'exists'; readonly filingIds: readonly string[] }
  | { readonly outcome: 'header_missing'; readonly missing: readonly string[] }
  | {
      readonly outcome: 'skipped';
      readonly reason: 'no_profile' | 'not_vat_registered' | 'nothing_to_file';
    };

export interface GenerateRequest {
  readonly periodStart: LegalDate;
  readonly kind: FilingKind;
  readonly amendsFilingId?: string;
  readonly discoveredOn?: LegalDate;
  readonly requestedBy: string;
}

/** Obligation generator version written to obligations.generator_version. */
const OBLIGATION_GENERATOR_VERSION = 1;
const OPEN_BLOCKING_STATES: readonly string[] = ['generated', 'downloaded', 'marked_filed'];

export interface Ctx {
  readonly store: VatStore;
  readonly blobs: Pick<BlobStore, 'put'>;
  readonly rules: ReturnType<typeof createCzRules>;
  readonly logger: Pick<Logger, 'info' | 'warn'>;
  readonly now: () => number;
  readonly appVersion: string;
  readonly validate: Validate;
  readonly enqueue: VatDeps['enqueue'];
}

export function resolve(deps: VatDeps): Ctx {
  return {
    store: deps.store ?? dbVatStore,
    blobs: deps.blobs,
    rules: deps.rules ?? createCzRules(),
    logger: deps.logger,
    now: deps.now ?? Date.now,
    appVersion: deps.appVersion ?? process.env.SHOEBOX_APP_VERSION ?? '0.0.0',
    validate: deps.validate ?? validateXmlOrStructural,
    enqueue: deps.enqueue,
  };
}

export type Skipped = { readonly skipped: 'no_profile' | 'not_vat_registered' };
export interface Loaded {
  readonly ledger: PeriodLedger;
  readonly profile: ProfileVersionRow;
  readonly status: 'platce' | 'identifikovana_osoba';
  readonly period: VatPeriodRange;
}

export async function loadPeriod(
  tx: TenantTx,
  orgId: string,
  periodStart: LegalDate,
  c: Ctx,
): Promise<Loaded | Skipped> {
  const guessEnd = periodEndOf(periodStart, 'month');
  let ledger = await c.store.readPeriodLedger(tx, orgId, periodStart, guessEnd);
  const profile = profileAt(ledger.profiles, periodStart);
  if (profile === null) return { skipped: 'no_profile' };
  const vatStatus = vatStatusOf(profile.vatStatus);
  if (vatStatus === 'neplatce') return { skipped: 'not_vat_registered' };
  const period = periodFor(periodStart, {
    vatStatus,
    vatPeriod:
      profile.vatPeriod === null ? null : oneOf(VAT_PERIOD_VALUES, profile.vatPeriod, 'vat_period'),
    foreignServiceDppdPolicy: foreignPolicyOf(profile),
  });
  if (period === null) return { skipped: 'no_profile' };
  if (period.end !== guessEnd) {
    ledger = await c.store.readPeriodLedger(tx, orgId, periodStart, period.end);
  }
  return { ledger, profile, status: vatStatus, period };
}

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function totalsHash(totals: unknown): string | null {
  const hash = recordOf(totals).ledgerHash;
  return typeof hash === 'string' ? hash : null;
}

function fingerprintOf(simpleCheck: unknown): string {
  const sc = recordOf(simpleCheck);
  return JSON.stringify({ verdict: sc.verdict, checks: sc.checks });
}

function wholeKc(m: Money): number {
  return Number.parseInt(m.toFixed2(), 10);
}

const FormInfoSchema = z.object({ version: z.string().min(1), verze_pis: z.string().min(1) });
export function formInfo(
  rules: ReturnType<typeof createCzRules>,
  form: EpoForm,
  date: LegalDate,
): { version: string; verzePis: string } {
  const all: Record<string, unknown> = rules.at(date).get('epo.forms');
  const parsed = FormInfoSchema.safeParse(all[form]);
  if (!parsed.success) throw new Error(`rule epo.forms has no usable entry for ${form}`);
  return { version: parsed.data.version, verzePis: parsed.data.verze_pis };
}

export function stateChanged(c: Ctx, filingId: string, from: string | null, to: string): void {
  c.logger.info({ event: 'filing.state_changed', filingId, from, to }, 'filing state changed');
}

async function enqueueWorkbook(orgId: string, periodStart: LegalDate, c: Ctx): Promise<void> {
  await c.enqueue(vatWorkbookGenerateJob, { orgId, periodStart });
}

function shMonthsOf(
  entries: ReturnType<typeof toEntryDraft>[],
  period: VatPeriodRange,
  c: Ctx,
): ShvComputation[] {
  const out: ShvComputation[] = [];
  for (let m = period.start; m <= period.end; m = monthAfter(m)) {
    const shv = computeShv(entries, c.rules, m);
    if (shv.rows.length > 0) out.push(shv);
  }
  return out;
}

/** Draft refresh: supersedes an older draft, never touches a generated/downloaded/filed one. */
async function refreshDraft(
  tx: TenantTx,
  orgId: string,
  c: Ctx,
  loaded: Loaded,
  check: SimpleCheckResult,
  ledgerHash: string,
  kind: FilingKind,
): Promise<string | null> {
  const existing = await c.store.listFilings(tx, orgId, {
    periodStart: loaded.period.start,
    types: ['DPHDP3'],
  });
  if (existing.some((f) => OPEN_BLOCKING_STATES.includes(f.state))) return null;
  const drafts = existing.filter((f) => f.state === 'draft' && f.kind === kind);
  const fingerprint = JSON.stringify({ verdict: check.verdict, checks: check.checks });
  const keep = drafts.find(
    (f) => totalsHash(f.totals) === ledgerHash && fingerprintOf(f.simpleCheck) === fingerprint,
  );
  if (keep) return keep.id;
  for (const f of drafts) {
    await c.store.setFilingState(tx, orgId, f.id, 'superseded');
    stateChanged(c, f.id, 'draft', 'superseded');
  }
  const id = await c.store.insertFiling(
    tx,
    {
      orgId,
      type: 'DPHDP3',
      kind,
      periodStart: loaded.period.start,
      periodEnd: loaded.period.end,
      state: 'draft',
      formVersion: `DPHDP3 ${formInfo(c.rules, 'DPHDP3', loaded.period.start).version}`,
      totals: { ledgerHash },
      simpleCheck: check,
    },
    [],
    [],
  );
  stateChanged(c, id, null, 'draft');
  return id;
}

async function refreshObligations(
  tx: TenantTx,
  orgId: string,
  c: Ctx,
  loaded: Loaded,
  shMonths: readonly ShvComputation[],
  dp3: Dphdp3Computation | null,
): Promise<number> {
  const { period, status, ledger } = loaded;
  const summary: VatPeriodSummary = {
    start: period.start,
    end: period.end,
    kind: period.kind,
    hasReturnRows:
      status === 'platce' ||
      ledger.entries.some((e) => e.dphdp3Rows.some((row) => IO_RETURN_ROWS.includes(row))),
    row64: dp3?.row64 ?? null,
    row65: dp3?.row65 ?? null,
    shMonths: shMonths.map((s) => ({
      monthStart: s.monthStart,
      monthEnd: periodEndOf(s.monthStart, 'month'),
      plnHodnotaSum: s.total,
    })),
  };
  const starts = [period.start, ...shMonths.map((s) => s.monthStart)];
  const seen = new Map<string, VatFilingSummary>();
  for (const start of new Set(starts)) {
    const rows = await c.store.listFilings(tx, orgId, { periodStart: start });
    for (const f of rows) {
      if (!(FILING_TYPE_VALUES as readonly string[]).includes(f.type)) continue;
      const type = oneOf(['DPHDP3', 'DPHKH1', 'DPHSHV'] as const, f.type, 'filings.type');
      seen.set(f.id, {
        type,
        kind: oneOf(FILING_KIND_VALUES, f.kind, 'filings.kind'),
        periodStart: f.periodStart as LegalDate,
        state: oneOf(FILING_STATE_VALUES, f.state, 'filings.state'),
      });
    }
  }
  const today = pragueDateOf(c.now());
  // TODO(0344-payments): matched tax_vat_payment transactions are not read yet.
  const drafts = vatObligationsFor(
    { status, periods: [summary], filings: [...seen.values()], payments: [], today },
    c.rules,
  );
  return c.store.upsertVatObligations(tx, orgId, drafts, OBLIGATION_GENERATOR_VERSION);
}

export type Computed = Loaded & {
  readonly classifier: SimpleCheckResult;
  readonly dp3: Dphdp3Computation | null;
  readonly kh: KhComputation | null;
  readonly shvByMonth: ShvComputation[];
  readonly ledgerHash: string;
};

/** Load, classify and, for a simple verdict, compute the period. Shared by evaluatePeriod and generateBundle. */
export async function computePeriod(
  tx: TenantTx,
  orgId: string,
  periodStart: LegalDate,
  c: Ctx,
): Promise<Computed | Skipped> {
  const loaded = await loadPeriod(tx, orgId, periodStart, c);
  if ('skipped' in loaded) return loaded;
  const { ledger, status, period } = loaded;
  const classifier = classifyPeriod(
    toClassifierInput(ledger, status, period, new Date(c.now()).toISOString()),
    c.rules,
  );
  let dp3: Dphdp3Computation | null = null;
  let kh: KhComputation | null = null;
  let shvByMonth: ShvComputation[] = [];
  if (classifier.verdict === 'simple') {
    const entries = ledger.entries.map(toEntryDraft);
    dp3 = computeDphdp3(entries, status, c.rules, period.start);
    if (status === 'platce') {
      kh = computeKh(entries, dp3, khLookup(ledger));
      shvByMonth = shMonthsOf(entries, period, c);
    }
  }
  return { ...loaded, classifier, dp3, kh, shvByMonth, ledgerHash: ledger.ledgerHash };
}

export async function evaluatePeriod(
  tx: TenantTx,
  orgId: string,
  periodStart: LegalDate,
  deps: VatDeps,
): Promise<EvaluateResult | Skipped> {
  const c = resolve(deps);
  const loaded = await computePeriod(tx, orgId, periodStart, c);
  if ('skipped' in loaded) return loaded;
  const { ledger, status, period, profile, classifier: check, dp3, shvByMonth: shMonths } = loaded;
  if (check.verdict === 'needs_accountant') await enqueueWorkbook(orgId, period.start, c);
  const filed = await c.store.listFilings(tx, orgId, {
    periodStart: period.start,
    states: ['marked_filed'],
  });
  if (filed.length > 0)
    await c.enqueue(vatAmendmentDetectJob, { orgId, periodStart: period.start });
  const importedStore = importedStoreOf(c.store);
  const imported =
    importedStore === null
      ? null
      : await registerImportedFilings(
          tx,
          {
            orgId,
            periodStart: period.start,
            periodEnd: period.end,
            orgDicDigits: dicDigits(profile.dic),
            ledgerDocumentIds: [...new Set(ledger.entries.map((e) => e.documentId))],
            now: new Date(c.now()),
          },
          importedStore,
          c.logger,
        );
  const draftFilingId =
    check.verdict === 'nothing_to_file'
      ? null
      : await refreshDraft(tx, orgId, c, loaded, check, ledger.ledgerHash, 'radne');

  const matchesFiled =
    imported !== null && dp3 !== null ? compareWithImported(dp3, imported).matches : null;
  if (matchesFiled === true)
    c.logger.info(
      { event: 'filing.matches_filed', orgId, periodStart: period.start },
      'matches filed',
    );
  if (matchesFiled === false)
    c.logger.info(
      { event: 'filing.amendment_needed', orgId, periodStart: period.start },
      'amendment needed',
    );
  const obligations = await refreshObligations(tx, orgId, c, loaded, shMonths, dp3);
  c.logger.info(
    {
      event: 'vat.period.evaluated',
      orgId,
      periodStart: period.start,
      verdict: check.verdict,
      obligations,
    },
    'vat period evaluated',
  );
  return {
    verdict: check.verdict,
    family: status === 'platce' ? 'PAYER' : 'IO',
    ledgerHash: ledger.ledgerHash,
    draftFilingId,
    obligations,
    matchesFiled,
  };
}

function importedStoreOf(store: VatStore): ImportedStore | null {
  const { readGovernmentFilingFields: read, insertDocumentLinks: link } = store;
  if (read === undefined || link === undefined) return null;
  return {
    readGovernmentFilingFields: read,
    insertDocumentLinks: link,
    listFilings: store.listFilings,
    insertFiling: store.insertFiling,
  };
}

interface FormItem {
  readonly form: EpoForm;
  readonly periodStart: LegalDate;
  readonly periodEnd: LegalDate;
  readonly xml: string;
  readonly version: string;
  readonly path: string;
  readonly entries: readonly PeriodEntryRow[];
}

function totalsOf(
  ledgerHash: string,
  dp3: Dphdp3Computation,
  kh: KhComputation | null,
  shMonths: readonly ShvComputation[],
): Record<string, unknown> {
  return {
    ledgerHash,
    rounding: dp3.rounding,
    rows: Object.fromEntries(
      Object.entries(dp3.rows).map(([row, v]) => [
        row,
        { base: wholeKc(v.base), tax: wholeKc(v.tax) },
      ]),
    ),
    row62: wholeKc(dp3.row62),
    row63: wholeKc(dp3.row63),
    row64: wholeKc(dp3.row64),
    row65: wholeKc(dp3.row65),
    trans: dp3.trans,
    kh:
      kh === null
        ? null
        : {
            a2: kh.a2.length,
            a4: kh.a4.length,
            a5: kh.a5 !== null,
            b2: kh.b2.length,
            b3: kh.b3 !== null,
            c: {
              obrat23: kh.c.obrat23.toFixed2(),
              obrat5: kh.c.obrat5.toFixed2(),
              pln23: kh.c.pln23.toFixed2(),
              pln5: kh.c.pln5.toFixed2(),
              celkZdA2: kh.c.celkZdA2.toFixed2(),
            },
          },
    shv:
      kh === null
        ? null
        : shMonths.map((s) => ({
            monthStart: s.monthStart,
            rows: s.rows.length,
            total: wholeKc(s.total),
          })),
  };
}

export async function generateBundle(
  tx: TenantTx,
  orgId: string,
  req: GenerateRequest,
  deps: VatDeps,
): Promise<GenerateOutcome> {
  const c = resolve(deps);
  const loaded = await computePeriod(tx, orgId, req.periodStart, c);
  if ('skipped' in loaded) return { outcome: 'skipped', reason: loaded.skipped };
  const {
    ledger,
    profile,
    status,
    period,
    classifier: check,
    dp3,
    kh,
    shvByMonth: shMonths,
  } = loaded;
  if (check.verdict === 'nothing_to_file') return { outcome: 'skipped', reason: 'nothing_to_file' };
  if (check.verdict !== 'simple') {
    const draftFilingId = await refreshDraft(
      tx,
      orgId,
      c,
      loaded,
      check,
      ledger.ledgerHash,
      req.kind,
    );
    if (check.verdict === 'needs_accountant') await enqueueWorkbook(orgId, period.start, c);
    return { outcome: 'not_simple', verdict: check.verdict, draftFilingId };
  }

  // Idempotency: an open filing of this slot built from the same ledger hash is returned as is.
  const open = await c.store.listFilings(tx, orgId, {
    types: ['DPHDP3', 'DPHKH1', 'DPHSHV'],
    states: ['generated', 'downloaded'],
  });
  const same = open.find(
    (f) =>
      f.type === 'DPHDP3' &&
      f.kind === req.kind &&
      f.periodStart === period.start &&
      totalsHash(f.totals) === ledger.ledgerHash,
  );
  if (same) {
    const ids = same.bundleId
      ? open.filter((f) => f.bundleId === same.bundleId).map((f) => f.id)
      : [same.id];
    return { outcome: 'exists', filingIds: ids };
  }

  const preparedOn = pragueDateOf(c.now());
  const epoProfile = toEpoProfile(profile, status);
  const headerFor = (
    form: EpoForm,
    start: LegalDate,
    end: LegalDate,
    kind: 'month' | 'quarter',
  ): ReturnType<typeof buildEpoHeader> =>
    buildEpoHeader(epoProfile, {
      form,
      kind: req.kind,
      period: { start, end, kind },
      preparedOn,
      ...(req.discoveredOn === undefined ? {} : { discoveredOn: req.discoveredOn }),
      appVersion: c.appVersion,
    });
  const must = (r: ReturnType<typeof buildEpoHeader>): EpoHeader => {
    if (!r.ok) throw new Error('epo header unexpectedly unavailable');
    return r.header;
  };

  const dp3Header = headerFor('DPHDP3', period.start, period.end, period.kind);
  if (!dp3Header.ok) {
    if ('missing' in dp3Header) return { outcome: 'header_missing', missing: dp3Header.missing };
    return { outcome: 'skipped', reason: 'not_vat_registered' };
  }

  if (dp3 === null) throw new Error('vat: simple period without dp3');
  const rec = reconcileKhDp3(dp3, kh);
  if (!rec.ok) {
    // Maintainer bug: the dead-letter queue surfaces it. Codes only, no amounts.
    throw new Error(`reconcileKhDp3 failed: ${rec.issues.map((i) => i.code).join(',')}`);
  }

  const bundleId = crypto.randomUUID();
  const blobPath = (name: string) => `org/${orgId}/filings/${bundleId}/${name}.xml`;
  const dp3Info = formInfo(c.rules, 'DPHDP3', period.start);
  const items: FormItem[] = [
    {
      form: 'DPHDP3',
      periodStart: period.start,
      periodEnd: period.end,
      xml: serializeDphdp3(dp3, dp3Header.header, { verzePis: dp3Info.verzePis }),
      version: dp3Info.version,
      path: blobPath('DPHDP3'),
      entries: ledger.entries,
    },
  ];
  if (kh !== null) {
    const info = formInfo(c.rules, 'DPHKH1', period.start);
    items.push({
      form: 'DPHKH1',
      periodStart: period.start,
      periodEnd: period.end,
      xml: serializeKh(kh, must(headerFor('DPHKH1', period.start, period.end, period.kind)), {
        verzePis: info.verzePis,
      }),
      version: info.version,
      path: blobPath('DPHKH1'),
      entries: ledger.entries,
    });
  }
  for (const shv of shMonths) {
    const info = formInfo(c.rules, 'DPHSHV', shv.monthStart);
    const monthEnd = periodEndOf(shv.monthStart, 'month');
    const month = shv.monthStart.slice(0, 7);
    items.push({
      form: 'DPHSHV',
      periodStart: shv.monthStart,
      periodEnd: monthEnd,
      xml: serializeShv(shv, must(headerFor('DPHSHV', shv.monthStart, monthEnd, 'month')), {
        verzePis: info.verzePis,
      }),
      version: info.version,
      path: blobPath(period.kind === 'month' ? 'DPHSHV' : `DPHSHV-${month}`),
      entries: ledger.entries.filter(
        (e) => e.shvCode !== null && e.vatPointDate.slice(0, 7) === month,
      ),
    });
  }

  const results: Awaited<ReturnType<Validate>>[] = [];
  for (const item of items) results.push(await c.validate(item.xml, item.form, item.version));
  const allXsd = results.every((r) => r.valid && r.method === 'xsd');
  const anyInvalid = results.some((r) => !r.valid);
  const state = allXsd ? 'generated' : 'draft';
  const xsdValid = anyInvalid ? false : allXsd ? true : null;

  if (!anyInvalid) {
    for (const item of items) {
      await c.blobs.put(item.path, new TextEncoder().encode(item.xml), 'application/xml');
    }
  }

  const totals = totalsOf(ledger.ledgerHash, dp3, kh, shMonths);
  const generatedAt = new Date(c.now());
  const filingIds: string[] = [];
  for (const [index, item] of items.entries()) {
    const result = results[index];
    const superseded = await c.store.supersedeOpenFilings(
      tx,
      orgId,
      item.form,
      item.periodStart,
      req.kind,
    );
    for (const id of superseded) stateChanged(c, id, 'open', 'superseded');
    const docIds = new Set(item.entries.map((e) => e.documentId));
    const documentRows =
      item.form === 'DPHSHV'
        ? ledger.documents
            .filter((d) => docIds.has(d.id))
            .map((d) => ({ documentId: d.id, revision: d.revision }))
        : ledger.documents.map((d) => ({ documentId: d.id, revision: d.revision }));
    const id = await c.store.insertFiling(
      tx,
      {
        orgId,
        type: item.form,
        kind: req.kind,
        periodStart: item.periodStart,
        periodEnd: item.periodEnd,
        state,
        // TODO(0348): amendment linkage for KH and SH of a bundle.
        amendsFilingId: item.form === 'DPHDP3' ? (req.amendsFilingId ?? null) : null,
        bundleId,
        formVersion: `${item.form} ${item.version}`,
        totals,
        simpleCheck: check,
        xmlPath: anyInvalid ? null : item.path,
        xsdValid,
        xsdErrors: result && !result.valid ? result.errors : null,
        generatedAt,
        generatedBy: req.requestedBy,
        discoveredOn: req.discoveredOn ?? null,
      },
      documentRows,
      item.entries,
    );
    filingIds.push(id);
    stateChanged(c, id, null, state);
  }
  if (anyInvalid) {
    // TODO(decision-xsd): structural-only validation leaves xsd_valid null until the XSD is vendored.
    c.logger.warn(
      {
        event: 'tax_xml_invalid',
        bundleId,
        forms: items.filter((_, i) => results[i]?.valid === false).map((i) => i.form),
        errorCount: results.reduce((n, r) => n + r.errors.length, 0),
      },
      'generated tax xml is invalid',
    );
  }
  await refreshObligations(tx, orgId, c, loaded, shMonths, dp3);
  return {
    outcome: allXsd ? 'generated' : anyInvalid ? 'draft_invalid_xsd' : 'draft_unvalidated',
    bundleId,
    filingIds,
  };
}
