# 0038b: Prototype deterministic checks (M03 subset) with Czech/English messages

Status: review
Ticket: PROTO-01 (part b of a/b/c/d) | Depends on: 0038a (same branch) | Base commit: head of task/proto-scanner after 0038a | Branch: task/proto-scanner | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

`packages/validation` exports `runProtoChecks()` (VAT lines sum to the total, each VAT = `round2(base × rate / 100)` with the repo's `vatForRate`, IČO modulo 11, DIČ format, dates plausible: issue/DUZP not in the future, due ≥ issue) and `renderProtoChecks()` that turns each pass/warn/fail into a Czech (or English) sentence from `packages/i18n`. The 56 `proto.*` message keys for the checks, the page and the CLI land in `cs.json` and `en.json`.

## 2. Context

Rules (AGENTS.md, rules.md), pasted:

- Hard rule 1: "Money is never a float (`Money`, ADR-007). Rates, limits … live only in `packages/domain/rules`." The checks parse every amount with `Money.parse`, compare with `Money`, round with `vatForRate` / `roundingLineAllowed` from `@shoebox/domain`, and read the allowed VAT rates from `createCzRules().at(issueDate).get('vat.rates')` (21 / 12 / 0). No rate or tolerance literal other than the ADR-007 product tolerances `1.00` (rounding line) and `0.01` (one haléř on a VAT line).
- Hard rule 6: every string through `packages/i18n`. A check result carries a `MessageKey` and params; `renderProtoChecks(results, locale)` renders with `createT(locale)`. The i18n catalog test requires: `en` has exactly the `cs` keys, keys match `^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$`, every message is valid ICU (no stray apostrophes).
- Hard rule 7 / workspace links: `packages/validation` gains two **workspace** dependencies (`@shoebox/domain`, `@shoebox/i18n`), no third-party package. pnpm records workspace links in `pnpm-lock.yaml` (importers section), so the lockfile changes by exactly the 7 lines in step 1 and `pnpm install --frozen-lockfile` must pass afterwards.
- M12 §4.3: `packages/validation/src/**` has a 90 % line-coverage gate; the brief writer measured 99 % with the test below.
- Checksum (IČO, ČSÚ): weights 8,7,6,5,4,3,2 over the first seven digits, `r = sum mod 11`, check digit `1` when `r = 0`, `0` when `r = 1`, else `11 − r`.
- `ProtoCheckInput` is structural: `ProtoExtraction` (0038a) is assignable to it, so 0038c passes the extraction straight in.

Anchors (`task/proto-scanner` after 0038a):

`pnpm-lock.yaml` lines 359–360 (step 1):

```yaml
  packages/validation:
    devDependencies:
```

`packages/i18n/messages/cs.json`, the last key (step 2):

```json
  "tax_doc_status.not_tax_document.why": "Na dokladu stojí „{phrase}“. Pro daň z příjmů platí, pro DPH ne."
}
```

`packages/i18n/messages/en.json`, the last key (step 2):

```json
  "tax_doc_status.not_tax_document.why": "The document says “{phrase}”. It counts for income tax, not for VAT."
}
```

All code below was run by the brief writer on `origin/phase/0` plus 0038a: `tsc` clean for validation, `biome ci` clean, `pnpm --filter @shoebox/validation test` 11 passed (2 files), `pnpm --filter @shoebox/i18n test` 24 passed, `pnpm install --frozen-lockfile` OK, `pnpm depcruise` clean, `pii_guard` OK.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/validation/package.json` | replace | two workspace deps |
| `pnpm-lock.yaml` | edit | 7 lines (importer) |
| `packages/i18n/messages/cs.json` | edit | 56 keys appended |
| `packages/i18n/messages/en.json` | edit | 56 keys appended |
| `packages/validation/src/proto-checks/checks.ts` | create | the checks |
| `packages/validation/src/index.ts` | replace | export |
| `packages/validation/test/proto-checks.test.ts` | create | 10 tests |

No other file may change.

## 4. Steps

Line map (read only the range of the step you are on):
- Step 1 code: lines 78–116
- Step 2 code: lines 124–244
- Step 3 code: lines 250–550
- Step 4 code: lines 558–767
- Step 5: commands only

Setup: you are on `task/proto-scanner` after 0038a (`git log --oneline -1` shows `0038a step 6` or `0038a step 5`; if not, STOP). `pnpm install` is done.

Rules for every step: write each new file with **one Write call**, contents exactly as given (they are Biome-formatted; do not reformat). Do not re-read a file you just wrote. Do not explore other files. After the step's command shows the expected result, commit: `git add -A && git commit -qm "0038b step k" && git log --oneline -1`. All commands run from the repo root.

### Step 1: replace `packages/validation/package.json`, edit `pnpm-lock.yaml`

`packages/validation/package.json` (replace the whole file):

```json
{
  "name": "@shoebox/validation",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "Rule catalog (M03): each rule a pure function plus metadata.",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    }
  },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@shoebox/domain": "workspace:*",
    "@shoebox/i18n": "workspace:*"
  },
  "devDependencies": {
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

`pnpm-lock.yaml`: find the anchor with `grep -nF "  packages/validation:" pnpm-lock.yaml` (one hit, line 359; the next line is `    devDependencies:`). Insert these 7 lines between those two lines (4-space indent under `packages/validation:`, exactly as shown):

```yaml
    dependencies:
      '@shoebox/domain':
        specifier: workspace:*
        version: link:../domain
      '@shoebox/i18n':
        specifier: workspace:*
        version: link:../i18n
```

Command: `pnpm install --frozen-lockfile 2>&1 | tail -2` → `Done in …` with no `ERR_PNPM_OUTDATED_LOCKFILE` (if it fails, the 7 lines are misplaced or mis-indented: fix once, then STOP if it fails again); `git diff --stat -- pnpm-lock.yaml | tail -1` → `1 file changed, 7 insertions(+)`. Commit.

### Step 2: edit `packages/i18n/messages/cs.json` and `packages/i18n/messages/en.json`

In **cs.json**, find the anchor with `grep -nF '"tax_doc_status.not_tax_document.why"' packages/i18n/messages/cs.json` (one hit, the last key before the closing `}`). Replace that one line with the following lines (the first is the same line with a trailing comma; the closing `}` stays):

```json
  "tax_doc_status.not_tax_document.why": "Na dokladu stojí „{phrase}“. Pro daň z příjmů platí, pro DPH ne.",
  "proto.check.vat_sum.pass": "Součet základů a DPH odpovídá celkové částce {total}.",
  "proto.check.vat_sum.warn": "Součet základů a DPH ({sum}) se liší od celkové částky {total} o {diff}; v toleranci zaokrouhlení.",
  "proto.check.vat_sum.fail": "Součet základů a DPH ({sum}) nesedí na celkovou částku {total} (rozdíl {diff}).",
  "proto.check.vat_rate_math.pass": "DPH {rate} %: {vat} odpovídá základu {base}.",
  "proto.check.vat_rate_math.warn": "DPH {rate} %: na dokladu {vat}, výpočet ze základu {base} dává {expected} (rozdíl do 0,01).",
  "proto.check.vat_rate_math.fail": "DPH {rate} %: na dokladu {vat}, výpočet ze základu {base} dává {expected}.",
  "proto.check.vat_rate_math.unknown_rate": "Sazba {rate} % není platná česká sazba DPH k {date}.",
  "proto.check.vat_rate_math.invalid": "Řádek DPH se sazbou {rate} nejde přečíst.",
  "proto.check.ico_checksum.pass": "IČO {ico} má platný kontrolní součet.",
  "proto.check.ico_checksum.fail": "IČO {ico} nemá platný kontrolní součet (8 číslic, modulo 11).",
  "proto.check.dic_format.pass": "DIČ {dic} má správný tvar.",
  "proto.check.dic_format.warn": "{dic} je zahraniční DIČ; tvar se nekontroluje.",
  "proto.check.dic_format.fail": "DIČ {dic} nemá tvar CZ + 8 až 10 číslic.",
  "proto.check.date.pass": "{field} {date} je věrohodné.",
  "proto.check.date.fail_invalid": "{field} není platné datum.",
  "proto.check.date.fail_future": "{field} {date} je v budoucnosti (dnes {today}).",
  "proto.check.date.fail_due": "Splatnost {due} je před datem vystavení {issue}.",
  "proto.field.class": "Druh dokladu",
  "proto.field.supplier_name": "Dodavatel",
  "proto.field.supplier_ico": "IČO dodavatele",
  "proto.field.supplier_dic": "DIČ dodavatele",
  "proto.field.document_number": "Číslo dokladu",
  "proto.field.variable_symbol": "Variabilní symbol",
  "proto.field.issue_date": "Datum vystavení",
  "proto.field.duzp": "DUZP",
  "proto.field.due_date": "Datum splatnosti",
  "proto.field.currency": "Měna",
  "proto.field.total_net": "Základ celkem",
  "proto.field.total_vat": "DPH celkem",
  "proto.field.total_gross": "Celkem k úhradě",
  "proto.field.vat_lines": "Rekapitulace DPH",
  "proto.field.account": "Účet",
  "proto.field.iban": "IBAN",
  "proto.field.not_tax_document": "Není daňový doklad",
  "proto.page.title": "Shoebox – prototyp čtení dokladů",
  "proto.page.subtitle": "Nahrajte PDF nebo fotku dokladu. Nic se neukládá: soubor zůstává jen v paměti.",
  "proto.page.warning": "Prototyp používá Gemini na bezplatném tarifu: Google může vstupy použít ke zlepšování svých produktů. Nahrávejte jen anonymizované testovací doklady (golden-v1), ne skutečné.",
  "proto.page.drop": "Přetáhněte sem soubor (PDF, PNG, JPG) nebo",
  "proto.page.pick": "vyberte soubor",
  "proto.page.processing": "Čtu doklad…",
  "proto.page.fields": "Vytěžené údaje",
  "proto.page.checks": "Kontroly",
  "proto.page.no_checks": "Žádná kontrola se neuplatnila.",
  "proto.page.usage": "Model {model}: {input} tokenů na vstupu, {output} na výstupu, {latency} ms.",
  "proto.page.error_type": "Nepodporovaný typ souboru. Nahrajte PDF, PNG nebo JPG.",
  "proto.page.error_size": "Soubor je větší než {mb} MB.",
  "proto.page.error_llm": "Čtení selhalo: {detail}",
  "proto.page.yes": "ano",
  "proto.page.no": "ne",
  "proto.page.empty": "—",
  "proto.cli.no_key": "Chybí {keyEnv}. Vložte klíč do souboru .env.local v kořeni repozitáře (řádek {keyEnv}=...) a spusťte znovu. / {keyEnv} is not set. Put the key into .env.local at the repo root (line {keyEnv}=...) and run again.",
  "proto.cli.cost": "Tokeny: {input} vstup, {output} výstup; cena přibližně {cost} USD ({cached} odpovědí z cache).",
  "proto.cli.table_header": "Pole | správně | hodnoceno | přesnost",
  "proto.cli.mismatches": "Neshody",
  "proto.cli.checks": "Kontroly (pass/warn/fail)",
  "proto.cli.document_failed": "{file}: čtení selhalo ({detail})"
```

In **en.json**, find the anchor with `grep -nF '"tax_doc_status.not_tax_document.why"' packages/i18n/messages/en.json` (one hit, the last key). Replace that one line with the following lines (the first is the same line with a trailing comma; the closing `}` stays):

```json
  "tax_doc_status.not_tax_document.why": "The document says “{phrase}”. It counts for income tax, not for VAT.",
  "proto.check.vat_sum.pass": "VAT bases plus VAT equal the total {total}.",
  "proto.check.vat_sum.warn": "VAT bases plus VAT ({sum}) differ from the total {total} by {diff}; within rounding tolerance.",
  "proto.check.vat_sum.fail": "VAT bases plus VAT ({sum}) do not match the total {total} (difference {diff}).",
  "proto.check.vat_rate_math.pass": "VAT {rate} %: {vat} matches base {base}.",
  "proto.check.vat_rate_math.warn": "VAT {rate} %: printed {vat}, base {base} gives {expected} (difference up to 0.01).",
  "proto.check.vat_rate_math.fail": "VAT {rate} %: printed {vat}, base {base} gives {expected}.",
  "proto.check.vat_rate_math.unknown_rate": "Rate {rate} % is not a valid Czech VAT rate on {date}.",
  "proto.check.vat_rate_math.invalid": "The VAT line with rate {rate} is unreadable.",
  "proto.check.ico_checksum.pass": "IČO {ico} has a valid check digit.",
  "proto.check.ico_checksum.fail": "IČO {ico} fails the check digit (8 digits, modulo 11).",
  "proto.check.dic_format.pass": "DIČ {dic} is well formed.",
  "proto.check.dic_format.warn": "{dic} is a foreign VAT ID; its format is not checked.",
  "proto.check.dic_format.fail": "DIČ {dic} is not CZ + 8 to 10 digits.",
  "proto.check.date.pass": "{field} {date} is plausible.",
  "proto.check.date.fail_invalid": "{field} is not a valid date.",
  "proto.check.date.fail_future": "{field} {date} is in the future (today {today}).",
  "proto.check.date.fail_due": "Due date {due} is before the issue date {issue}.",
  "proto.field.class": "Document class",
  "proto.field.supplier_name": "Supplier",
  "proto.field.supplier_ico": "Supplier IČO",
  "proto.field.supplier_dic": "Supplier DIČ",
  "proto.field.document_number": "Document number",
  "proto.field.variable_symbol": "Variable symbol",
  "proto.field.issue_date": "Issue date",
  "proto.field.duzp": "DUZP",
  "proto.field.due_date": "Due date",
  "proto.field.currency": "Currency",
  "proto.field.total_net": "Net total",
  "proto.field.total_vat": "VAT total",
  "proto.field.total_gross": "Gross total",
  "proto.field.vat_lines": "VAT summary",
  "proto.field.account": "Account",
  "proto.field.iban": "IBAN",
  "proto.field.not_tax_document": "Not a tax document",
  "proto.page.title": "Shoebox – document reading prototype",
  "proto.page.subtitle": "Upload a PDF or a photo of a document. Nothing is stored: the file stays in memory only.",
  "proto.page.warning": "The prototype uses Gemini on the free tier: Google may use inputs to improve its products. Upload only anonymized test documents (golden-v1), never real ones.",
  "proto.page.drop": "Drop a file here (PDF, PNG, JPG) or",
  "proto.page.pick": "pick a file",
  "proto.page.processing": "Reading the document…",
  "proto.page.fields": "Extracted fields",
  "proto.page.checks": "Checks",
  "proto.page.no_checks": "No check applied.",
  "proto.page.usage": "Model {model}: {input} input tokens, {output} output tokens, {latency} ms.",
  "proto.page.error_type": "Unsupported file type. Upload a PDF, PNG or JPG.",
  "proto.page.error_size": "The file is larger than {mb} MB.",
  "proto.page.error_llm": "Reading failed: {detail}",
  "proto.page.yes": "yes",
  "proto.page.no": "no",
  "proto.page.empty": "—",
  "proto.cli.no_key": "{keyEnv} is not set. Put the key into .env.local at the repo root (line {keyEnv}=...) and run again.",
  "proto.cli.cost": "Tokens: {input} in, {output} out; cost about {cost} USD ({cached} answers from cache).",
  "proto.cli.table_header": "Field | correct | scored | accuracy",
  "proto.cli.mismatches": "Mismatches",
  "proto.cli.checks": "Checks (pass/warn/fail)",
  "proto.cli.document_failed": "{file}: reading failed ({detail})"
```

Command: `pnpm --filter @shoebox/i18n test 2>&1 | tail -6` → `Tests  24 passed (24)` (the catalog test checks key parity, key format and ICU validity); `grep -c '"proto\.' packages/i18n/messages/cs.json` → `56`; `grep -c '"proto\.' packages/i18n/messages/en.json` → `56`. Commit.

### Step 3: create `packages/validation/src/proto-checks/checks.ts`

```ts
/**
 * Prototype deterministic checks (M03 subset, decisions 2026-10-18 [proto]): VAT lines against
 * the total, VAT per rate against base × rate with ADR-007 rounding, IČO modulo 11, DIČ format and
 * date plausibility. Pure: Money in, pass/warn/fail with an i18n key out. VAT rates come from
 * `packages/domain/rules` (`vat.rates`), never from this file.
 */
import {
  CZK,
  compareLegalDates,
  createCzRules,
  isCurrency,
  isLegalDate,
  type LegalDate,
  Money,
  roundingLineAllowed,
  vatForRate,
} from '@shoebox/domain';
import { createT, type Locale, type MessageKey, type Params } from '@shoebox/i18n';

export const PROTO_CHECK_IDS = [
  'vat_sum',
  'vat_rate_math',
  'ico_checksum',
  'dic_format',
  'date_issue',
  'date_duzp',
  'date_due',
] as const;
export type ProtoCheckId = (typeof PROTO_CHECK_IDS)[number];

export type ProtoCheckSeverity = 'pass' | 'warn' | 'fail';

/** The fields the checks read; `ProtoExtraction` from @shoebox/extraction is assignable to it. */
export interface ProtoCheckInput {
  readonly supplier: { readonly ico: string | null; readonly dic: string | null };
  readonly dates: {
    readonly issue_date: string | null;
    readonly duzp: string | null;
    readonly due_date: string | null;
  };
  readonly currency: string | null;
  readonly totals: { readonly gross: string | null };
  readonly vat_recap: readonly {
    readonly rate_pct: string;
    readonly base: string;
    readonly vat: string;
  }[];
}

export interface ProtoCheckResult {
  readonly id: ProtoCheckId;
  readonly severity: ProtoCheckSeverity;
  readonly key: MessageKey;
  readonly params: Params;
}

export interface ProtoCheckOptions {
  /** Prague calendar date of the run (`pragueToday(clock)` or the golden set's `today`). */
  readonly today: LegalDate;
}

/** `true` for 8 digits whose last digit is the modulo-11 check digit (weights 8..2). */
export function icoChecksumValid(ico: string): boolean {
  if (!/^\d{8}$/.test(ico)) return false;
  let sum = 0;
  for (let i = 0; i < 7; i += 1) {
    sum += Number(ico[i]) * (8 - i);
  }
  const remainder = sum % 11;
  let check: number;
  if (remainder === 0) check = 1;
  else if (remainder === 1) check = 0;
  else check = 11 - remainder;
  return Number(ico[7]) === check;
}

export const DIC_CZ_RE = /^CZ\d{8,10}$/;
export const FOREIGN_VAT_ID_RE = /^[A-Z]{2}[A-Z0-9]{2,12}$/;

const DATE_FIELDS = [
  ['date_issue', 'issue_date'],
  ['date_duzp', 'duzp'],
  ['date_due', 'due_date'],
] as const;

const DATE_FIELD_LABEL: Readonly<Record<string, MessageKey>> = {
  date_issue: 'proto.field.issue_date',
  date_duzp: 'proto.field.duzp',
  date_due: 'proto.field.due_date',
};

function parseMoney(text: string, currency: string): Money | null {
  try {
    return Money.parse(text, currency);
  } catch {
    return null;
  }
}

function allowedRates(input: ProtoCheckInput, today: LegalDate): { rates: string[]; date: string } {
  const issue = input.dates.issue_date;
  const date = issue !== null && isLegalDate(issue) ? issue : today;
  try {
    const rates = createCzRules().at(date).get('vat.rates');
    return { rates: ['0', String(rates.reduced), String(rates.standard)], date };
  } catch {
    const rates = createCzRules().at(today).get('vat.rates');
    return { rates: ['0', String(rates.reduced), String(rates.standard)], date: today };
  }
}

function rateKey(rate: string): string {
  return Money.parse(rate, CZK).toFixed2();
}

function checkVat(input: ProtoCheckInput, currency: string, today: LegalDate): ProtoCheckResult[] {
  const results: ProtoCheckResult[] = [];
  if (input.vat_recap.length === 0) return results;
  const allowed = allowedRates(input, today);
  const allowedKeys = allowed.rates.map(rateKey);
  const tolerance = Money.parse('0.01', currency);
  let sum: Money | null = Money.zero(currency);
  for (const line of input.vat_recap) {
    const base = parseMoney(line.base, currency);
    const vat = parseMoney(line.vat, currency);
    const rateValid = /^\d+(\.\d+)?$/.test(line.rate_pct);
    if (base === null || vat === null || !rateValid) {
      results.push({
        id: 'vat_rate_math',
        severity: 'fail',
        key: 'proto.check.vat_rate_math.invalid',
        params: { rate: line.rate_pct },
      });
      sum = null;
      continue;
    }
    if (sum !== null) sum = sum.add(base).add(vat);
    if (!allowedKeys.includes(rateKey(line.rate_pct))) {
      results.push({
        id: 'vat_rate_math',
        severity: 'warn',
        key: 'proto.check.vat_rate_math.unknown_rate',
        params: { rate: line.rate_pct, date: allowed.date },
      });
      continue;
    }
    const expected = vatForRate(base, line.rate_pct);
    const diff = vat.subtract(expected);
    const params: Params = {
      rate: line.rate_pct,
      base: base.toFixed2(),
      vat: vat.toFixed2(),
      expected: expected.toFixed2(),
    };
    if (diff.isZero()) {
      results.push({
        id: 'vat_rate_math',
        severity: 'pass',
        key: 'proto.check.vat_rate_math.pass',
        params,
      });
    } else if (roundingLineAllowed(diff, tolerance)) {
      results.push({
        id: 'vat_rate_math',
        severity: 'warn',
        key: 'proto.check.vat_rate_math.warn',
        params,
      });
    } else {
      results.push({
        id: 'vat_rate_math',
        severity: 'fail',
        key: 'proto.check.vat_rate_math.fail',
        params,
      });
    }
  }
  const gross = input.totals.gross === null ? null : parseMoney(input.totals.gross, currency);
  if (sum !== null && gross !== null) {
    const diff = gross.subtract(sum);
    const params: Params = { total: gross.toFixed2(), sum: sum.toFixed2(), diff: diff.toFixed2() };
    if (diff.isZero()) {
      results.push({ id: 'vat_sum', severity: 'pass', key: 'proto.check.vat_sum.pass', params });
    } else if (roundingLineAllowed(diff, Money.parse('1.00', currency))) {
      results.push({ id: 'vat_sum', severity: 'warn', key: 'proto.check.vat_sum.warn', params });
    } else {
      results.push({ id: 'vat_sum', severity: 'fail', key: 'proto.check.vat_sum.fail', params });
    }
  }
  return results;
}

function checkIdentifiers(input: ProtoCheckInput): ProtoCheckResult[] {
  const results: ProtoCheckResult[] = [];
  const { ico, dic } = input.supplier;
  if (ico !== null) {
    const ok = icoChecksumValid(ico);
    results.push({
      id: 'ico_checksum',
      severity: ok ? 'pass' : 'fail',
      key: ok ? 'proto.check.ico_checksum.pass' : 'proto.check.ico_checksum.fail',
      params: { ico },
    });
  }
  if (dic !== null) {
    let severity: ProtoCheckSeverity = 'fail';
    let key: MessageKey = 'proto.check.dic_format.fail';
    if (DIC_CZ_RE.test(dic)) {
      severity = 'pass';
      key = 'proto.check.dic_format.pass';
    } else if (!dic.startsWith('CZ') && FOREIGN_VAT_ID_RE.test(dic)) {
      severity = 'warn';
      key = 'proto.check.dic_format.warn';
    }
    results.push({ id: 'dic_format', severity, key, params: { dic } });
  }
  return results;
}

function checkDates(input: ProtoCheckInput, today: LegalDate): ProtoCheckResult[] {
  const results: ProtoCheckResult[] = [];
  const issue = input.dates.issue_date;
  for (const [id, field] of DATE_FIELDS) {
    const value = input.dates[field];
    if (value === null) continue;
    if (!isLegalDate(value)) {
      results.push({
        id,
        severity: 'fail',
        key: 'proto.check.date.fail_invalid',
        params: { field: id },
      });
      continue;
    }
    if (id !== 'date_due' && compareLegalDates(value, today) > 0) {
      results.push({
        id,
        severity: 'fail',
        key: 'proto.check.date.fail_future',
        params: { field: id, date: value, today },
      });
      continue;
    }
    if (
      id === 'date_due' &&
      issue !== null &&
      isLegalDate(issue) &&
      compareLegalDates(value, issue) < 0
    ) {
      results.push({
        id,
        severity: 'fail',
        key: 'proto.check.date.fail_due',
        params: { field: id, due: value, issue },
      });
      continue;
    }
    results.push({
      id,
      severity: 'pass',
      key: 'proto.check.date.pass',
      params: { field: id, date: value },
    });
  }
  return results;
}

/** Runs every applicable check; a field that is absent (null) produces no result for its check. */
export function runProtoChecks(
  input: ProtoCheckInput,
  options: ProtoCheckOptions,
): ProtoCheckResult[] {
  const currency = input.currency !== null && isCurrency(input.currency) ? input.currency : CZK;
  return [
    ...checkVat(input, currency, options.today),
    ...checkIdentifiers(input),
    ...checkDates(input, options.today),
  ];
}

export interface RenderedProtoCheck extends ProtoCheckResult {
  readonly message: string;
}

/** Adds the human message in `locale` (cs default); `field` params become translated labels. */
export function renderProtoChecks(
  results: readonly ProtoCheckResult[],
  locale: Locale = 'cs',
): RenderedProtoCheck[] {
  const t = createT(locale);
  return results.map((result) => {
    const label = DATE_FIELD_LABEL[result.id];
    const params =
      label === undefined || typeof result.params.field !== 'string'
        ? result.params
        : { ...result.params, field: t(label) };
    return { ...result, message: t(result.key, params) };
  });
}
```

Command: `pnpm --filter @shoebox/validation typecheck 2>&1 | tail -3` → no errors. Commit.

### Step 4: replace `packages/validation/src/index.ts`, create the test

`packages/validation/src/index.ts` (replace the whole 1-line file):

```ts
export const packageName = '@shoebox/validation' as const;
export * from './proto-checks/checks';
```

`packages/validation/test/proto-checks.test.ts`:

```ts
import { parseLegalDate } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import {
  DIC_CZ_RE,
  FOREIGN_VAT_ID_RE,
  icoChecksumValid,
  type ProtoCheckInput,
  type ProtoCheckResult,
  renderProtoChecks,
  runProtoChecks,
} from '../src/index';

// Synthetic values only (hard rule 4). IČO 25596641 and 00006947 are textbook valid checksums.
const TODAY = parseLegalDate('2026-10-18');

function input(overrides: Partial<ProtoCheckInput> = {}): ProtoCheckInput {
  return {
    supplier: { ico: '25596641', dic: 'CZ25596641' },
    dates: { issue_date: '2026-09-12', duzp: '2026-08-31', due_date: '2026-09-26' },
    currency: 'CZK',
    totals: { gross: '12960.84' },
    vat_recap: [{ rate_pct: '21', base: '10711.44', vat: '2249.40' }],
    ...overrides,
  };
}

function byId(
  results: readonly ProtoCheckResult[],
  id: ProtoCheckResult['id'],
): ProtoCheckResult[] {
  return results.filter((result) => result.id === id);
}

describe('icoChecksumValid', () => {
  it('accepts valid check digits, including the remainder 0 and 1 cases', () => {
    expect(icoChecksumValid('25596641')).toBe(true);
    expect(icoChecksumValid('00006947')).toBe(true);
    expect(icoChecksumValid('27082440')).toBe(true);
    expect(icoChecksumValid('21737959')).toBe(true);
  });

  it('rejects a wrong digit, a wrong length and letters', () => {
    expect(icoChecksumValid('25596642')).toBe(false);
    expect(icoChecksumValid('2559664')).toBe(false);
    expect(icoChecksumValid('2559664A')).toBe(false);
  });
});

describe('runProtoChecks', () => {
  it('passes a consistent domestic invoice', () => {
    const results = runProtoChecks(input(), { today: TODAY });
    expect(results.map((result) => [result.id, result.severity])).toEqual([
      ['vat_rate_math', 'pass'],
      ['vat_sum', 'pass'],
      ['ico_checksum', 'pass'],
      ['dic_format', 'pass'],
      ['date_issue', 'pass'],
      ['date_duzp', 'pass'],
      ['date_due', 'pass'],
    ]);
    expect(byId(results, 'vat_sum')[0]?.params).toEqual({
      total: '12960.84',
      sum: '12960.84',
      diff: '0.00',
    });
  });

  it('warns within the 1.00 rounding tolerance and fails beyond it', () => {
    const warn = runProtoChecks(input({ totals: { gross: '12961.00' } }), { today: TODAY });
    expect(byId(warn, 'vat_sum')[0]).toMatchObject({ severity: 'warn', params: { diff: '0.16' } });
    const fail = runProtoChecks(input({ totals: { gross: '13000.00' } }), { today: TODAY });
    expect(byId(fail, 'vat_sum')[0]).toMatchObject({ severity: 'fail', params: { diff: '39.16' } });
  });

  it('checks VAT per rate with round2(base × rate / 100), 0.01 warn band, unknown rates', () => {
    const results = runProtoChecks(
      input({
        totals: { gross: '0.00' },
        vat_recap: [
          { rate_pct: '21', base: '96.66', vat: '20.29' },
          { rate_pct: '21', base: '96.66', vat: '20.30' },
          { rate_pct: '12', base: '100.00', vat: '21.00' },
          { rate_pct: '15', base: '100.00', vat: '15.00' },
          { rate_pct: '0', base: '90.00', vat: '0.00' },
        ],
      }),
      { today: TODAY },
    );
    const math = byId(results, 'vat_rate_math');
    expect(math.map((result) => [result.severity, result.key])).toEqual([
      ['warn', 'proto.check.vat_rate_math.warn'],
      ['pass', 'proto.check.vat_rate_math.pass'],
      ['fail', 'proto.check.vat_rate_math.fail'],
      ['warn', 'proto.check.vat_rate_math.unknown_rate'],
      ['pass', 'proto.check.vat_rate_math.pass'],
    ]);
    expect(math[0]?.params).toEqual({ rate: '21', base: '96.66', vat: '20.29', expected: '20.30' });
    expect(math[3]?.params).toEqual({ rate: '15', date: '2026-09-12' });
    expect(byId(results, 'vat_sum')[0]?.severity).toBe('fail');
  });

  it('skips VAT checks without lines, and flags an unreadable line without a total check', () => {
    const none = runProtoChecks(input({ vat_recap: [] }), { today: TODAY });
    expect(byId(none, 'vat_sum')).toEqual([]);
    expect(byId(none, 'vat_rate_math')).toEqual([]);
    const broken = runProtoChecks(
      input({ vat_recap: [{ rate_pct: 'x', base: '1.00', vat: '0.21' }] }),
      { today: TODAY },
    );
    expect(byId(broken, 'vat_rate_math')[0]).toMatchObject({
      severity: 'fail',
      key: 'proto.check.vat_rate_math.invalid',
    });
    expect(byId(broken, 'vat_sum')).toEqual([]);
    const noGross = runProtoChecks(input({ totals: { gross: null } }), { today: TODAY });
    expect(byId(noGross, 'vat_sum')).toEqual([]);
  });

  it('falls back to CZK math for an unknown currency and uses the rules for the issue date', () => {
    const results = runProtoChecks(
      input({ currency: 'ZZZZ', dates: { issue_date: '2024-01-01', duzp: null, due_date: null } }),
      { today: TODAY },
    );
    expect(byId(results, 'vat_sum')[0]?.severity).toBe('pass');
    expect(byId(results, 'date_issue')[0]?.severity).toBe('pass');
  });

  it('checks IČO and DIČ only when present; foreign VAT IDs warn', () => {
    const missing = runProtoChecks(input({ supplier: { ico: null, dic: null } }), { today: TODAY });
    expect(byId(missing, 'ico_checksum')).toEqual([]);
    expect(byId(missing, 'dic_format')).toEqual([]);
    const bad = runProtoChecks(input({ supplier: { ico: '25596642', dic: 'CZ123' } }), {
      today: TODAY,
    });
    expect(byId(bad, 'ico_checksum')[0]).toMatchObject({
      severity: 'fail',
      params: { ico: '25596642' },
    });
    expect(byId(bad, 'dic_format')[0]).toMatchObject({
      severity: 'fail',
      params: { dic: 'CZ123' },
    });
    const foreign = runProtoChecks(input({ supplier: { ico: null, dic: 'IE4276970QH' } }), {
      today: TODAY,
    });
    expect(byId(foreign, 'dic_format')[0]?.severity).toBe('warn');
    expect(DIC_CZ_RE.test('CZ27082440')).toBe(true);
    expect(FOREIGN_VAT_ID_RE.test('NL805734958B01')).toBe(true);
  });

  it('fails future issue and DUZP dates, a due date before issue, and invalid dates', () => {
    const results = runProtoChecks(
      input({ dates: { issue_date: '2026-10-19', duzp: '2026-13-01', due_date: '2026-10-01' } }),
      { today: TODAY },
    );
    expect(byId(results, 'date_issue')[0]).toMatchObject({
      severity: 'fail',
      key: 'proto.check.date.fail_future',
      params: { field: 'date_issue', date: '2026-10-19', today: '2026-10-18' },
    });
    expect(byId(results, 'date_duzp')[0]).toMatchObject({
      severity: 'fail',
      key: 'proto.check.date.fail_invalid',
    });
    expect(byId(results, 'date_due')[0]).toMatchObject({
      severity: 'fail',
      key: 'proto.check.date.fail_due',
      params: { due: '2026-10-01', issue: '2026-10-19' },
    });
    const absent = runProtoChecks(
      input({ dates: { issue_date: null, duzp: null, due_date: null } }),
      {
        today: TODAY,
      },
    );
    expect(absent.filter((result) => result.id.startsWith('date_'))).toEqual([]);
  });
});

describe('renderProtoChecks', () => {
  it('renders Czech by default and English on request, translating the field label', () => {
    const results = runProtoChecks(
      input({ dates: { issue_date: '2026-10-19', duzp: null, due_date: null } }),
      { today: TODAY },
    );
    const cs = renderProtoChecks(results);
    expect(cs.find((result) => result.id === 'date_issue')?.message).toBe(
      'Datum vystavení 2026-10-19 je v budoucnosti (dnes 2026-10-18).',
    );
    expect(cs.find((result) => result.id === 'vat_sum')?.message).toBe(
      'Součet základů a DPH odpovídá celkové částce 12960.84.',
    );
    const en = renderProtoChecks(results, 'en');
    expect(en.find((result) => result.id === 'ico_checksum')?.message).toBe(
      'IČO 25596641 has a valid check digit.',
    );
    expect(en.find((result) => result.id === 'date_issue')?.message).toBe(
      'Issue date 2026-10-19 is in the future (today 2026-10-18).',
    );
  });
});
```

Command: `pnpm exec biome ci packages/validation 2>&1 | tail -3` → no errors; `pnpm --filter @shoebox/validation typecheck 2>&1 | tail -3` → no errors; `pnpm --filter @shoebox/validation test 2>&1 | tail -6` → `Test Files  2 passed (2)` and `Tests  11 passed (11)`. Commit.

### Step 5: repo guards, push

Command: `pnpm exec biome ci packages/i18n 2>&1 | tail -2` → no errors; `pnpm depcruise 2>&1 | tail -2` → `no dependency violations found`; `python3 scripts/pii_guard.py --all packages/validation/src/proto-checks/checks.ts packages/validation/test/proto-checks.test.ts packages/i18n/messages/cs.json packages/i18n/messages/en.json 2>&1 | tail -1` → `pii_guard: OK`; `python3 scripts/context_lint.py 2>&1 | tail -1` → `context lint: OK`. Nothing to commit. Write the report (§9) and push: `git push origin task/proto-scanner 2>&1 | tail -3`. No PR yet (0038d opens it).

## 5. Do not touch

`packages/validation/vitest.config.ts`, `packages/validation/tsconfig.json`, `packages/validation/test/smoke.test.ts`, `packages/domain/**` (rates stay there; read them, never copy them), `packages/i18n/src/**`, `packages/i18n/test/**`, `packages/extraction/**` (0038a is done), `scripts/**`, `.env*`, `docs/v3/**`, `.github/**`. Hard rules 1, 4, 6, 7, 8. No tax number in code: the only numeric constants are the ADR-007 tolerances `1.00` and `0.01`.

## 6. Commands

```
pnpm --filter @shoebox/validation test 2>&1 | tail -30                                    # 11 passed (2 files)
pnpm --filter @shoebox/validation exec vitest run test/proto-checks.test.ts 2>&1 | tail -6 # 10 passed
pnpm --filter @shoebox/validation typecheck 2>&1 | tail -30                               # exit 0
pnpm --filter @shoebox/i18n test 2>&1 | tail -30                                          # 24 passed (3 files)
pnpm exec biome ci packages/validation packages/i18n 2>&1 | tail -30                      # No fixes applied, no errors
pnpm install --frozen-lockfile 2>&1 | tail -3                                             # Done, no lockfile error
pnpm depcruise 2>&1 | tail -3                                                             # no dependency violations found
python3 scripts/pii_guard.py --all packages/validation/src/proto-checks/checks.ts packages/validation/test/proto-checks.test.ts packages/i18n/messages/*.json 2>&1 | tail -3   # pii_guard: OK
python3 scripts/context_lint.py 2>&1 | tail -30                                           # context lint: OK
```

## 7. Acceptance

- [ ] `packages/validation/test/proto-checks.test.ts`: 10 passed; it pins `vatForRate` math (`96.66 × 21 % = 20.30`, so a printed `20.29` is `warn`), the 1.00 tolerance on the total (`warn` at 0.16, `fail` at 39.16), IČO `25596641` / `27082440` valid and `25596642` invalid, `CZ123` → `fail`, `IE4276970QH` → `warn`, a future issue date → `fail`, due before issue → `fail`, and the Czech sentence `Datum vystavení 2026-10-19 je v budoucnosti (dnes 2026-10-18).`.
- [ ] `git diff --stat origin/phase/0 -- pnpm-lock.yaml` → `1 file changed, 7 insertions(+)`; `pnpm install --frozen-lockfile` exits 0.
- [ ] `grep -c '"proto\.' packages/i18n/messages/cs.json` → `56`, same for `en.json`; `pnpm --filter @shoebox/i18n test` 24 passed.
- [ ] `grep -n "21\b\|12\b" packages/validation/src/proto-checks/checks.ts` → no VAT rate literal (rates come from `vat.rates`).
- [ ] `pnpm depcruise` clean; `pnpm --filter @shoebox/validation typecheck` exit 0.

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found;
- `pnpm install --frozen-lockfile` fails twice;
- a test fails twice, or a test the brief wrote seems wrong;
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a new (third-party) dependency seems needed;
- a file outside §3 needs a change;
- §5 would be touched;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy (hand that to the owner with the exact command).

## 9. Report

Write `docs/tasks/0038b-report.md` (600 tokens at most) and set `Status: review`. The report has:

1. The files changed (`git diff --stat origin/phase/0`).
2. Each command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations, and `[verify]` findings with their source.
5. Questions.
6. Owner steps left.

## Risk list (for the reviewer)

`checks.ts`: `vatForRate(base, rate)` is the ADR-007 rounding (`round2(base × rate / 100)`); a receipt computed top-down (gross × 21/121) differs by one haléř and lands in `warn`, which the real golden run confirmed on IKEA, Decathlon, Apple and Alza; the total check uses `roundingLineAllowed(diff, 1.00 in the document currency)`; an unknown currency falls back to CZK for the math only; allowed rates `{0, reduced, standard}` from `vat.rates` at the issue date, today when the date is missing or outside the seeded years; IČO modulo 11 per ČSÚ; DIČ `^CZ\d{8,10}$` passes, a `CZ…` that does not match fails, another country prefix warns (foreign VAT ID not checked); due date only compared when both dates are valid. `renderProtoChecks` translates the `field` param through `proto.field.*` before formatting. Lockfile: a 7-line importer change only; CI's `--frozen-lockfile` is the guard. i18n: 56 keys, Czech source first, no apostrophes (ICU).

## Owner steps

None for this brief.
