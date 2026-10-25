# 0015b: StatusBadge, MoneyText and LegalDateText

Status: review
Ticket: P0-UI-02 (part b of 3) | Depends on: 0015a merged into phase/0 | Base commit: head of phase/0 | Branch: task/0015b-ui-status | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Add the three app components every list and detail screen uses: `StatusBadge` (document status as icon + word + tone), `MoneyText` (Czech amounts, exact, tabular) and `LegalDateText` (Czech dates). With them a user reads status, money and dates the same way on every screen, never by color alone.

## 2. Context

**How to work (strict):** every file is given in full. Write each new file with ONE Write call, exactly as given. Do not re-read a file you just wrote. Do not explore the repo. Run each step's command and commit in the same Bash call (`git add -A && git commit -qm "0015b step k"`).

**Test filter:** `pnpm --filter @shoebox/ui test <name>` (no `--`).

**Already in phase/0 (from 0015a, do not change):** `packages/ui/src/primitives/basic.tsx` exports `cn`, `Badge` (props `tone?: BadgeTone`, renders `<span data-slot="badge" data-tone=…>`), `type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'destructive'`; `packages/ui/test/render.tsx` exports `render(ui)` and `cleanup()`. `@shoebox/domain` and `@shoebox/i18n` are dependencies of `@shoebox/ui`. If any of this is missing: STOP.

**From `@shoebox/domain` (exists):** `type DocumentStatus` = `received | splitting | classifying | extracting | validating | categorizing | needs_review | ready | finalized | supporting | duplicate | failed`; `type DocumentClass` (includes `received_invoice`, `settlement_statement`, `order_confirmation`, `government_filing`, `contract`, `delivery_note`, `other_supporting`, `bank_statement`, `non_document`, `unknown`); `type LegalDate` (branded `YYYY-MM-DD`) and `parseLegalDate(s)`.

**From `@shoebox/i18n` (exists):** `t(key, params?)` (Czech), `type MessageKey` (keys of `messages/cs.json`). The catalog test requires every cs key in en and keys shaped `<area>.<object>.<element>`.

**Spec M11 §4 Document status → user-facing status (pasted):**

| `documents.status` (+ condition) | Badge (Lucide icon + word) | Token |
|---|---|---|
| received, splitting, classifying, extracting, validating, categorizing | Zpracovává se | `--info`, spinner |
| same, > 120 s | Trvá to déle než obvykle | neutral |
| needs_review | Ke kontrole | `--warning` |
| ready | Hotovo | `--success` |
| finalized | Uzavřeno | neutral + lock icon |
| supporting (class non-bookable: settlement_statement, order_confirmation, government_filing, contract, delivery_note, other_supporting, bank_statement) | Podklad | neutral |
| supporting / class non_document | Není doklad | neutral |
| duplicate | Duplicita | neutral + link "původní" |
| failed | Nepodařilo se přečíst | `--destructive` |
| any + deleted_at | V koši (smaže se {date}) | neutral |
| secondary badge: not_tax_document or substitute_reason set | Nedaňový | `--info` |
| secondary badge (Phase 2): transaction without document | Chybí doklad | `--warning` |

**Spec M11 §8 (pasted):** `MoneyText { value: string; currency: string; signed?: boolean }` → `Intl.NumberFormat('cs-CZ')`, tabular numerals, NBSP before "Kč". `LegalDateText { date: LegalDate; relative?: boolean }` → "25. 9. 2026" / "za 3 dny". `StatusBadge { status: DocumentStatus; cls: DocumentClass; processingSince?: string }` (§4).

