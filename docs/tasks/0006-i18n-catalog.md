# 0006: i18n package with Czech source catalog

Status: done
Ticket: P0-I18N-01 | Depends on: none (P0-REPO-01 merged) | Base commit: head of phase/0 | Branch: task/0006-i18n | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Create the `@shoebox/i18n` message catalogs (`cs` is the source, `en` must have every key) and a typed `t(key, params)` that renders ICU messages, including Czech plurals ("1 doklad", "2 doklady", "5 dokladů"), on server and client. Wire `pnpm check:i18n` into `pnpm lint` so a missing English key or broken ICU message fails CI.

## 2. Context

Spec (M11 §12 i18n conventions):

- Catalogs in `packages/i18n/messages/{cs,en}.json`, ICU MessageFormat; Czech is the source of truth; English must have every key (CI check).
- Key pattern `<area>.<screen|object>.<element>` (e.g. `inbox.tabs.review`, `doc.field.duzp.label`).
- Czech plurals use ICU `one / few / many / other` (`1 doklad`, `2 doklady`, `5 dokladů`; `many` for decimals).
- Enum display names come from i18n (`enum.document_class.received_invoice`), never from enum values.

Spec (03 §4 Localization): Czech is the source language. English second. Every user-facing string goes through i18n (no hard-coded strings; lint).

Decisions the brief already made (do not change them):

- **No ICU library.** None is approved in `docs/context/decisions.md` (hard rule 7). `src/icu.ts` is a small built-in formatter for the subset we use: text, `{arg}`, `{arg, plural, ...}` with `#` and `=N`, `{arg, select, ...}`. Plural categories come from the built-in `Intl.PluralRules` (no dependency). It carries `TODO(decision-i18n-lib)`.
- Catalogs are **flat JSON** with dotted keys (`doc.confirm` and `doc.confirm.disabled` both exist, so nesting is impossible).
- `doc.delete.retained` takes `{years}` instead of the literal "10 let": retention periods live only in `packages/domain/rules` (hard rule 1).
- `tax_doc_status.not_tax_document.why` uses Czech quotes „…“ (the spec table shows a straight `"`).
- `check:i18n` runs the i18n package tests (they hold the missing-key and ICU checks).

Current root `package.json` lines (anchors for step 7, line 14 and line 24):

```json
    "lint": "biome ci .",
```
```json
    "check:i18n": "echo 'TODO(P0-I18N-01): check:i18n' && exit 1"
```

Existing and unchanged: `packages/i18n/package.json` (scripts `test` = `vitest run`, `typecheck` = `tsc -p tsconfig.json`), `tsconfig.json` (includes `src` and `test`; base has `resolveJsonModule`), `vitest.config.ts`, `test/smoke.test.ts` (imports `packageName` from `../src/index`; keep it passing).

