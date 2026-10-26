// VAT periods API (0351): pure card builder and request parsers. Pure, no I/O. Money stays a string.

export type CardKind =
  | 'ready'
  | 'not_ready'
  | 'needs_accountant'
  | 'draft_unvalidated'
  | 'filed'
  | 'amendment_needed'
  | 'imported_matches'
  | 'overdue_missing';

export interface PeriodCard {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly form: 'DPHDP3' | 'DPHKH1' | 'DPHSHV';
  readonly kind: CardKind;
  readonly filingId: string | null;
  readonly bundleId: string | null;
  readonly amountDue: string | null;
  readonly dueDate: string | null;
  readonly obligationState: string | null;
  readonly reasons: readonly string[];
  readonly filedOn: string | null;
  readonly proposal: { kind: string; dueDate: string } | null;
}

export interface CardInputs {
  readonly status: 'platce' | 'identifikovana_osoba';
  readonly today: string;
  readonly filings: ReadonlyArray<{
    id: string;
    type: string;
    kind: string;
    origin: string;
    periodStart: string;
    periodEnd: string;
    state: string;
    bundleId: string | null;
    xsdValid: boolean | null;
    totals: Record<string, unknown>;
    simpleCheck: Record<string, unknown>;
    filedOn: string | null;
    amendsFilingId: string | null;
    discoveredOn: string | null;
  }>;
  readonly obligations: ReadonlyArray<{
    kind: string;
    periodStart: string | null;
    dueDate: string;
    state: string;
    amountEstimate: string | null;
  }>;
  readonly periodsWithEntries: readonly string[];
}

const FORMS = ['DPHDP3', 'DPHKH1', 'DPHSHV'] as const;
type Form = (typeof FORMS)[number];

const GENERATE_KINDS = ['radne', 'opravne', 'dodatecne', 'nasledne'] as const;
type GenerateKind = (typeof GENERATE_KINDS)[number];

const FORM_OF_KIND: ReadonlyMap<string, Form> = new Map<string, Form>([
  ['vat_return', 'DPHDP3'],
  ['kh', 'DPHKH1'],
  ['sh', 'DPHSHV'],
]);

const PERIOD_START_RE = /^\d{4}-(0[1-9]|1[0-2])-01$/;

function isForm(v: unknown): v is Form {
  return typeof v === 'string' && (FORMS as readonly string[]).includes(v);
}

function isGenerateKind(v: unknown): v is GenerateKind {
  return typeof v === 'string' && (GENERATE_KINDS as readonly string[]).includes(v);
}