**Rules:** money is never a float (rule 1): `MoneyText.value` is a decimal string (what Money's `toString()` gives, brief 0004) passed straight to `Intl.NumberFormat.format(string)`, which formats strings exactly (verified on Node 22: `"12345678901234567.89"` → `12 345 678 901 234 567,89 Kč`). Every word comes from `packages/i18n` (rule 6). Status is always icon + word + tone (07 §3).

**Choices made by the brief writer (do not change):**
- StatusBadge never reads the clock: the caller passes `now` (ms, from `Clock`) with `processingSince`; the trash state takes `purgeOn` (the date it will be deleted). Duplicate takes optional `originalHref`.
- The two secondary badges are a separate `SecondaryStatusBadge` component.
- Badge icons are 16 px (07 says 20 px for icons; a badge sits on 14 px meta text). Icons verified in lucide-react 1.51.0: `LoaderCircle, Clock, CircleAlert, CircleCheck, Lock, Paperclip, FileX, Copy, CircleX, Trash, ReceiptText, FileSearch`.
- `LegalDateText` relative mode ("za 3 dny") is deferred to the first screen that needs it (needs today from `Clock` and plural copy). The 120 s threshold is a UI constant, not a law number.
- Words use the default Czech `t`; a locale provider comes with the web shell.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/i18n/messages/cs.json` | edit | 13 `status.badge.*` keys |
| `packages/i18n/messages/en.json` | edit | the same keys in English |
| `packages/ui/src/components/format-text.tsx` | new | `formatMoney`, `MoneyText`, `formatLegalDate`, `LegalDateText` |
| `packages/ui/src/components/status-badge.tsx` | new | `statusView`, `StatusBadge`, `SecondaryStatusBadge` |
| `packages/ui/src/index.ts` | edit | export the components |
| `packages/ui/test/money-text.test.tsx` | new | |
| `packages/ui/test/legal-date.test.tsx` | new | |
| `packages/ui/test/status-badge.test.tsx` | new | every M11 §4 row |

No other file may change.

## 4. Steps

Setup (no file): `cd /home/user/leonoperations && git fetch origin phase/0 && git checkout -b task/0015b-ui-status origin/phase/0 && pnpm install --frozen-lockfile 2>&1 | tail -3 && ls packages/ui/src/primitives packages/ui/test/render.tsx`. Expected: `basic.tsx overlay.tsx radix.tsx` and `render.tsx` listed. Otherwise STOP (0015a not merged).

**Step 1: `packages/i18n/messages/cs.json` (edit).** Anchor (verbatim, line 3): `  "inbox.title": "Inbox",`. Insert right after it:

```json
  "status.badge.processing": "Zpracovává se",
  "status.badge.processing_slow": "Trvá to déle než obvykle",
  "status.badge.needs_review": "Ke kontrole",
  "status.badge.ready": "Hotovo",
  "status.badge.finalized": "Uzavřeno",
  "status.badge.supporting": "Podklad",
  "status.badge.non_document": "Není doklad",
  "status.badge.duplicate": "Duplicita",
  "status.badge.duplicate_original": "původní",
  "status.badge.failed": "Nepodařilo se přečíst",
  "status.badge.trash": "V koši (smaže se {date})",
  "status.badge.not_tax_document": "Nedaňový",
  "status.badge.missing_document": "Chybí doklad",
```

No command. Commit.

**Step 2: `packages/i18n/messages/en.json` (edit).** Same anchor `  "inbox.title": "Inbox",`. Insert right after it:

```json
  "status.badge.processing": "Processing",
  "status.badge.processing_slow": "Taking longer than usual",
  "status.badge.needs_review": "To review",
  "status.badge.ready": "Done",
  "status.badge.finalized": "Closed",
  "status.badge.supporting": "Supporting document",
  "status.badge.non_document": "Not a document",
  "status.badge.duplicate": "Duplicate",
  "status.badge.duplicate_original": "original",
  "status.badge.failed": "Could not read",
  "status.badge.trash": "In trash (deleted on {date})",
  "status.badge.not_tax_document": "Not a tax document",
  "status.badge.missing_document": "Missing document",
```

Command: `pnpm --filter @shoebox/i18n test 2>&1 | tail -8`. Expected: all pass. Commit.

**Step 3: `packages/ui/src/components/format-text.tsx` (new).**

```tsx
import type { LegalDate } from '@shoebox/domain';
import { cn } from '../primitives/basic';

const DECIMAL = /^-?\d+(\.\d+)?$/;

/**
 * Formats a decimal string (never a float, rule 1) as Czech currency: "1 234,56 Kč",
 * NBSP as group separator and before the currency. Intl formats the string exactly.
 */
export function formatMoney(value: string, currency: string, signed = false): string {
  if (!DECIMAL.test(value)) throw new RangeError(`Not a decimal string: ${value}`);
  const format = new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency,
    signDisplay: signed ? 'exceptZero' : 'auto',
  });
  return format.format(value as `${number}`);
}

export type MoneyTextProps = {
  value: string;
  currency: string;
  signed?: boolean;
  className?: string;
};