Executor rules for this brief: write each file with **one Write call**, exactly as given. Do not re-read a file you just wrote. Do not explore the repo. All file contents below were typechecked, linted and tested before the brief was written.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/i18n/messages/cs.json` | create | Czech source catalog |
| `packages/i18n/messages/en.json` | create | English catalog, same keys |
| `packages/i18n/src/icu.ts` | create | minimal ICU parser and renderer |
| `packages/i18n/src/index.ts` | replace | `t`, `createT`, `catalogs`, types |
| `packages/i18n/test/icu.test.ts` | create | formatter tests |
| `packages/i18n/test/catalog.test.ts` | create | missing keys, ICU validity, `t` |
| `package.json` | edit | `check:i18n` real, wired into `lint` |
| `docs/tasks/0006-report.md` | create | report |

No other file may change. No `pnpm install` (no dependency is added; `pnpm-lock.yaml` must not change).

## 4. Steps

Setup: `git fetch origin phase/0 && git checkout -b task/0006-i18n origin/phase/0`

Commit after each step: `git add -A && git commit -m "0006 step k"` (k = step number).

### Step 1: `packages/i18n/messages/cs.json` (new)

```json
{
  "common.documents.count": "{n, plural, one {# doklad} few {# doklady} many {# dokladu} other {# dokladů}}",
  "inbox.title": "Inbox",
  "inbox.tabs.review": "Ke kontrole",
  "inbox.tabs.all": "Vše",
  "inbox.tabs.supporting": "Podklady",
  "inbox.tabs.other": "Ostatní",
  "inbox.tabs.trash": "Koš",
  "inbox.upload.cta": "Nahrát doklady",
  "inbox.upload.drop": "Pusťte soubory sem",
  "inbox.address.label": "E-mail pro doklady",
  "review.progress": "Otázka {n} ze {total}",
  "review.q.business_or_personal": "Je to soukromé, nebo firemní?",
  "review.q.which_category": "Za co byl tento výdaj?",
  "review.q.confirm_field": "Sedí {field}?",
  "review.done": "Hotovo. Vše je vyřízeno.",
  "review.answer.business": "Firemní",
  "review.answer.private": "Soukromé",
  "review.answer.mixed": "Napůl",
  "doc.confirm": "Potvrdit",
  "doc.confirm.disabled": "Nejdřív vyřešte: {reason}",
  "doc.pick.banner": "Klikněte nebo táhněte přes hodnotu v dokladu",
  "doc.delete.retained": "Tento doklad musíme ze zákona uchovat {years, plural, one {# rok} few {# roky} many {# roku} other {# let}}. Skryjeme ho, ale nesmažeme.",
  "manual.add": "Přidat ručně",
  "manual.substitute.toggle": "Doklad chybí / je poškozený",
  "manual.substitute.note": "Výdaj se může započítat do daně z příjmů, pokud doložíte platbu. DPH si bez daňového dokladu odečíst nelze. Rozhodne účetní.",
  "manual.substitute.reason.lost": "ztracený",
  "manual.substitute.reason.damaged": "poškozený",
  "manual.substitute.reason.never_issued": "nebyl vystaven",
  "manual.substitute.reason.other": "jiný důvod",
  "register.export_xlsx": "Stáhnout jako Excel",
  "register.bulk.mark_paid": "Označit jako zaplacené",
  "import.wizard.step2": "Přiřaďte sloupce. Náhled ukazuje prvních 10 řádků.",
  "onboarding.ico.label": "Vaše IČO",
  "onboarding.vat.question": "Jste plátce DPH?",
  "onboarding.regime.question": "Jak uplatňujete výdaje?",
  "onboarding.accountant.question": "Máte účetní?",
  "settings.expert_view": "Pohled pro pokročilé",
  "vat_treatment.rcv_eu_service_reverse_charge.why": "{supplier} je firma z {country}. U služeb ze zemí EU přiznáváte DPH vy, sazba {rate} %.",
  "tax_doc_status.not_tax_document.why": "Na dokladu stojí „{phrase}“. Pro daň z příjmů platí, pro DPH ne."
}
```

Command: `node -e "console.log(Object.keys(JSON.parse(require('fs').readFileSync('packages/i18n/messages/cs.json','utf8'))).length)" 2>&1 | tail -30`
Expected: `39`

### Step 2: `packages/i18n/messages/en.json` (new)

```json
{
  "common.documents.count": "{n, plural, one {# document} other {# documents}}",
  "inbox.title": "Inbox",
  "inbox.tabs.review": "To review",
  "inbox.tabs.all": "All",
  "inbox.tabs.supporting": "Supporting",
  "inbox.tabs.other": "Other",
  "inbox.tabs.trash": "Trash",
  "inbox.upload.cta": "Upload documents",
  "inbox.upload.drop": "Drop files here",
  "inbox.address.label": "E-mail for documents",
  "review.progress": "Question {n} of {total}",
  "review.q.business_or_personal": "Is this personal or business?",
  "review.q.which_category": "What was this expense for?",
  "review.q.confirm_field": "Is {field} correct?",
  "review.done": "Done. Everything is sorted.",
  "review.answer.business": "Business",
  "review.answer.private": "Personal",
  "review.answer.mixed": "Partly",
  "doc.confirm": "Confirm",
  "doc.confirm.disabled": "Resolve this first: {reason}",
  "doc.pick.banner": "Click or drag across the value in the document",
  "doc.delete.retained": "By law we must keep this document for {years, plural, one {# year} other {# years}}. We will hide it, but not delete it.",
  "manual.add": "Add manually",
  "manual.substitute.toggle": "Document missing / damaged",
  "manual.substitute.note": "The expense can count towards income tax if you prove the payment. VAT cannot be deducted without a tax document. Your accountant decides.",
  "manual.substitute.reason.lost": "lost",
  "manual.substitute.reason.damaged": "damaged",
  "manual.substitute.reason.never_issued": "never issued",
  "manual.substitute.reason.other": "other reason",
  "register.export_xlsx": "Download as Excel",
  "register.bulk.mark_paid": "Mark as paid",
  "import.wizard.step2": "Map the columns. The preview shows the first 10 rows.",
  "onboarding.ico.label": "Your IČO",
  "onboarding.vat.question": "Are you a VAT payer?",
  "onboarding.regime.question": "How do you claim expenses?",
  "onboarding.accountant.question": "Do you have an accountant?",
  "settings.expert_view": "Expert view",
  "vat_treatment.rcv_eu_service_reverse_charge.why": "{supplier} is a company from {country}. For services from EU countries you declare the VAT yourself, at {rate} %.",
  "tax_doc_status.not_tax_document.why": "The document says “{phrase}”. It counts for income tax, not for VAT."
}
```

Command: `node -e "console.log(Object.keys(JSON.parse(require('fs').readFileSync('packages/i18n/messages/en.json','utf8'))).length)" 2>&1 | tail -30`
Expected: `39`

### Step 3: `packages/i18n/src/icu.ts` (new)

```ts
// Minimal ICU MessageFormat subset: text, {arg}, {arg, plural, ...} with # and =N, {arg, select, ...}.
// TODO(decision-i18n-lib): replace with an approved ICU library (e.g. intl-messageformat) if the owner approves one.
// Not supported: apostrophe quoting, {arg, number|date|time}, offset:. Use them and parse() throws.

