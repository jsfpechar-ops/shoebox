# 0620: Create document lines from the VAT recap when a document is read

Status: todo
Ticket: P1-M02 lines | Depends on: none | Base commit: 6e7c134 | Branch: claude/project-thread-vvw1j4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

A document read by the worker (AI, QR, PDF text or ISDOC) gets no `document_lines` rows today, so categorization throws `no lines` and nothing reaches the tax and VAT ledgers. After this brief `saveDocumentReading` writes one `item` line per VAT-recap row (plus a `rounding` line when `documents.rounding` is not zero), and a re-read replaces the lines while keeping what the user classified by hand.

## 2. Context

- Hard rule 1: money is never a float. Use `Money` from `@shoebox/domain` (`Money.parse('1234.56', 'CZK')`, `.add()`, `.isZero()`, `.compare()`, `.toString()` gives `'1234.56'` or `'1210'`). Strings only in Drizzle.
- M02 §6 step 5: "Replace `document_lines` (delete + insert; carry `category_code`, `vat_treatment`, `classification_source='user'` from old lines where `(position, gross)` match) and `document_vat_summary`."
- M02 §4 (ISDOC map): `PayableRoundingAmount` → `rounding` (+ a `rounding` line if ≠ 0). Convention (thread "Make review clear and fix false flags", brief 0610): `documents.rounding = printed total − (net + vat)`, two decimals, printed sign; `0` when there is no rounding.
- `document_lines` columns (packages/db/src/schema/document-details.ts): `position` (unique per document), `lineType` (`'item' | 'discount' | 'shipping' | 'fee' | 'rounding' | 'advance_deduction' | 'deposit' | 'text'`), `net`, `vat`, `gross` (numeric strings), `vatRateType` (`'standard' | 'reduced' | 'zero' | 'none'`, default `'none'`), `vatRatePct`, `vatTreatment`, `categoryCode`, `businessSharePct` (default `'100'`), `deductibility`, `classificationSource` (`field_source` enum; `'user'` is a value).
- Excerpt, packages/db/src/document-reading.ts (the recap block inside `saveDocumentReading`):

```ts
  await tx
    .delete(documentVatSummary)
    .where(and(eq(documentVatSummary.orgId, orgId), eq(documentVatSummary.documentId, documentId)));
  if (write.vatSummary.length > 0) {
    await tx
      .insert(documentVatSummary)
      .values(write.vatSummary.map((row) => ({ orgId, documentId, ...row })));
  }
```

- Excerpt, same file, imports:

```ts
import { llmCostUsd } from '@shoebox/domain';
import { and, eq, isNull } from 'drizzle-orm';
import {
  documentFields,
  documentVatSummary,
  extractionRuns,
  validationResults,
} from './schema/document-details';
```

- `write.patch` has `currency`, `totalNet`, `totalVat`, `totalGross` (strings or null). The `documents` update that runs just before the recap block may or may not already set `rounding` (brief 0610 of another thread adds it); this brief therefore reads `documents.rounding` back from the table after that update, so it works either way.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/src/document-lines-of-reading.ts` | new | pure `linesOfReading()` |
| `packages/db/test/document-lines-of-reading.test.ts` | new | unit test (no database) |
| `packages/db/src/document-reading.ts` | edit | replace the lines inside `saveDocumentReading` |
| `packages/db/src/index.ts` | edit | export the new module |
| `packages/db/test/document-reading.db.test.ts` | edit | one new database test (runs in CI only) |

No other file may change.

## 4. Steps

### Step 1: new file `packages/db/src/document-lines-of-reading.ts`

```ts
// Lines of a read document (M02 §6 step 5): one `item` line per VAT-recap row, one line from the
// totals when the document prints no recap, and a `rounding` line when `documents.rounding` ≠ 0.
// Pure: no I/O. Money stays a decimal string (ADR-007).
import { Money } from '@shoebox/domain';

export type ReadingVatRateType = 'standard' | 'reduced' | 'zero' | 'none';