/** An amount with tabular numerals (the `num` utility from theme.css). */
export function MoneyText({ value, currency, signed = false, className }: MoneyTextProps) {
  return (
    <span data-slot="money" className={cn('num whitespace-nowrap', className)}>
      {formatMoney(value, currency, signed)}
    </span>
  );
}

/** "2026-10-18" → "18. 10. 2026" (Czech short date, no leading zeros). */
export function formatLegalDate(date: LegalDate): string {
  const [y, m, d] = date.split('-');
  const day = Number.parseInt(d ?? '', 10);
  const month = Number.parseInt(m ?? '', 10);
  const year = Number.parseInt(y ?? '', 10);
  return `${day}. ${month}. ${year}`;
}

export type LegalDateTextProps = { date: LegalDate; className?: string };

// TODO(P0-UI-02): relative mode ("za 3 dny") lands with the first screen that needs it.
export function LegalDateText({ date, className }: LegalDateTextProps) {
  return (
    <time dateTime={date} className={cn('tabular-nums whitespace-nowrap', className)}>
      {formatLegalDate(date)}
    </time>
  );
}
```

No command. Commit.

**Step 4: `packages/ui/src/components/status-badge.tsx` (new).** Exported names and prop types exactly as below; implement until the step 7 tests pass.

```tsx
import type { DocumentClass, DocumentStatus, LegalDate } from '@shoebox/domain';
import { type MessageKey, t } from '@shoebox/i18n';
import {
  CircleAlert,
  CircleCheck,
  CircleX,
  Clock,
  Copy,
  FileSearch,
  FileX,
  LoaderCircle,
  Lock,
  Paperclip,
  ReceiptText,
  Trash,
} from 'lucide-react';
import { Badge, type BadgeTone } from '../primitives/basic';
import { formatLegalDate } from './format-text';

/** M11 §4: after 120 s of processing the badge says it takes longer than usual. UI constant, not law. */
export const SLOW_PROCESSING_MS = 120_000;

type Icon = typeof Lock;

export type StatusView = { key: MessageKey; tone: BadgeTone; icon: Icon; spin: boolean };

export type StatusBadgeProps = {
  status: DocumentStatus;
  cls: DocumentClass;
  /** ISO instant when processing started. */
  processingSince?: string;
  /** Current instant in ms from the Clock; the component never reads the system clock. */
  now?: number;
  /** Set when the document is in the trash (deleted_at): the date it will be purged. */
  purgeOn?: LegalDate;
  /** Duplicate only: link to the original document. */
  originalHref?: string;
};

function view(key: MessageKey, tone: BadgeTone, icon: Icon, spin = false): StatusView {
  return { key, tone, icon, spin };
}

/** M11 §4 mapping from document status (+ condition) to word, tone and icon. */
export function statusView(props: StatusBadgeProps): StatusView {
  const { status, cls, processingSince, now, purgeOn } = props;
  if (purgeOn !== undefined) return view('status.badge.trash', 'neutral', Trash);
  switch (status) {
    case 'received':
    case 'splitting':
    case 'classifying':
    case 'extracting':
    case 'validating':
    case 'categorizing': {
      const slow =
        processingSince !== undefined &&
        now !== undefined &&
        now - Date.parse(processingSince) > SLOW_PROCESSING_MS;
      return slow
        ? view('status.badge.processing_slow', 'neutral', Clock)
        : view('status.badge.processing', 'info', LoaderCircle, true);
    }
    case 'needs_review':
      return view('status.badge.needs_review', 'warning', CircleAlert);
    case 'ready':
      return view('status.badge.ready', 'success', CircleCheck);
    case 'finalized':
      return view('status.badge.finalized', 'neutral', Lock);
    case 'supporting':
      return cls === 'non_document'
        ? view('status.badge.non_document', 'neutral', FileX)
        : view('status.badge.supporting', 'neutral', Paperclip);
    case 'duplicate':
      return view('status.badge.duplicate', 'neutral', Copy);
    case 'failed':
      return view('status.badge.failed', 'destructive', CircleX);
  }
}

/** Document status as Lucide icon + word + tone, never color alone (07 §3, M11 §4). */
export function StatusBadge(props: StatusBadgeProps) {
  const { key, tone, icon: StatusIcon, spin } = statusView(props);
  const label =
    props.purgeOn === undefined ? t(key) : t(key, { date: formatLegalDate(props.purgeOn) });
  return (
    <span className="inline-flex items-center gap-2" data-status={props.status}>
      <Badge tone={tone}>
        <StatusIcon
          size={16}
          strokeWidth={1.5}
          aria-hidden="true"
          className={spin ? 'motion-safe:animate-spin' : ''}
        />
        {label}
      </Badge>
      {props.status === 'duplicate' && props.originalHref !== undefined ? (
        <a href={props.originalHref} className="text-meta text-link underline">
          {t('status.badge.duplicate_original')}
        </a>
      ) : null}
    </span>
  );
}