export type Params = Readonly<Record<string, string | number>>;

export type IcuNode =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'arg'; readonly name: string }
  | { readonly kind: 'pound' }
  | {
      readonly kind: 'plural' | 'select';
      readonly name: string;
      readonly options: ReadonlyMap<string, IcuNode[]>;
    };

export class IcuSyntaxError extends Error {
  override readonly name = 'IcuSyntaxError';
}

const ARG_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PLURAL_SELECTOR = /^(zero|one|two|few|many|other|=\d+)$/;
const SELECT_SELECTOR = /^[A-Za-z0-9_]+$/;

class Parser {
  readonly src: string;
  pos = 0;

  constructor(src: string) {
    this.src = src;
  }

  fail(reason: string): IcuSyntaxError {
    return new IcuSyntaxError(`${reason} at ${this.pos} in "${this.src}"`);
  }

  nodes(inPlural: boolean): IcuNode[] {
    const out: IcuNode[] = [];
    let text = '';
    while (this.pos < this.src.length) {
      const ch = this.src.charAt(this.pos);
      if (ch === '}') break;
      if (ch === '{' || (ch === '#' && inPlural)) {
        if (text !== '') out.push({ kind: 'text', value: text });
        text = '';
        if (ch === '{') {
          out.push(this.argument(inPlural));
        } else {
          out.push({ kind: 'pound' });
          this.pos++;
        }
      } else {
        text += ch;
        this.pos++;
      }
    }
    if (text !== '') out.push({ kind: 'text', value: text });
    return out;
  }