export interface LinesOfReadingInput {
  readonly currency: string;
  readonly vatSummary: readonly {
    readonly vatRateType: ReadingVatRateType;
    readonly vatRatePct: string;
    readonly base: string;
    readonly vat: string;
  }[];
  readonly totalNet: string | null;
  readonly totalVat: string | null;
  readonly totalGross: string | null;
  /** `documents.rounding` as stored; `'0'` when there is none. */
  readonly rounding: string;
}

export interface LineOfReading {
  readonly position: number;
  readonly lineType: 'item' | 'rounding';
  readonly net: string | null;
  readonly vat: string | null;
  readonly gross: string;
  readonly vatRateType: ReadingVatRateType;
  readonly vatRatePct: string | null;
}

function money(text: string | null, currency: string): string | null {
  return text === null ? null : Money.parse(text, currency).toString();
}

/**
 * Rules: (1) one `item` line per recap row, in recap order, `gross = base + vat`; (2) no recap row
 * and a `totalGross`: one `item` line from the totals with rate `none`; (3) no recap and no total:
 * no lines; (4) `rounding` ≠ 0 and at least one line: a final `rounding` line (`net = gross = rounding`,
 * `vat = 0`, rate `none`).
 */
export function linesOfReading(input: LinesOfReadingInput): LineOfReading[] {
  const { currency } = input;
  const lines: LineOfReading[] = input.vatSummary.map((row, i) => {
    const base = Money.parse(row.base, currency);
    const vat = Money.parse(row.vat, currency);
    return {
      position: i + 1,
      lineType: 'item',
      net: base.toString(),
      vat: vat.toString(),
      gross: base.add(vat).toString(),
      vatRateType: row.vatRateType,
      vatRatePct: row.vatRatePct,
    };
  });
  if (lines.length === 0 && input.totalGross !== null) {
    lines.push({
      position: 1,
      lineType: 'item',
      net: money(input.totalNet, currency),
      vat: money(input.totalVat, currency),
      gross: Money.parse(input.totalGross, currency).toString(),
      vatRateType: 'none',
      vatRatePct: null,
    });
  }
  const rounding = Money.parse(input.rounding, currency);
  if (lines.length > 0 && !rounding.isZero()) {
    lines.push({
      position: lines.length + 1,
      lineType: 'rounding',
      net: rounding.toString(),
      vat: '0',
      gross: rounding.toString(),
      vatRateType: 'none',
      vatRatePct: null,
    });
  }
  return lines;
}
```

### Step 2: new file `packages/db/test/document-lines-of-reading.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { linesOfReading } from '../src/document-lines-of-reading';