export type SecondaryStatus = 'not_tax_document' | 'missing_document';

const SECONDARY: Record<SecondaryStatus, StatusView> = {
  not_tax_document: view('status.badge.not_tax_document', 'info', ReceiptText),
  missing_document: view('status.badge.missing_document', 'warning', FileSearch),
};

/** Secondary badges shown next to the main one (M11 §4): Nedaňový, Chybí doklad (Phase 2). */
export function SecondaryStatusBadge({ kind }: { kind: SecondaryStatus }) {
  const { key, tone, icon: StatusIcon } = SECONDARY[kind];
  return (
    <Badge tone={tone} data-secondary={kind}>
      <StatusIcon size={16} strokeWidth={1.5} aria-hidden="true" />
      {t(key)}
    </Badge>
  );
}
```

No command. Commit.

**Step 5: `packages/ui/src/index.ts` (edit).** Anchor (verbatim): `export * from './primitives/basic';`. Insert right before it:

```ts
export * from './components/format-text';
export * from './components/status-badge';
```

Command: `pnpm --filter @shoebox/ui typecheck 2>&1 | tail -15`. Expected: no `error TS`. One fix allowed in a `src/components` file (keep exports and props); again: STOP. Commit.

**Step 6: `packages/ui/test/money-text.test.tsx` and `packages/ui/test/legal-date.test.tsx` (new; two Write calls, one commit).**

`money-text.test.tsx`:

```tsx
import { afterEach, describe, expect, it } from 'vitest';
import { formatMoney, MoneyText } from '../src/index';
import { cleanup, render } from './render';

afterEach(cleanup);

const NBSP = ' ';

describe('formatMoney', () => {
  it('formats CZK the Czech way with NBSP', () => {
    expect(formatMoney('1234.56', 'CZK')).toBe(`1${NBSP}234,56${NBSP}Kč`);
    expect(formatMoney('0', 'CZK')).toBe(`0,00${NBSP}Kč`);
    expect(formatMoney('-1234.56', 'CZK')).toBe(`-1${NBSP}234,56${NBSP}Kč`);
  });

  it('shows a plus sign when signed', () => {
    expect(formatMoney('1234.56', 'CZK', true)).toBe(`+1${NBSP}234,56${NBSP}Kč`);
  });

  it('keeps every digit of a large amount (no float)', () => {
    expect(formatMoney('12345678901234567.89', 'CZK')).toBe(
      `12${NBSP}345${NBSP}678${NBSP}901${NBSP}234${NBSP}567,89${NBSP}Kč`,
    );
  });

  it('formats other currencies', () => {
    expect(formatMoney('12.5', 'EUR')).toBe(`12,50${NBSP}€`);
  });

  it('rejects anything that is not a decimal string', () => {
    for (const bad of ['1,5', '', '1e3', 'abc', '12.']) {
      expect(() => formatMoney(bad, 'CZK')).toThrow(RangeError);
    }
  });
});

describe('MoneyText', () => {
  it('renders 1 234,56 Kč with tabular numerals', () => {
    const { container } = render(<MoneyText value="1234.56" currency="CZK" />);
    const span = container.querySelector('[data-slot="money"]');
    expect(span?.textContent).toBe(`1${NBSP}234,56${NBSP}Kč`);
    expect(span?.className.split(' ')).toContain('num');
  });
});
```

`legal-date.test.tsx`:

```tsx
import { parseLegalDate } from '@shoebox/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { formatLegalDate, LegalDateText } from '../src/index';
import { cleanup, render } from './render';

afterEach(cleanup);

describe('formatLegalDate', () => {
  it('formats as 18. 10. 2026', () => {
    expect(formatLegalDate(parseLegalDate('2026-10-18'))).toBe('18. 10. 2026');
  });

  it('drops leading zeros', () => {
    expect(formatLegalDate(parseLegalDate('2026-01-05'))).toBe('5. 1. 2026');
  });
});