  // Reads up to (not including) the first of the stop characters; throws at end of input.
  readUntil(stops: string): string {
    const start = this.pos;
    while (this.pos < this.src.length && !stops.includes(this.src.charAt(this.pos))) this.pos++;
    if (this.pos >= this.src.length) throw this.fail('unclosed "{"');
    return this.src.slice(start, this.pos).trim();
  }

  expect(ch: string): void {
    if (this.pos >= this.src.length) throw this.fail('unclosed "{"');
    if (this.src.charAt(this.pos) !== ch) throw this.fail(`expected "${ch}"`);
    this.pos++;
  }

  argument(inPlural: boolean): IcuNode {
    this.expect('{');
    const name = this.readUntil(',}{');
    if (!ARG_NAME.test(name)) throw this.fail(`invalid argument name "${name}"`);
    if (this.src.charAt(this.pos) === '}') {
      this.pos++;
      return { kind: 'arg', name };
    }
    this.expect(',');
    const type = this.readUntil(',}{');
    if (type !== 'plural' && type !== 'select') {
      throw this.fail(`unsupported argument type "${type}"`);
    }
    this.expect(',');
    const selectorPattern = type === 'plural' ? PLURAL_SELECTOR : SELECT_SELECTOR;
    const options = new Map<string, IcuNode[]>();
    for (;;) {
      const selector = this.readUntil('{}');
      if (selector === '' && this.src.charAt(this.pos) === '}') break;
      if (!selectorPattern.test(selector)) throw this.fail(`invalid selector "${selector}"`);
      if (options.has(selector)) throw this.fail(`duplicate selector "${selector}"`);
      this.expect('{');
      options.set(selector, this.nodes(type === 'plural' || inPlural));
      this.expect('}');
    }
    this.pos++;
    if (!options.has('other')) throw this.fail('missing "other" option');
    return { kind: type, name, options };
  }
}

/** Parses an ICU message; throws IcuSyntaxError when it is invalid or uses an unsupported feature. */
export function parse(message: string): IcuNode[] {
  const parser = new Parser(message);
  const nodes = parser.nodes(false);
  if (parser.pos < message.length) throw parser.fail('unexpected "}"');
  return nodes;
}

function param(params: Params, name: string): string | number {
  const value = params[name];
  if (value === undefined) throw new Error(`i18n: missing parameter "${name}"`);
  return value;
}

function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}

/** Renders parsed nodes. Numbers are formatted for the locale (cs: 1,5). */
export function render(
  nodes: readonly IcuNode[],
  locale: string,
  params: Params,
  count?: number,
): string {
  let out = '';
  for (const node of nodes) {
    switch (node.kind) {
      case 'text':
        out += node.value;
        break;
      case 'pound':
        out += count === undefined ? '#' : formatNumber(count, locale);
        break;
      case 'arg': {
        const value = param(params, node.name);
        out += typeof value === 'number' ? formatNumber(value, locale) : value;
        break;
      }
      case 'plural': {
        const value = param(params, node.name);
        if (typeof value !== 'number') {
          throw new TypeError(`i18n: plural argument "${node.name}" must be a number`);
        }
        const branch =
          node.options.get(`=${value}`) ??
          node.options.get(new Intl.PluralRules(locale).select(value)) ??
          node.options.get('other') ??
          [];
        out += render(branch, locale, params, value);
        break;
      }
      case 'select': {
        const value = String(param(params, node.name));
        const branch = node.options.get(value) ?? node.options.get('other') ?? [];
        out += render(branch, locale, params, count);
        break;
      }
    }
  }
  return out;
}

/** Parses and renders one message. */
export function formatMessage(message: string, locale: string, params: Params = {}): string {
  return render(parse(message), locale, params);
}
```

Command: `pnpm --filter @shoebox/i18n typecheck 2>&1 | tail -30`
Expected: exit 0, no `error TS` lines.

### Step 4: `packages/i18n/src/index.ts` (replace the whole file)

```ts
import cs from '../messages/cs.json' with { type: 'json' };
import en from '../messages/en.json' with { type: 'json' };
import { type IcuNode, type Params, parse, render } from './icu';