describe('linesOfReading', () => {
  it('writes one item line per recap row, gross = base + vat', () => {
    expect(
      linesOfReading({
        currency: 'CZK',
        vatSummary: [
          { vatRateType: 'standard', vatRatePct: '21', base: '1000.00', vat: '210.00' },
          { vatRateType: 'reduced', vatRatePct: '12', base: '50.50', vat: '6.06' },
        ],
        totalNet: '1050.50',
        totalVat: '216.06',
        totalGross: '1266.56',
        rounding: '0',
      }),
    ).toEqual([
      { position: 1, lineType: 'item', net: '1000', vat: '210', gross: '1210', vatRateType: 'standard', vatRatePct: '21' },
      { position: 2, lineType: 'item', net: '50.5', vat: '6.06', gross: '56.56', vatRateType: 'reduced', vatRatePct: '12' },
    ]);
  });

  it('falls back to one line from the totals when there is no recap', () => {
    expect(
      linesOfReading({
        currency: 'CZK',
        vatSummary: [],
        totalNet: null,
        totalVat: null,
        totalGross: '249.00',
        rounding: '0',
      }),
    ).toEqual([
      { position: 1, lineType: 'item', net: null, vat: null, gross: '249', vatRateType: 'none', vatRatePct: null },
    ]);
  });

  it('writes nothing without a recap and without a total, even with a rounding', () => {
    expect(
      linesOfReading({
        currency: 'CZK',
        vatSummary: [],
        totalNet: null,
        totalVat: null,
        totalGross: null,
        rounding: '-0.40',
      }),
    ).toEqual([]);
  });

  it('adds a rounding line with the printed sign after the items', () => {
    const lines = linesOfReading({
      currency: 'CZK',
      vatSummary: [{ vatRateType: 'standard', vatRatePct: '21', base: '13654.05', vat: '2868.35' }],
      totalNet: '13654.05',
      totalVat: '2868.35',
      totalGross: '16522.00',
      rounding: '-0.40',
    });
    expect(lines).toHaveLength(2);
    expect(lines[1]).toEqual({
      position: 2,
      lineType: 'rounding',
      net: '-0.4',
      vat: '0',
      gross: '-0.4',
      vatRateType: 'none',
      vatRatePct: null,
    });
  });

  it('keeps credit-note lines negative', () => {
    const [line] = linesOfReading({
      currency: 'CZK',
      vatSummary: [{ vatRateType: 'standard', vatRatePct: '21', base: '-100.00', vat: '-21.00' }],
      totalNet: '-100.00',
      totalVat: '-21.00',
      totalGross: '-121.00',
      rounding: '0',
    });
    expect(line?.gross).toBe('-121');
  });
});
```

Command: `pnpm --filter @shoebox/db exec vitest run test/document-lines-of-reading.test.ts 2>&1 | tail -30` → 5 passed.

### Step 3: edit `packages/db/src/document-reading.ts`

3a. Imports. Replace

```ts
import { llmCostUsd } from '@shoebox/domain';
import { and, eq, isNull } from 'drizzle-orm';
import {
  documentFields,
  documentVatSummary,
  extractionRuns,
  validationResults,
} from './schema/document-details';
```

with

```ts
import { llmCostUsd, Money } from '@shoebox/domain';
import { and, eq, isNull } from 'drizzle-orm';
import { linesOfReading } from './document-lines-of-reading';
import {
  documentFields,
  documentLines,
  documentVatSummary,
  extractionRuns,
  validationResults,
} from './schema/document-details';
```

3b. Lines. Directly after the recap block (anchor: the closing `}` of `if (write.vatSummary.length > 0) { ... }` that inserts `documentVatSummary`), insert:

```ts
  // Lines (M02 §6 step 5): replace, carrying what the user classified by hand where (position, gross) match.
  const [stored] = await tx
    .select({ rounding: documents.rounding })
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.orgId, orgId)))
    .limit(1);
  const currency = write.patch.currency;
  const nextLines = linesOfReading({
    currency,
    vatSummary: write.vatSummary,
    totalNet: write.patch.totalNet,
    totalVat: write.patch.totalVat,
    totalGross: write.patch.totalGross,
    rounding: stored?.rounding ?? '0',
  });
  const oldLines = await tx
    .select({
      position: documentLines.position,
      gross: documentLines.gross,
      categoryCode: documentLines.categoryCode,
      vatTreatment: documentLines.vatTreatment,
      businessSharePct: documentLines.businessSharePct,
      deductibility: documentLines.deductibility,
      classificationSource: documentLines.classificationSource,
    })
    .from(documentLines)
    .where(and(eq(documentLines.orgId, orgId), eq(documentLines.documentId, documentId)));
  await tx
    .delete(documentLines)
    .where(and(eq(documentLines.orgId, orgId), eq(documentLines.documentId, documentId)));
  if (nextLines.length > 0) {
    await tx.insert(documentLines).values(
      nextLines.map((line) => {
        const kept = oldLines.find(
          (old) =>
            old.position === line.position &&
            old.classificationSource === 'user' &&
            old.gross !== null &&
            Money.parse(old.gross, currency).compare(Money.parse(line.gross, currency)) === 0,
        );
        return {
          orgId,
          documentId,
          position: line.position,
          lineType: line.lineType,
          net: line.net,
          vat: line.vat,
          gross: line.gross,
          vatRateType: line.vatRateType,
          vatRatePct: line.vatRatePct,
          ...(kept === undefined
            ? {}
            : {
                categoryCode: kept.categoryCode,
                vatTreatment: kept.vatTreatment,
                businessSharePct: kept.businessSharePct,
                deductibility: kept.deductibility,
                classificationSource: kept.classificationSource,
              }),
        };
      }),
    );
  }