describe('LegalDateText', () => {
  it('renders a <time> with the ISO date and the Czech text', () => {
    const { container } = render(<LegalDateText date={parseLegalDate('2026-10-18')} />);
    const time = container.querySelector('time');
    expect(time?.getAttribute('datetime')).toBe('2026-10-18');
    expect(time?.textContent).toBe('18. 10. 2026');
    expect(time?.className).toContain('tabular-nums');
  });
});
```

Command: `pnpm --filter @shoebox/ui test money-text legal-date 2>&1 | tail -15`. Expected: `Tests  9 passed`. Commit.

**Step 7: `packages/ui/test/status-badge.test.tsx` (new).** Do not edit the test file.

```tsx
import {
  type DocumentClass,
  type DocumentStatus,
  parseLegalDate,
} from '@shoebox/domain';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type BadgeTone,
  SecondaryStatusBadge,
  StatusBadge,
  type StatusBadgeProps,
} from '../src/index';
import { cleanup, render } from './render';

afterEach(cleanup);

const PROCESSING: DocumentStatus[] = [
  'received',
  'splitting',
  'classifying',
  'extracting',
  'validating',
  'categorizing',
];
const NON_BOOKABLE: DocumentClass[] = [
  'settlement_statement',
  'order_confirmation',
  'government_filing',
  'contract',
  'delivery_note',
  'other_supporting',
  'bank_statement',
];
const start = '2026-10-18T10:00:00.000Z';

// [name, props, word, tone, lucide icon class]: one entry per M11 §4 row (and per status/class).
const rows: Array<[string, StatusBadgeProps, string, BadgeTone, string]> = [
  ...PROCESSING.map((status): [string, StatusBadgeProps, string, BadgeTone, string] => [
    status,
    { status, cls: 'unknown' },
    'Zpracovává se',
    'info',
    'lucide-loader-circle',
  ]),
  [
    'processing exactly 120 s',
    { status: 'extracting', cls: 'unknown', processingSince: start, now: Date.parse('2026-10-18T10:02:00.000Z') },
    'Zpracovává se',
    'info',
    'lucide-loader-circle',
  ],
  [
    'processing over 120 s',
    { status: 'extracting', cls: 'unknown', processingSince: start, now: Date.parse('2026-10-18T10:02:01.000Z') },
    'Trvá to déle než obvykle',
    'neutral',
    'lucide-clock',
  ],
  ['needs_review', { status: 'needs_review', cls: 'received_invoice' }, 'Ke kontrole', 'warning', 'lucide-circle-alert'],
  ['ready', { status: 'ready', cls: 'received_invoice' }, 'Hotovo', 'success', 'lucide-circle-check'],
  ['finalized', { status: 'finalized', cls: 'received_invoice' }, 'Uzavřeno', 'neutral', 'lucide-lock'],
  ...NON_BOOKABLE.map((cls): [string, StatusBadgeProps, string, BadgeTone, string] => [
    `supporting ${cls}`,
    { status: 'supporting', cls },
    'Podklad',
    'neutral',
    'lucide-paperclip',
  ]),
  ['supporting non_document', { status: 'supporting', cls: 'non_document' }, 'Není doklad', 'neutral', 'lucide-file-x'],
  ['duplicate', { status: 'duplicate', cls: 'received_invoice' }, 'Duplicita', 'neutral', 'lucide-copy'],
  ['failed', { status: 'failed', cls: 'unknown' }, 'Nepodařilo se přečíst', 'destructive', 'lucide-circle-x'],
  [
    'in trash',
    { status: 'ready', cls: 'received_invoice', purgeOn: parseLegalDate('2026-11-17') },
    'V koši (smaže se 17. 11. 2026)',
    'neutral',
    'lucide-trash',
  ],
];

describe('StatusBadge (M11 §4)', () => {
  it.each(rows)('%s → icon + word + tone', (_name, props, word, tone, iconClass) => {
    const { container } = render(<StatusBadge {...props} />);
    const badge = container.querySelector('[data-slot="badge"]');
    expect(badge?.textContent).toBe(word);
    expect(badge?.getAttribute('data-tone')).toBe(tone);
    const svg = badge?.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('class')).toContain(iconClass);
  });

  it('spins only while processing', () => {
    const { container } = render(<StatusBadge status="received" cls="unknown" />);
    expect(container.querySelector('svg')?.getAttribute('class')).toContain('motion-safe:animate-spin');
    cleanup();
    const ready = render(<StatusBadge status="ready" cls="received_invoice" />);
    expect(ready.container.querySelector('svg')?.getAttribute('class')).not.toContain('animate-spin');
  });

  it('links a duplicate to its original', () => {
    const { container } = render(
      <StatusBadge status="duplicate" cls="received_invoice" originalHref="/doklady/1" />,
    );
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/doklady/1');
    expect(link?.textContent).toBe('původní');
  });
});