export const packageName = '@shoebox/i18n' as const;

export type { IcuNode, Params } from './icu';
export { formatMessage, IcuSyntaxError, parse } from './icu';

/** Czech is the source of truth; every other locale must have every Czech key. */
export type Locale = 'cs' | 'en';
export type MessageKey = keyof typeof cs;
export type Catalog = Readonly<Record<MessageKey, string>>;

// Assigning `en` to Catalog makes a missing English key a typecheck error as well as a test failure.
export const catalogs: Readonly<Record<Locale, Catalog>> = { cs, en };

export type Translate = (key: MessageKey, params?: Params) => string;

/** Returns `t` for one locale. Pure (no Node or DOM API), so it runs on the server and in the browser. */
export function createT(locale: Locale): Translate {
  const catalog = catalogs[locale];
  const cache = new Map<MessageKey, IcuNode[]>();
  return (key, params = {}) => {
    let nodes = cache.get(key);
    if (nodes === undefined) {
      nodes = parse(catalog[key]);
      cache.set(key, nodes);
    }
    return render(nodes, locale, params);
  };
}

/** Czech translator, the default for server code and tests. */
export const t: Translate = createT('cs');
```

Command: `pnpm --filter @shoebox/i18n typecheck 2>&1 | tail -30`
Expected: exit 0, no `error TS` lines.

### Step 5: `packages/i18n/test/icu.test.ts` (new; do not edit after writing)

```ts
import { describe, expect, it } from 'vitest';
import { formatMessage, IcuSyntaxError, parse } from '../src/icu';

const DOKLADY = '{n, plural, one {# doklad} few {# doklady} many {# dokladu} other {# dokladů}}';

describe('formatMessage', () => {
  it('renders text and arguments, numbers in the locale format', () => {
    expect(formatMessage('Otázka {n} ze {total}', 'cs', { n: 2, total: 5 })).toBe('Otázka 2 ze 5');
    expect(formatMessage('Sedí {field}?', 'cs', { field: 'DUZP' })).toBe('Sedí DUZP?');
    expect(formatMessage('sazba {rate} %', 'cs', { rate: 1.5 })).toBe('sazba 1,5 %');
  });

  it('renders Czech plurals one / few / many / other', () => {
    expect(formatMessage(DOKLADY, 'cs', { n: 1 })).toBe('1 doklad');
    expect(formatMessage(DOKLADY, 'cs', { n: 2 })).toBe('2 doklady');
    expect(formatMessage(DOKLADY, 'cs', { n: 5 })).toBe('5 dokladů');
    expect(formatMessage(DOKLADY, 'cs', { n: 0 })).toBe('0 dokladů');
    expect(formatMessage(DOKLADY, 'cs', { n: 1.5 })).toBe('1,5 dokladu');
  });

  it('prefers an exact =N option', () => {
    const message = '{n, plural, =0 {žádný doklad} other {# dokladů}}';
    expect(formatMessage(message, 'cs', { n: 0 })).toBe('žádný doklad');
    expect(formatMessage(message, 'cs', { n: 7 })).toBe('7 dokladů');
  });

  it('renders English plurals', () => {
    const message = '{n, plural, one {# document} other {# documents}}';
    expect(formatMessage(message, 'en', { n: 1 })).toBe('1 document');
    expect(formatMessage(message, 'en', { n: 2 })).toBe('2 documents');
  });

  it('renders select with an other fallback', () => {
    const message = '{kind, select, business {Firemní} other {Soukromé}}';
    expect(formatMessage(message, 'cs', { kind: 'business' })).toBe('Firemní');
    expect(formatMessage(message, 'cs', { kind: 'private' })).toBe('Soukromé');
  });

  it('keeps # literal outside a plural', () => {
    expect(formatMessage('Doklad # {id}', 'cs', { id: 'A1' })).toBe('Doklad # A1');
  });

  it('throws on a missing parameter', () => {
    expect(() => formatMessage('Sedí {field}?', 'cs', {})).toThrow('missing parameter "field"');
  });

  it('throws when a plural argument is not a number', () => {
    expect(() => formatMessage(DOKLADY, 'cs', { n: '1' })).toThrow(TypeError);
  });
});