```

Command: `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30` → no errors.

### Step 4: edit `packages/db/src/index.ts`

Anchor: the line `export * from './document-categorize';`. Insert directly before it:

```ts
export * from './document-lines-of-reading';
```

Command: `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30` → no errors.

### Step 5: edit `packages/db/test/document-reading.db.test.ts`

Anchor (inside the test `'saves a reading, and a re-read replaces it cleanly'`):

```ts
    const vat =
      await sql`select vat_rate_type, base, vat from document_vat_summary where document_id = ${DOC}`;
    expect(vat).toEqual([{ vat_rate_type: 'standard', base: '1000.00', vat: '210.00' }]);
```

Insert directly after it:

```ts
    const lines =
      await sql`select position, line_type, net, vat, gross, vat_rate_type, vat_rate_pct from document_lines where document_id = ${DOC} order by position`;
    expect(lines).toEqual([
      {
        position: 1,
        line_type: 'item',
        net: '1000.00',
        vat: '210.00',
        gross: '1210.00',
        vat_rate_type: 'standard',
        vat_rate_pct: '21.00',
      },
    ]);
```

Then add this test directly after the whole `it('saves a reading, and a re-read replaces it cleanly', ...)` block (after its closing `});`):

```ts
  it('a re-read keeps the category the user set on a line with the same position and gross', async () => {
    await db.withTenant(ORG_R, (tx) => saveDocumentReading(tx, write()));
    await sql`update document_lines set category_code = (select code from categories limit 1), classification_source = 'user'
      where document_id = ${DOC} and position = 1`;
    await db.withTenant(ORG_R, (tx) =>
      saveDocumentReading(
        tx,
        write({
          vatSummary: [
            { vatRateType: 'standard', vatRatePct: '21', base: '1000', vat: '210' },
            { vatRateType: 'reduced', vatRatePct: '12', base: '100', vat: '12' },
          ],
        }),
      ),
    );
    const lines =
      await sql`select position, gross, classification_source, category_code is not null as has_category from document_lines where document_id = ${DOC} order by position`;
    expect(lines).toEqual([
      { position: 1, gross: '1210.00', classification_source: 'user', has_category: true },
      { position: 2, gross: '112.00', classification_source: null, has_category: false },
    ]);
  });
```

This test needs a database; it runs in CI. Locally run only: `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30` → no errors, and `pnpm exec biome ci packages/db 2>&1 | tail -30` → no errors.

## 5. Do not touch

`apps/`, `packages/db/migrations/`, `packages/db/src/schema/`, `packages/db/src/imports.ts`, `packages/db/src/document-categorize.ts`, anything in `docs/v3/`. Hard rules 1 (no floats), 3 (every query org-scoped: every `where` above carries `orgId`), 8 (never push to `main`).

## 6. Commands

- `pnpm --filter @shoebox/db exec vitest run test/document-lines-of-reading.test.ts 2>&1 | tail -30` → 5 passed
- `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30` → no errors
- `pnpm exec biome ci packages/db 2>&1 | tail -30` → no errors (run `pnpm exec biome format --write packages/db/src/document-lines-of-reading.ts packages/db/test/document-lines-of-reading.test.ts` first if it complains about formatting only)

## 7. Acceptance

- [ ] `linesOfReading` is exported from `@shoebox/db` and the 5 unit tests pass.
- [ ] `saveDocumentReading` deletes and re-inserts `document_lines` after the recap, with the `rounding` line last.
- [ ] A line whose old row had `classification_source = 'user'` and the same `(position, gross)` keeps its category, treatment, share, deductibility and source.
- [ ] Typecheck and biome are clean. The db tests compile.

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found;
- a test fails twice, or a test the brief wrote seems wrong;
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a new dependency seems needed;
- a file outside §3 needs a change;
- §5 would be touched;
- a step is unclear.

## 9. Report

Write `docs/tasks/0620-report.md` (600 tokens at most) and set `Status: review`. The report has: the files changed (`git diff --stat`), each command with its last 5 lines, §7 ticked, Deviations, Questions. Commit after every step as `0620 step k`. Do not open a PR; the orchestrator does.
