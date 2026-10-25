# 0005: canonical enums, legal dates and the clock

Status: done
Ticket: P0-DOM-03 | Depends on: none (P0-REPO-01 merged) | Base commit: head of phase/0 | Branch: task/0005-enums-dates-clock | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Add to `packages/domain` the 25 canonical enums of 05 §1 as TypeScript unions, a `LegalDate` type (a calendar date without a time zone) and an injected `Clock`, with `pragueToday(clock)` computing "today" in Europe/Prague. Every later module uses these names and dates, so a wrong enum value or an off-by-one "today" around midnight or a DST change would put documents in the wrong VAT period.

## 2. Context

Spec lines (pasted; do not open `docs/v3/`):

- 04: "Every enum is a Postgres enum or check constraint *and* a TypeScript union in `packages/domain/src/enums.ts`." (The orchestrator placed it at `src/enums/index.ts`; same module.)
- 03 ADR-007: "Legal dates use `date` (no TZ). 'Today' is computed in `Europe/Prague`."
- M12 §4.1 rule 2: "`no-date-now-in-domain`: `new Date()`/`Date.now()` banned in `packages/domain` (pass a `Clock`)." Rule 3 also bans `parseFloat(...)` and `Number(...)` in `packages/domain`. The code below uses `Number.parseInt`, `Number.isInteger`, `Number.isFinite` and `Date.parse`/`Date.UTC`, which these rules allow (checked with `biome ci`).
- depcruise `domain-is-pure`: `packages/domain/src` imports only itself, `decimal.js` and `zod`. This brief imports nothing outside `src/`.
- No date library is approved (decisions.md): dates use plain integer arithmetic plus the built-in `Intl.DateTimeFormat` with `timeZone: 'Europe/Prague'`.
- Coverage gate in CI: `packages/domain/src/**` ≥ 90 % lines. The tests below give 100 % lines.
- 05 §1 enums (25): the full SQL block is pasted verbatim inside the test file in step 5 (`SQL_05_ENUMS`); the test parses it and compares every list, in order, with `ENUMS`.

Current `packages/domain/src/index.ts` (anchor for step 4):

```ts
export const packageName = '@shoebox/domain' as const;
```

Brief 0004 (Money, parallel) may already have added `export * from './money/index';` after that line. Either way the anchor is the `packageName` line.

All code below was run once by the brief writer against `phase/0`: 59 tests pass (1 smoke + 29 + 29), `tsc` is clean, `biome ci packages/domain` is clean.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/src/clock/index.ts` | create | `Clock` interface, `fixedClock` |
| `packages/domain/src/dates/index.ts` | create | `LegalDate`, parse/compare/addDays, `pragueDateOf`, `pragueToday` |
| `packages/domain/src/enums/index.ts` | create | 25 enum value lists + unions, `ENUMS`, `isEnumValue` |
| `packages/domain/src/index.ts` | edit | three `export *` lines |
| `packages/domain/test/enums.test.ts` | create | compares every union with the 05 §1 list |
| `packages/domain/test/dates.test.ts` | create | Prague today, DST days, LegalDate parse/compare/addDays |

No other file may change.

## 4. Steps

Setup (once): `git fetch origin phase/0 && git checkout -b task/0005-enums-dates-clock origin/phase/0 2>&1 | tail -3`

Rules for every step: write each new file with **one Write call**, contents exactly as given. Do not re-read a file you just wrote. Do not explore other files. After the step's command shows the expected result, commit: `git add -A && git commit -qm "0005 step k" && git log --oneline -1`. All commands run from the repo root.

### Step 1: create `packages/domain/src/clock/index.ts`

```ts
// packages/domain never reads the wall clock (M12 §4.1 rule 2, lint no-date-now-in-domain).
// Callers pass a Clock; the system clock is built outside the domain (apps, worker).

/** The only way domain code learns the current time. */
export interface Clock {
  /** The current instant as milliseconds since the Unix epoch (UTC). */
  now(): number;
}