function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function monthEnd(periodStart: string): string {
  const year = Number.parseInt(periodStart.slice(0, 4), 10);
  const month = Number.parseInt(periodStart.slice(5, 7), 10);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${periodStart.slice(0, 8)}${String(last).padStart(2, '0')}`;
}

function failingCodes(simpleCheck: Record<string, unknown>): string[] {
  const checks = simpleCheck.checks;
  if (!Array.isArray(checks)) return [];
  const out: string[] = [];
  for (const c of checks) {
    if (typeof c === 'object' && c !== null && 'code' in c && 'outcome' in c) {
      if (typeof c.code === 'string' && c.outcome !== 'pass') out.push(c.code);
    }
  }
  return out;
}

// Row64 is a whole-koruna integer in the totals; anything else is not shown as an amount.
function amountString(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isInteger(v)) return String(v);
  return null;
}

function proposalOf(v: unknown): { kind: string; dueDate: string } | null {
  if (typeof v !== 'object' || v === null || !('kind' in v) || !('dueDate' in v)) return null;
  if (typeof v.kind !== 'string' || typeof v.dueDate !== 'string') return null;
  return { kind: v.kind, dueDate: v.dueDate };
}

interface DueInfo {
  readonly dueDate: string;
  readonly state: string;
}

function filingCard(
  f: CardInputs['filings'][number],
  form: Form,
  due: ReadonlyMap<string, DueInfo>,
): PeriodCard | null {
  const d = due.get(`${form}|${f.periodStart}`);
  const verdict = f.simpleCheck.verdict;
  let kind: CardKind;
  let amountDue: string | null = null;
  let reasons: string[] = [];
  let proposal: { kind: string; dueDate: string } | null = null;

  if (f.state === 'marked_filed') {
    kind = f.origin === 'imported' && f.totals.matchesFiled === true ? 'imported_matches' : 'filed';
  } else if (f.state === 'draft' && f.amendsFilingId !== null) {
    kind = 'amendment_needed';
    proposal = proposalOf(f.totals.proposal);
  } else if (verdict === 'needs_accountant') {
    kind = 'needs_accountant';
  } else if (f.state === 'draft' && verdict === 'not_ready') {
    kind = 'not_ready';
    reasons = failingCodes(f.simpleCheck);
  } else if ((f.state === 'generated' || f.state === 'downloaded') && f.xsdValid === true) {
    kind = 'ready';
    amountDue = amountString(f.totals.row64);
  } else if (
    (f.state === 'generated' || f.state === 'downloaded' || f.state === 'draft') &&
    verdict === 'simple'
  ) {
    kind = 'draft_unvalidated';
  } else {
    return null;
  }

  return {
    periodStart: f.periodStart,
    periodEnd: f.periodEnd,
    form,
    kind,
    filingId: f.id,
    bundleId: f.bundleId,
    amountDue,
    dueDate: d?.dueDate ?? null,
    obligationState: d?.state ?? null,
    reasons,
    filedOn: f.filedOn,
    proposal,
  };
}

export function buildPeriodCards(input: CardInputs): PeriodCard[] {
  const due = new Map<string, DueInfo>();
  for (const o of input.obligations) {
    const form = FORM_OF_KIND.get(o.kind);
    if (form === undefined || o.periodStart === null) continue;
    due.set(`${form}|${o.periodStart}`, { dueDate: o.dueDate, state: o.state });
  }

  const active = input.filings.filter((f) => f.state !== 'superseded');
  const cards: PeriodCard[] = [];
  const haveFiling = new Set<string>();
  for (const f of active) {
    if (!isForm(f.type)) continue; // VAT_WORKBOOK rows produce no card
    haveFiling.add(`${f.type}|${f.periodStart}`);
    const card = filingCard(f, f.type, due);
    if (card !== null) cards.push(card);
  }

  const seen = new Set<string>();
  for (const o of input.obligations) {
    const form = FORM_OF_KIND.get(o.kind);
    if (form === undefined || o.periodStart === null) continue;
    if (o.state !== 'open' && o.state !== 'overdue') continue;
    if (!(o.dueDate < input.today)) continue;
    if (!input.periodsWithEntries.includes(o.periodStart)) continue;
    const key = `${form}|${o.periodStart}`;
    if (haveFiling.has(key) || seen.has(key)) continue;
    seen.add(key);
    cards.push({
      periodStart: o.periodStart,
      periodEnd: monthEnd(o.periodStart),
      form,
      kind: 'overdue_missing',
      filingId: null,
      bundleId: null,
      amountDue: null,
      dueDate: o.dueDate,
      obligationState: o.state,
      reasons: [],
      filedOn: null,
      proposal: null,
    });
  }

  const formIndex = (f: Form): number => FORMS.indexOf(f);
  cards.sort((a, b) => {
    if (a.periodStart !== b.periodStart) return a.periodStart < b.periodStart ? 1 : -1;
    return formIndex(a.form) - formIndex(b.form);
  });
  return cards;
}

export function parseYear(raw: string | null, today: string): number | null {
  const current = Number.parseInt(today.slice(0, 4), 10);
  if (raw === null) return current;
  if (!/^\d{4}$/.test(raw)) return null;
  const year = Number.parseInt(raw, 10);
  return year >= 2000 && year <= 2100 ? year : current;
}

export function parseGenerateBody(
  body: unknown,
): { kind: GenerateKind; discoveredOn?: string } | null {
  if (typeof body !== 'object' || body === null || !('kind' in body)) return null;
  const kind = body.kind;
  if (!isGenerateKind(kind)) return null;
  const discoveredOn = 'discoveredOn' in body ? body.discoveredOn : undefined;
  if (discoveredOn === undefined || discoveredOn === null) return { kind };
  if (!isIsoDate(discoveredOn)) return null;
  return { kind, discoveredOn };
}

export function parsePeriodStart(raw: string): string | null {
  return PERIOD_START_RE.test(raw) ? raw : null;
}

export function parseForm(raw: string | null): 'DPHDP3' | 'DPHKH1' | 'DPHSHV' | null {
  if (raw === null) return 'DPHDP3';
  return isForm(raw) ? raw : null;
}