describe('parse rejects invalid ICU', () => {
  it.each([
    ['Ahoj {name', 'unclosed "{"'],
    ['Ahoj name}', 'unexpected "}"'],
    ['{n, plural, one {a', 'unclosed "{"'],
    ['{n, plural, one {# doklad}}', 'missing "other"'],
    ['{n, number}', 'unsupported argument type'],
    ['{n, plural, single {x} other {y}}', 'invalid selector'],
    ['{n, plural, one {a} one {b} other {c}}', 'duplicate selector'],
    ['{}', 'invalid argument name'],
    ['{n plural}', 'invalid argument name'],
  ])('%s', (message, reason) => {
    expect(() => parse(message)).toThrow(IcuSyntaxError);
    expect(() => parse(message)).toThrow(reason);
  });
});
```

Command: `pnpm --filter @shoebox/i18n test -- test/icu.test.ts 2>&1 | tail -30`
Expected: `Tests  17 passed (17)`.

### Step 6: `packages/i18n/test/catalog.test.ts` (new; do not edit after writing)

```ts
import { describe, expect, it } from 'vitest';
import cs from '../messages/cs.json' with { type: 'json' };
import en from '../messages/en.json' with { type: 'json' };
import { createT, parse, t } from '../src/index';

const catalogs: Record<string, Record<string, string>> = { cs, en };

function invalidMessages(): string[] {
  const failures: string[] = [];
  for (const [locale, catalog] of Object.entries(catalogs)) {
    for (const [key, message] of Object.entries(catalog)) {
      try {
        parse(message);
      } catch (error) {
        failures.push(`${locale} ${key}: ${String(error)}`);
      }
    }
  }
  return failures;
}

describe('catalogs', () => {
  it('en has every cs key and no extra key', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(cs).sort());
  });

  it('keys follow <area>.<screen|object>.<element>', () => {
    const bad = Object.keys(cs).filter((key) => !/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(key));
    expect(bad).toEqual([]);
  });

  it('every message is valid ICU and not empty', () => {
    expect(invalidMessages()).toEqual([]);
    const empty = Object.entries(catalogs).flatMap(([locale, catalog]) =>
      Object.entries(catalog)
        .filter(([, message]) => message.trim() === '')
        .map(([key]) => `${locale} ${key}`),
    );
    expect(empty).toEqual([]);
  });
});

describe('t', () => {
  it('renders Czech source strings', () => {
    expect(t('inbox.upload.cta')).toBe('Nahrát doklady');
    expect(t('review.progress', { n: 2, total: 5 })).toBe('Otázka 2 ze 5');
  });

  it('renders Czech plurals for 1, 2 and 5', () => {
    expect(t('common.documents.count', { n: 1 })).toBe('1 doklad');
    expect(t('common.documents.count', { n: 2 })).toBe('2 doklady');
    expect(t('common.documents.count', { n: 5 })).toBe('5 dokladů');
  });

  it('renders English through createT', () => {
    const tEn = createT('en');
    expect(tEn('common.documents.count', { n: 1 })).toBe('1 document');
    expect(tEn('common.documents.count', { n: 5 })).toBe('5 documents');
    expect(tEn('inbox.upload.cta')).toBe('Upload documents');
  });
});
```

Command: `pnpm --filter @shoebox/i18n test 2>&1 | tail -30`
Expected: `Test Files  3 passed (3)`, `Tests  24 passed (24)` (17 + 6 + 1 smoke).

### Step 7: root `package.json` (edit, two lines)

Replace

```json
    "lint": "biome ci .",
```

with

```json
    "lint": "biome ci . && pnpm check:i18n",
```

and replace

```json
    "check:i18n": "echo 'TODO(P0-I18N-01): check:i18n' && exit 1"