/** A clock frozen at one instant: an ISO 8601 string with an offset or `Z`, or epoch milliseconds. */
export function fixedClock(instant: string | number): Clock {
  const ms = typeof instant === 'number' ? instant : Date.parse(instant);
  if (!Number.isFinite(ms)) {
    throw new RangeError(`fixedClock: not a valid instant: ${String(instant)}`);
  }
  return { now: () => ms };
}
```

Command: `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`
Expected: no `error TS` lines.

### Step 2: create `packages/domain/src/dates/index.ts`

```ts
// Legal dates (ADR-007): a calendar date with no time zone, stored as Postgres `date`.
// "Today" is always the calendar date in Europe/Prague. No date library (none approved).
import type { Clock } from '../clock/index';

declare const legalDateBrand: unique symbol;

/** A valid calendar date as `YYYY-MM-DD` (years 0001–9999). Build it with `parseLegalDate`. */
export type LegalDate = string & { readonly [legalDateBrand]: true };

export const LEGAL_TIME_ZONE = 'Europe/Prague';

export class InvalidLegalDateError extends Error {
  constructor(value: string) {
    super(`Not a legal date (YYYY-MM-DD): ${value}`);
    this.name = 'InvalidLegalDateError';
  }
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function pad(value: number, width: number): string {
  return value.toString().padStart(width, '0');
}

function fromParts(year: number, month: number, day: number): LegalDate {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}` as LegalDate;
}

function toParts(date: LegalDate): [number, number, number] {
  const [y, m, d] = date.split('-');
  return [Number.parseInt(y ?? '', 10), Number.parseInt(m ?? '', 10), Number.parseInt(d ?? '', 10)];
}

export function isLegalDate(value: string): value is LegalDate {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const year = Number.parseInt(match[1] ?? '', 10);
  const month = Number.parseInt(match[2] ?? '', 10);
  const day = Number.parseInt(match[3] ?? '', 10);
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

/** Parses a strict `YYYY-MM-DD` calendar date; throws `InvalidLegalDateError` otherwise. */
export function parseLegalDate(value: string): LegalDate {
  if (!isLegalDate(value)) throw new InvalidLegalDateError(value);
  return value;
}

/** -1 if a is earlier, 0 if equal, 1 if later. */
export function compareLegalDates(a: LegalDate, b: LegalDate): -1 | 0 | 1 {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

// Days since 1970-01-01 for a proleptic Gregorian date (H. Hinnant, "days_from_civil").
function toEpochDay(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

// Inverse of toEpochDay ("civil_from_days").
function fromEpochDay(epochDay: number): [number, number, number] {
  const z = epochDay + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return [yoe + era * 400 + (month <= 2 ? 1 : 0), month, day];
}

/** Adds a whole number of calendar days (negative goes back). */
export function addDays(date: LegalDate, days: number): LegalDate {
  if (!Number.isInteger(days)) throw new RangeError(`addDays: days must be an integer: ${days}`);
  const [year, month, day] = fromEpochDay(toEpochDay(...toParts(date)) + days);
  if (year < 1 || year > 9999) throw new RangeError(`addDays: result outside years 0001-9999`);
  return fromParts(year, month, day);
}

const pragueFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: LEGAL_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The calendar date in Europe/Prague at the given instant (epoch milliseconds). */
export function pragueDateOf(instantMs: number): LegalDate {
  const parts = pragueFormatter.formatToParts(instantMs);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return parseLegalDate(`${get('year')}-${get('month')}-${get('day')}`);
}

/** Today's legal date: the calendar date in Europe/Prague at the clock's instant. */
export function pragueToday(clock: Clock): LegalDate {
  return pragueDateOf(clock.now());
}
```

Command: `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`
Expected: no `error TS` lines.

### Step 3: create `packages/domain/src/enums/index.ts`

```ts
// Canonical enums (04 is the source of truth, 05 §1 is the DDL). Each union is derived from its
// value list, so the runtime list and the type can never drift. Change = migration + 05 edit + here.

export const VAT_STATUS_VALUES = ['neplatce', 'identifikovana_osoba', 'platce'] as const;
export type VatStatus = (typeof VAT_STATUS_VALUES)[number];

export const VAT_PERIOD_VALUES = ['monthly', 'quarterly'] as const;
export type VatPeriod = (typeof VAT_PERIOD_VALUES)[number];

export const TAX_REGIME_VALUES = [
  'danova_evidence',
  'pausalni_vydaje',
  'pausalni_dan',
  'ucetnictvi',
] as const;
export type TaxRegime = (typeof TAX_REGIME_VALUES)[number];

export const MEMBER_ROLE_VALUES = ['owner', 'member', 'accountant', 'viewer'] as const;
export type MemberRole = (typeof MEMBER_ROLE_VALUES)[number];

export const DOCUMENT_CLASS_VALUES = [
  'received_invoice',
  'received_receipt',
  'received_credit_note',
  'received_advance_tax_doc',
  'received_proforma',
  'issued_invoice',
  'issued_credit_note',
  'platform_statement',
  'settlement_statement',
  'order_confirmation',
  'delivery_note',
  'bank_statement',
  'government_filing',
  'contract',
  'other_supporting',
  'non_document',
  'unknown',
] as const;
export type DocumentClass = (typeof DOCUMENT_CLASS_VALUES)[number];

export const DOCUMENT_STATUS_VALUES = [
  'received',
  'splitting',
  'classifying',
  'extracting',
  'validating',
  'categorizing',
  'needs_review',
  'ready',
  'finalized',
  'supporting',
  'duplicate',
  'failed',
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUS_VALUES)[number];

export const TAX_DOC_STATUS_VALUES = [
  'full_tax_document',
  'simplified_tax_document',
  'not_tax_document',
  'foreign_document',
  'unknown',
] as const;
export type TaxDocStatus = (typeof TAX_DOC_STATUS_VALUES)[number];

/** in = expense side (received), out = income side (issued). */
export const DIRECTION_VALUES = ['in', 'out'] as const;
export type Direction = (typeof DIRECTION_VALUES)[number];

export const LINE_TYPE_VALUES = [
  'item',
  'discount',
  'shipping',
  'fee',
  'rounding',
  'advance_deduction',
  'deposit',
  'text',
] as const;
export type LineType = (typeof LINE_TYPE_VALUES)[number];

export const VAT_RATE_TYPE_VALUES = ['standard', 'reduced', 'zero', 'none'] as const;
export type VatRateType = (typeof VAT_RATE_TYPE_VALUES)[number];

export const VAT_TREATMENT_VALUES = [
  'rcv_domestic_vat',
  'rcv_domestic_no_vat',
  'rcv_eu_service_reverse_charge',
  'rcv_non_eu_service_reverse_charge',
  'rcv_eu_goods_acquisition',
  'rcv_domestic_reverse_charge',
  'rcv_import_customs',
  'rcv_foreign_vat_charged',
  'rcv_out_of_scope',
  'iss_domestic_vat',
  'iss_eu_service',
  'iss_eu_goods',
  'iss_non_eu_service',
  'iss_export_goods',
  'iss_domestic_reverse_charge',
  'iss_exempt',
  'iss_no_vat',
] as const;
export type VatTreatment = (typeof VAT_TREATMENT_VALUES)[number];

export const TAX_EFFECT_VALUES = [
  'taxable_income',
  'non_taxable_income',
  'deductible_expense',
  'non_deductible_expense',
  'asset',
  'pass_through',
  'transfer',
  'tax_or_insurance_payment',
  'private',
] as const;
export type TaxEffect = (typeof TAX_EFFECT_VALUES)[number];

/** Typed (manual entry) and spreadsheet-imported values are 'user' (04 §2.2a). */
export const FIELD_SOURCE_VALUES = [
  'isdoc',
  'qr',
  'pdf_text',
  'template',
  'llm',
  'llm_escalated',
  'registry',
  'rule',
  'vendor_memory',
  'user',
  'derived',
] as const;
export type FieldSource = (typeof FIELD_SOURCE_VALUES)[number];

export const SEVERITY_VALUES = ['blocking', 'warning', 'info'] as const;
export type Severity = (typeof SEVERITY_VALUES)[number];

export const VALIDATION_STATE_VALUES = ['open', 'resolved', 'dismissed'] as const;
export type ValidationState = (typeof VALIDATION_STATE_VALUES)[number];

export const MONEY_ACCOUNT_TYPE_VALUES = ['bank', 'cash', 'card', 'platform'] as const;
export type MoneyAccountType = (typeof MONEY_ACCOUNT_TYPE_VALUES)[number];

export const TX_SOURCE_VALUES = [
  'statement_file',
  'email_notice',
  'bank_api',
  'manual',
  'document_evidence',
] as const;
export type TxSource = (typeof TX_SOURCE_VALUES)[number];

export const LINK_TYPE_VALUES = [
  'payment',
  'refund',
  'fee',
  'fx_difference',
  'platform_payout',
  'offset',
] as const;
export type LinkType = (typeof LINK_TYPE_VALUES)[number];

export const MATCH_METHOD_VALUES = [
  'vs_amount',
  'vs_only',
  'amount_date_counterparty',
  'card_merchant_fuzzy',
  'platform_statement',
  'manual',
  'document_evidence',
] as const;
export type MatchMethod = (typeof MATCH_METHOD_VALUES)[number];

export const DOC_LINK_KIND_VALUES = [
  'duplicate_of',
  'corrects',
  'settles',
  'supports',
  'fulfills',
  'reported_in',
  'same_period_reconciles',
] as const;
export type DocLinkKind = (typeof DOC_LINK_KIND_VALUES)[number];

export const FILING_TYPE_VALUES = [
  'DPHDP3',
  'DPHKH1',
  'DPHSHV',
  'DPFDP7_PARTIAL',
  'PODKLADY_DPFO',
  'VAT_WORKBOOK',
] as const;
export type FilingType = (typeof FILING_TYPE_VALUES)[number];

export const FILING_KIND_VALUES = ['radne', 'opravne', 'dodatecne', 'nasledne'] as const;
export type FilingKind = (typeof FILING_KIND_VALUES)[number];

export const FILING_STATE_VALUES = [
  'draft',
  'generated',
  'downloaded',
  'marked_filed',
  'superseded',
] as const;
export type FilingState = (typeof FILING_STATE_VALUES)[number];

/** imported = the user's own filed return (M05 §4.11). */
export const FILING_ORIGIN_VALUES = ['generated', 'imported'] as const;
export type FilingOrigin = (typeof FILING_ORIGIN_VALUES)[number];

export const PACKAGE_STATE_VALUES = ['draft', 'ready', 'sent', 'acknowledged'] as const;
export type PackageState = (typeof PACKAGE_STATE_VALUES)[number];

/** Every 05 §1 Postgres enum by its SQL type name, in 05 order. Used by tests and later by db checks. */
export const ENUMS = {
  vat_status: VAT_STATUS_VALUES,
  vat_period: VAT_PERIOD_VALUES,
  tax_regime: TAX_REGIME_VALUES,
  member_role: MEMBER_ROLE_VALUES,
  document_class: DOCUMENT_CLASS_VALUES,
  document_status: DOCUMENT_STATUS_VALUES,
  tax_doc_status: TAX_DOC_STATUS_VALUES,
  direction: DIRECTION_VALUES,
  line_type: LINE_TYPE_VALUES,
  vat_rate_type: VAT_RATE_TYPE_VALUES,
  vat_treatment: VAT_TREATMENT_VALUES,
  tax_effect: TAX_EFFECT_VALUES,
  field_source: FIELD_SOURCE_VALUES,
  severity: SEVERITY_VALUES,
  validation_state: VALIDATION_STATE_VALUES,
  money_account_type: MONEY_ACCOUNT_TYPE_VALUES,
  tx_source: TX_SOURCE_VALUES,
  link_type: LINK_TYPE_VALUES,
  match_method: MATCH_METHOD_VALUES,
  doc_link_kind: DOC_LINK_KIND_VALUES,
  filing_type: FILING_TYPE_VALUES,
  filing_kind: FILING_KIND_VALUES,
  filing_state: FILING_STATE_VALUES,
  filing_origin: FILING_ORIGIN_VALUES,
  package_state: PACKAGE_STATE_VALUES,
} as const;

export type EnumName = keyof typeof ENUMS;

/** Narrows an unknown string to a member of the named enum (for parsing DB rows and inputs). */
export function isEnumValue<N extends EnumName>(
  name: N,
  value: string,
): value is (typeof ENUMS)[N][number] {
  return (ENUMS[name] as readonly string[]).includes(value);
}
```

Command: `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`
Expected: no `error TS` lines.

### Step 4: edit `packages/domain/src/index.ts`

Anchor (must exist verbatim):

```ts
export const packageName = '@shoebox/domain' as const;
```

Insert these three lines directly after the anchor line (before any `money` line, so the exports stay sorted: clock, dates, enums, money):

```ts
export * from './clock/index';
export * from './dates/index';
export * from './enums/index';
```

Do not change any other line.

Command: `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`
Expected: no `error TS` lines.

### Step 5: create `packages/domain/test/enums.test.ts`

The tests are the spec: implement until they pass; do not edit the test file. The SQL block must stay exactly as given (it is 05 §1 verbatim).

```ts
import { describe, expect, expectTypeOf, it } from 'vitest';
import { ENUMS, type FilingKind, isEnumValue, type VatStatus } from '../src/index';

// Pasted verbatim from docs/v3/05-data-model.md §1 Enums. If 05 changes, paste the new block here.
const SQL_05_ENUMS = `
create type vat_status         as enum ('neplatce','identifikovana_osoba','platce');
create type vat_period         as enum ('monthly','quarterly');
create type tax_regime         as enum ('danova_evidence','pausalni_vydaje','pausalni_dan','ucetnictvi');
create type member_role        as enum ('owner','member','accountant','viewer');
create type document_class     as enum ('received_invoice','received_receipt','received_credit_note','received_advance_tax_doc',
  'received_proforma','issued_invoice','issued_credit_note','platform_statement','settlement_statement','order_confirmation',
  'delivery_note','bank_statement','government_filing','contract','other_supporting','non_document','unknown');
create type document_status    as enum ('received','splitting','classifying','extracting','validating','categorizing',
  'needs_review','ready','finalized','supporting','duplicate','failed');
  -- 'supporting' = kept and linked, never booked (all non-bookable classes, 04 §2.4). Renamed from 'rejected' on 2026-10-18.
create type tax_doc_status     as enum ('full_tax_document','simplified_tax_document','not_tax_document','foreign_document','unknown');
create type direction          as enum ('in','out');             -- in = expense side (received), out = income side (issued)
create type line_type          as enum ('item','discount','shipping','fee','rounding','advance_deduction','deposit','text');
create type vat_rate_type      as enum ('standard','reduced','zero','none');
create type vat_treatment      as enum ('rcv_domestic_vat','rcv_domestic_no_vat','rcv_eu_service_reverse_charge',
  'rcv_non_eu_service_reverse_charge','rcv_eu_goods_acquisition','rcv_domestic_reverse_charge','rcv_import_customs',
  'rcv_foreign_vat_charged','rcv_out_of_scope','iss_domestic_vat','iss_eu_service','iss_eu_goods','iss_non_eu_service',
  'iss_export_goods','iss_domestic_reverse_charge','iss_exempt','iss_no_vat');
create type tax_effect         as enum ('taxable_income','non_taxable_income','deductible_expense','non_deductible_expense',
  'asset','pass_through','transfer','tax_or_insurance_payment','private');
create type field_source       as enum ('isdoc','qr','pdf_text','template','llm','llm_escalated','registry','rule','vendor_memory','user','derived');
  -- typed (manual entry) and spreadsheet-imported values are 'user' (04 §2.2a)
create type severity           as enum ('blocking','warning','info');
create type validation_state   as enum ('open','resolved','dismissed');
create type money_account_type as enum ('bank','cash','card','platform');
create type tx_source          as enum ('statement_file','email_notice','bank_api','manual','document_evidence');
create type link_type          as enum ('payment','refund','fee','fx_difference','platform_payout','offset');
create type match_method       as enum ('vs_amount','vs_only','amount_date_counterparty','card_merchant_fuzzy',
  'platform_statement','manual','document_evidence');
create type doc_link_kind      as enum ('duplicate_of','corrects','settles','supports','fulfills','reported_in','same_period_reconciles');
create type filing_type        as enum ('DPHDP3','DPHKH1','DPHSHV','DPFDP7_PARTIAL','PODKLADY_DPFO','VAT_WORKBOOK');
create type filing_kind        as enum ('radne','opravne','dodatecne','nasledne');
create type filing_state       as enum ('draft','generated','downloaded','marked_filed','superseded');
create type filing_origin      as enum ('generated','imported');  -- imported = the user's own filed return (M05 §4.11)
create type package_state      as enum ('draft','ready','sent','acknowledged');
`;

function parse05(sql: string): Record<string, string[]> {
  const withoutComments = sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
  const out: Record<string, string[]> = {};
  for (const m of withoutComments.matchAll(/create type\s+(\w+)\s+as enum\s*\(([^)]*)\)/g)) {
    const name = m[1] ?? '';
    out[name] = [...(m[2] ?? '').matchAll(/'([^']*)'/g)].map((v) => v[1] ?? '');
  }
  return out;
}

const expected = parse05(SQL_05_ENUMS);

describe('enums mirror 05 §1', () => {
  it('parses all 25 enums from the 05 block', () => {
    expect(Object.keys(expected)).toHaveLength(25);
  });

  it('has exactly the 05 enum names, in 05 order', () => {
    expect(Object.keys(ENUMS)).toEqual(Object.keys(expected));
  });

  for (const [name, values] of Object.entries(expected)) {
    it(`${name} has the 05 values in 05 order`, () => {
      expect([...ENUMS[name as keyof typeof ENUMS]]).toEqual(values);
    });
  }

  it('unions are derived from the value lists', () => {
    expectTypeOf<VatStatus>().toEqualTypeOf<'neplatce' | 'identifikovana_osoba' | 'platce'>();
    expectTypeOf<FilingKind>().toEqualTypeOf<'radne' | 'opravne' | 'dodatecne' | 'nasledne'>();
  });

  it('isEnumValue narrows only members of the named enum', () => {
    expect(isEnumValue('document_status', 'supporting')).toBe(true);
    expect(isEnumValue('document_status', 'rejected')).toBe(false);
    expect(isEnumValue('direction', 'in')).toBe(true);
    expect(isEnumValue('direction', 'IN')).toBe(false);
  });
});
```

Command: `pnpm --filter @shoebox/domain test -- test/enums.test.ts 2>&1 | tail -30`
Expected: `Tests  29 passed (29)`.

### Step 6: create `packages/domain/test/dates.test.ts`

The tests are the spec: implement until they pass; do not edit the test file.

```ts
import { describe, expect, it } from 'vitest';
import {
  addDays,
  compareLegalDates,
  fixedClock,
  InvalidLegalDateError,
  isLegalDate,
  LEGAL_TIME_ZONE,
  type LegalDate,
  parseLegalDate,
  pragueDateOf,
  pragueToday,
} from '../src/index';

const d = (s: string): LegalDate => parseLegalDate(s);

describe('fixedClock', () => {
  it('returns the instant it was built with', () => {
    expect(fixedClock('2026-10-18T22:30:00Z').now()).toBe(Date.UTC(2026, 9, 18, 22, 30));
    expect(fixedClock(0).now()).toBe(0);
  });

  it('rejects an invalid instant', () => {
    expect(() => fixedClock('not a date')).toThrow(RangeError);
    expect(() => fixedClock(Number.NaN)).toThrow(RangeError);
  });
});

describe('pragueToday', () => {
  it('uses Europe/Prague', () => {
    expect(LEGAL_TIME_ZONE).toBe('Europe/Prague');
  });

  it('2026-10-18T22:30Z is already 2026-10-19 in Prague (CEST, UTC+2)', () => {
    expect(pragueToday(fixedClock('2026-10-18T22:30:00Z'))).toBe('2026-10-19');
    expect(pragueToday(fixedClock('2026-10-18T21:59:59Z'))).toBe('2026-10-18');
  });

  it('winter time is UTC+1', () => {
    expect(pragueToday(fixedClock('2026-01-15T22:59:59Z'))).toBe('2026-01-15');
    expect(pragueToday(fixedClock('2026-01-15T23:00:00Z'))).toBe('2026-01-16');
  });

  it('spring change day 2026-03-29 (clocks go forward at 02:00 CET)', () => {
    expect(pragueToday(fixedClock('2026-03-28T22:59:59Z'))).toBe('2026-03-28');
    expect(pragueToday(fixedClock('2026-03-28T23:00:00Z'))).toBe('2026-03-29');
    expect(pragueToday(fixedClock('2026-03-29T21:59:59Z'))).toBe('2026-03-29');
    expect(pragueToday(fixedClock('2026-03-29T22:00:00Z'))).toBe('2026-03-30');
  });

  it('autumn change day 2026-10-25 (clocks go back at 03:00 CEST)', () => {
    expect(pragueToday(fixedClock('2026-10-24T21:59:59Z'))).toBe('2026-10-24');
    expect(pragueToday(fixedClock('2026-10-24T22:00:00Z'))).toBe('2026-10-25');
    expect(pragueToday(fixedClock('2026-10-25T22:59:59Z'))).toBe('2026-10-25');
    expect(pragueToday(fixedClock('2026-10-25T23:00:00Z'))).toBe('2026-10-26');
  });

  it('new year in Prague comes an hour before UTC', () => {
    expect(pragueDateOf(Date.UTC(2026, 11, 31, 23, 0))).toBe('2027-01-01');
    expect(pragueDateOf(Date.UTC(2026, 11, 31, 22, 59, 59))).toBe('2026-12-31');
  });
});

describe('LegalDate parse', () => {
  it('accepts real calendar dates', () => {
    expect(parseLegalDate('2026-10-19')).toBe('2026-10-19');
    expect(parseLegalDate('2024-02-29')).toBe('2024-02-29');
    expect(parseLegalDate('2000-02-29')).toBe('2000-02-29');
    expect(parseLegalDate('0001-01-01')).toBe('0001-01-01');
    expect(parseLegalDate('9999-12-31')).toBe('9999-12-31');
  });

  it.each([
    '2026-02-29',
    '1900-02-29',
    '2026-04-31',
    '2026-13-01',
    '2026-00-10',
    '2026-10-00',
    '0000-01-01',
    '2026-1-01',
    '2026-10-19T00:00',
    ' 2026-10-19',
    '19.10.2026',
    '',
  ])('rejects %j', (value) => {
    expect(isLegalDate(value)).toBe(false);
    expect(() => parseLegalDate(value)).toThrow(InvalidLegalDateError);
  });

  it('names the bad value in the error', () => {
    expect(() => parseLegalDate('2026-02-30')).toThrow('Not a legal date (YYYY-MM-DD): 2026-02-30');
  });
});

describe('LegalDate compare', () => {
  it('orders dates', () => {
    expect(compareLegalDates(d('2026-10-18'), d('2026-10-19'))).toBe(-1);
    expect(compareLegalDates(d('2026-10-19'), d('2026-10-19'))).toBe(0);
    expect(compareLegalDates(d('2027-01-01'), d('2026-12-31'))).toBe(1);
  });

  it('sorts an array chronologically', () => {
    const dates = ['2026-12-31', '2025-01-01', '2026-02-28'].map(d);
    expect([...dates].sort(compareLegalDates)).toEqual(['2025-01-01', '2026-02-28', '2026-12-31']);
  });
});

describe('LegalDate addDays', () => {
  it('moves within and across months and years', () => {
    expect(addDays(d('2026-10-18'), 0)).toBe('2026-10-18');
    expect(addDays(d('2026-10-18'), 1)).toBe('2026-10-19');
    expect(addDays(d('2026-10-31'), 1)).toBe('2026-11-01');
    expect(addDays(d('2026-12-31'), 1)).toBe('2027-01-01');
    expect(addDays(d('2027-01-01'), -1)).toBe('2026-12-31');
    expect(addDays(d('2026-10-25'), 7)).toBe('2026-11-01');
  });

  it('handles leap years', () => {
    expect(addDays(d('2024-02-28'), 1)).toBe('2024-02-29');
    expect(addDays(d('2026-02-28'), 1)).toBe('2026-03-01');
    expect(addDays(d('2000-02-28'), 1)).toBe('2000-02-29');
    expect(addDays(d('2100-02-28'), 1)).toBe('2100-03-01');
    expect(addDays(d('2024-03-01'), -1)).toBe('2024-02-29');
  });

  it('handles long spans', () => {
    expect(addDays(d('2026-01-01'), 365)).toBe('2027-01-01');
    expect(addDays(d('2024-01-01'), 366)).toBe('2025-01-01');
    expect(addDays(d('1970-01-01'), 20_744)).toBe('2026-10-18');
    expect(addDays(d('2026-10-18'), -20_744)).toBe('1970-01-01');
  });

  it('agrees with Date.UTC for every day of 2023-2028', () => {
    let date = d('2023-01-01');
    for (let i = 1; i <= 6 * 366; i++) {
      date = addDays(date, 1);
      const utc = new Date(Date.UTC(2023, 0, 1 + i)).toISOString().slice(0, 10);
      expect(date).toBe(utc);
    }
  });

  it('rejects non-integer days and results outside 0001-9999', () => {
    expect(() => addDays(d('2026-10-18'), 1.5)).toThrow(RangeError);
    expect(() => addDays(d('9999-12-31'), 1)).toThrow(RangeError);
    expect(() => addDays(d('0001-01-01'), -1)).toThrow(RangeError);
  });
});
```

Command: `pnpm --filter @shoebox/domain test -- test/dates.test.ts 2>&1 | tail -30`
Expected: `Tests  29 passed (29)`.

### Step 7: checks (no file changes)

Run the four commands in §6. If `pnpm lint` reports only "Organize imports" in `packages/domain/src/index.ts`, put the `export *` lines in alphabetical order of their path and re-run (that is still step 4's file, so commit as `0005 step 7`). Any other lint error: stop (§8).

## 5. Do not touch

- `packages/domain/src/money/**`, `packages/domain/test/money*` (brief 0004), `packages/domain/package.json`, any config (`biome.json`, `tools/biome-plugins/**`, `.dependency-cruiser.cjs`, `vitest.config.ts`, `tsconfig*.json`), `pnpm-lock.yaml`, `docs/v3/**`.
- Hard rules: no `Date.now()` or `new Date()` in `packages/domain` (pass a `Clock`); no `Number(...)`/`parseFloat`; no new dependency (no date library); never push to `main`.

## 6. Commands

1. `pnpm --filter @shoebox/domain test 2>&1 | tail -30` → all test files pass (59 tests if 0004 is not merged yet; more if it is), 0 failed.
2. `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30` → no `error TS` lines.
3. `pnpm lint 2>&1 | tail -30` → exits 0, no errors.
4. `pnpm exec vitest run --project unit --coverage --coverage.include='packages/domain/src/**' packages/domain 2>&1 | tail -12` → `Lines` ≥ 90 % (100 % without 0004).

## 7. Acceptance

- [ ] `packages/domain/src/enums/index.ts` has every 05 §1 enum (25); `packages/domain/test/enums.test.ts` compares each union's value list with the 05 list (29 tests pass). (Ticket text names `src/enums.ts`; the orchestrator set `src/enums/index.ts`.)
- [ ] `packages/domain/test/dates.test.ts` passes: `pragueToday(clock)` at `2026-10-18T22:30Z` is `2026-10-19`; spring (2026-03-29) and autumn (2026-10-25) DST change days; `LegalDate` parse/compare/addDays.
- [ ] `Clock` is injected (`src/clock/index.ts`); no `Date.now()`/`new Date()` in `packages/domain/src` (`pnpm lint` clean).
- [ ] Domain coverage ≥ 90 % lines (§6 command 4).
- Not in this ticket: the text-valued canonical lists of 04 §9 (`review_questions.kind`, `obligations.kind`, ...) and `entry_mode`; a system `Clock` (it needs `Date.now()`, so it lives outside `packages/domain`, added by the first app/worker ticket that needs it).

## 8. Stop and ask

Stop, and write the report, if:

- the step 4 anchor is not found;
- a test fails twice, or a test in this brief seems wrong (for example the Node ICU data gives another Prague date: report the failing line, do not change the test);
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a new dependency seems needed;
- a file outside §3 needs a change;
- §5 would be touched;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy.

## 9. Report

Write `docs/tasks/0005-report.md` (600 tokens at most), set `Status: review` in this file, commit as `0005 report`, then push: `git push -u origin task/0005-enums-dates-clock 2>&1 | tail -5`. The orchestrator opens and merges the PR. The report has:

1. The files changed (`git diff --stat origin/phase/0 | tail -10`).
2. Each §6 command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations.
5. Questions.
6. Owner steps left.

## Risk list (for the reviewer)

- `packages/domain/src/enums/index.ts`: every value and its order must equal 05 §1 (the test enforces it against the pasted block; check the pasted block in `test/enums.test.ts` is verbatim 05 lines 29–63).
- `packages/domain/src/dates/index.ts`: `addDays` integer calendar arithmetic and `pragueDateOf` (Intl with `Europe/Prague`); a wrong "today" shifts VAT periods and deadlines.
- `packages/domain/src/index.ts`: export order merges cleanly with 0004's `money` line.
- Future drift: a 05 §1 change now needs three edits (migration, 05, `enums/index.ts` plus the pasted test block).

## Owner steps

None. The orchestrator opens and merges the PR into `phase/0`.