describe('SecondaryStatusBadge', () => {
  it.each([
    ['not_tax_document', 'Nedaňový', 'info', 'lucide-receipt-text'],
    ['missing_document', 'Chybí doklad', 'warning', 'lucide-file-search'],
  ] as const)('%s → %s', (kind, word, tone, iconClass) => {
    const { container } = render(<SecondaryStatusBadge kind={kind} />);
    const badge = container.querySelector('[data-slot="badge"]');
    expect(badge?.textContent).toBe(word);
    expect(badge?.getAttribute('data-tone')).toBe(tone);
    expect(badge?.querySelector('svg')?.getAttribute('class')).toContain(iconClass);
  });
});
```

Command: `pnpm --filter @shoebox/ui test status-badge 2>&1 | tail -30`. Expected: `Tests  26 passed`. A failure in `src/components/status-badge.tsx`: one fix, rerun; again, or a test looks wrong (for example a Lucide class name differs): STOP. Commit.

**Step 8: format and full checks (no new file).** `biome check --write` may reformat files, test files included; formatting-only changes are allowed. Command: `pnpm exec biome check --write packages/ui packages/i18n 2>&1 | tail -5 && pnpm --filter @shoebox/ui test 2>&1 | tail -8 && pnpm --filter @shoebox/ui typecheck 2>&1 | tail -5 && pnpm lint 2>&1 | tail -15`. Expected: all pass, no `error TS`, lint without errors. Commit.

## 5. Do not touch

`packages/ui/src/primitives/**`, `packages/ui/test/render.tsx`, `primitives.test.tsx`, `tokens.css`, `theme.css`; `packages/domain/**`; `packages/ui/package.json` and `pnpm-lock.yaml` (no dependency change in this brief); every i18n key not listed in steps 1–2. Hard rules 1 (no float for money), 6 (strings through i18n, tokens only), 7.

## 6. Commands

- `pnpm --filter @shoebox/i18n test 2>&1 | tail -30` → all pass.
- `pnpm --filter @shoebox/ui test money-text legal-date status-badge 2>&1 | tail -30` → 35 passed.
- `pnpm --filter @shoebox/ui typecheck 2>&1 | tail -30` → no `error TS`.
- `pnpm lint 2>&1 | tail -30` → no errors.

## 7. Acceptance

- [ ] `packages/ui/test/status-badge.test.tsx`: every row of M11 §4 renders icon + word + tone (both secondary badges included).
- [ ] `money-text.test.tsx`: `1 234,56 Kč` with NBSP and tabular numerals (`num` class).
- [ ] `legal-date.test.tsx`: `18. 10. 2026`.
- [ ] i18n catalog test passes with the 13 new keys in cs and en.
- Not in this brief: the axe check and `test:a11y` (0015c); LegalDateText relative mode (deferred, see §2). No screen changes, so no screenshot.

## 8. Stop and ask

Stop, and write the report, if:

- an anchor is not found verbatim, or 0015a is not in phase/0;
- a test fails twice, or a test this brief wrote seems wrong;
- you reach 25 tool calls or about 50k tokens (report as `blocked`, see executor.md);
- a dependency or lockfile change seems needed;
- a file outside §3 needs a change;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy.

## 9. Report

Write `docs/tasks/0015b-report.md` (600 tokens at most) and set `Status: review` here. Contents: `git diff --stat origin/phase/0`; each §6 command with its last 5 lines; §7 ticked; deviations; questions. Then `git add -A && git commit -qm "0015b report" && git push -u origin task/0015b-ui-status 2>&1 | tail -3`. The orchestrator opens and merges the PR.

## Risk list (for the reviewer)

- `format-text.tsx`: money stays a string end to end (no `Number(value)`, no `parseFloat`).
- `status-badge.tsx` against the M11 §4 table: words, tones, trash before status, slow only above 120 s.
- `cs.json` / `en.json`: only the 13 keys added; Czech words match M11 §4 exactly.

## Owner steps

None.