```

with

```json
    "check:i18n": "pnpm --filter @shoebox/i18n test"
```

Command: `pnpm check:i18n 2>&1 | tail -30`
Expected: `Tests  24 passed (24)`, exit 0.

### Step 8: lint the whole repo

Command: `pnpm lint 2>&1 | tail -30`
Expected: Biome reports no errors, then the i18n tests pass. If Biome reports only formatting or import-order issues in the §3 files, run `pnpm exec biome check --write packages/i18n package.json 2>&1 | tail -30` once, then `pnpm lint` again. No commit if nothing changed.

## 5. Do not touch

- Everything outside §3, in particular `packages/i18n/package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `biome.json`, `.github/`.
- Do not add a dependency (hard rule 7). Do not change the test files to make them pass.
- Hard rules: every user string goes through `packages/i18n` (rule 6); law numbers (rates, retention years) are never written into messages, they arrive as parameters (rule 1); money is never a float, so a money amount is passed as an already formatted string, never as a `number` (rule 1).

## 6. Commands

From the [test-map](../context/test-map.md) row `packages/i18n`:

- `pnpm --filter @shoebox/i18n test 2>&1 | tail -30` → `Tests  24 passed (24)`
- `pnpm --filter @shoebox/i18n typecheck 2>&1 | tail -30` → exit 0
- `pnpm check:i18n 2>&1 | tail -30` → exit 0
- `pnpm lint 2>&1 | tail -30` → exit 0
- `python3 scripts/context_lint.py 2>&1 | tail -30` → no new warning for `docs/tasks/0006-*`

## 7. Acceptance

Mirrors the P0-I18N-01 ticket:

- [ ] `packages/i18n/messages/cs.json`, `en.json` exist; `t(key, params)` works server and client (`src/index.ts` and `src/icu.ts` use no Node or DOM API, only `Intl`).
- [ ] `pnpm --filter @shoebox/i18n test`: `en` has every `cs` key (catalog test); invalid ICU fails (icu test, 9 cases); Czech plurals render "1 doklad", "2 doklady", "5 dokladů" (both test files).
- [ ] `pnpm check:i18n` wired into `lint` (root `package.json`), and `pnpm lint` exits 0.

Not in this brief: the Biome rule against JSX literal text already exists (P0-REPO-02). Using `t` in `apps/web` comes with the screen tickets.

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found;
- a test fails twice, or a test the brief wrote seems wrong;
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a new dependency seems needed (for example an ICU library);
- a file outside §3 needs a change;
- §5 would be touched;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy (hand that to the owner with the exact command).

## 9. Report

Write `docs/tasks/0006-report.md` (600 tokens at most) and set `Status: review` in this file. The report has:

1. The files changed (`git diff --stat origin/phase/0 | tail -30`).
2. Each command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations.
5. Questions.
6. Owner steps left.

Commit as `0006 report`, then push: `git push -u origin task/0006-i18n`. The orchestrator opens and merges the PR.

## Risk list (for the reviewer)

- `packages/i18n/src/icu.ts`: the hand-written ICU subset. Check plural selection (`=N` first, then `Intl.PluralRules`, then `other`), that `#` renders only inside a plural, and that unsupported syntax throws instead of rendering wrong text. Apostrophe quoting is not supported: a message with `'{'` would parse as an argument.
- `packages/i18n/messages/cs.json`: Czech copy is user-facing; `doc.delete.retained` now takes `{years}` (deviation from the spec table, hard rule 1).
- `package.json`: `lint` now also runs the i18n tests; CI's lint job must still pass.

## Owner steps

None to run this brief. One decision for later, recorded as `TODO(decision-i18n-lib)` in `src/icu.ts`:

1. Decide whether to approve an ICU library (for example `intl-messageformat`, or `next-intl` for the web app) when the screens need dates, numbers or rich text in messages.
2. If yes, the orchestrator adds a line to `docs/context/decisions.md` and a follow-up brief swaps `src/icu.ts` for it; the tests in this brief stay as they are.
