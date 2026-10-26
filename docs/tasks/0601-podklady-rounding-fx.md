# 0601: Podklady whole-Kč summary line (K-C05) + CZK conversion of private-use rows

Status: todo
Ticket: accountant review 2026-10-26 (K-C05) | Depends on: — | Branch: claude/project-thread-owbjjp | PR base: phase/0
Executor: Sonnet 5.5 (money: changes amounts the accountant reads; SQL + domain FX) | Fits one session: 16 tool calls, 45k tokens

## 1. Objective

1. The podklady XLSX "Summary" sheet shows expenses in whole Kč like the base it sits next to (income − expenses = base on the sheet), with the haléře total on its own line.
2. `readPodkladyRows` returns private-use amounts in CZK: a personal document in a foreign currency is converted at the ČNB rate, and a partial-share line takes the CZK amount the tax ledger already booked for it.

## 2. Context (accountant review 2026-10-26, `reviews/accountant-review-2026-10-26.md` §1)

- Daňová evidence (ZDP § 7b) keeps exact haléře; every line of the DPFO summary is in whole Kč, rounded half up (form instructions). The domain already rounds: `buildPodkladySummary` sets `headline.expenses = round0(totals.deductibleTotal)` and `headline.base = round0(income) − headline.expenses` (`packages/domain/src/income-tax/summary.ts`). The PDF prints `headline.expenses`. Only the XLSX prints `totals.deductibleTotal` (haléře) on the "Expenses" line, so on the sheet income − expenses ≠ base.
- ZDP § 38 odst. 1: amounts in a foreign currency are converted to CZK (ČNB rate, or the GFŘ jednotný kurz). `packages/db/src/podklady.ts` reads `documents.total_gross` (personal documents) and `document_lines.gross` (partial-share lines) in the document currency and labels them CZK.
- `documents.fx_rate numeric(12,6)` is the ČNB rate **per one unit** of `documents.currency` to CZK, filled by the categorize step when the document is foreign (`apps/worker/src/categorize/plan.ts`, `fxRateToCzk = doc.fxRate ?? fxAtIssue.perUnit`). It can be null (document never categorized). `fx_rates` (global table: `rate_date, currency, amount, rate`) holds the ČNB fixing for `amount` units. The domain resolves a rate with `resolveFxRate(currency, date, rows, 'rate_valid_on_date_else_last_published', maxLookbackDays)` and converts with `round2(convertToCzk(money, fx))` (`packages/domain/src/fx.ts`); the look-back is the rule `fx.max_lookback_days` (7).
- The tax ledger (`tax_ledger_entries`) already holds every booked line in CZK (`amount_czk`, converted at the ČNB rate of the payment date, K-C01 basis: a deducting payer's net). A partial-share line's CZK total for the year is `Σ amount_czk` of its entries with `tax_year = year` (any `basis`; provisional entries are the unpaid remainder).
- Money is never a float (rule 1). SQL returns `::text`, TS parses with `Money.parse`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/exports/src/podklady-xlsx.ts` | edit | Summary rows |
| `packages/exports/test/podklady-xlsx.test.ts` | edit | expectations |
| `packages/db/src/podklady.ts` | edit | CZK private-use rows, `privateUseFxMissing`, look-back parameter |
| `apps/web/src/podklady/load.ts` | edit | pass the look-back |
| `packages/db/test/podklady.db.test.ts` | edit | EUR personal document, ledger-based partial share |

## 4. Steps

### Step 1: `packages/exports/src/podklady-xlsx.ts`

Anchor (verbatim):

```ts
    // Actual expenses in haléře (Σ business amounts); the domain headline rounds to whole CZK.
    headline.label === 'flat'
      ? ['Flat-rate expenses', num(headline.expenses)]
      : ['Expenses', num(totals.deductibleTotal)],
    ['Base before adjustments', num(headline.base)],
```

Replace with:

```ts
    // Whole-Kč summary lines (DPFO form: "v celých Kč", K-C05); the haléře total follows on its own line.
    headline.label === 'flat'
      ? ['Flat-rate expenses', num(headline.expenses)]
      : ['Expenses', num(headline.expenses)],
    ...(headline.label === 'flat'
      ? []
      : [['Expenses before rounding', num(totals.deductibleTotal)] as Row]),
    ['Base before adjustments', num(headline.base)],
```

Command: `pnpm --filter @shoebox/exports typecheck 2>&1 | tail -30` → no errors.

### Step 2: `packages/exports/test/podklady-xlsx.test.ts`

Anchor: `it('Summary: income 240 000,00; expenses 98 459,81; base 141 540; flat comparison at 60 %; disclaimer text', () => {`
→ `it('Summary: income 240 000,00; expenses 98 460 (98 459,81 before rounding); base 141 540; flat comparison at 60 %; disclaimer text', () => {`

Anchor: `    expect(row('Summary', 'Expenses')).toEqual(['Expenses', { num: '98459.81' }]);`
Replace with:

```ts
    expect(row('Summary', 'Expenses')).toEqual(['Expenses', { num: '98460.00' }]);
    expect(row('Summary', 'Expenses before rounding')).toEqual([
      'Expenses before rounding',
      { num: '98459.81' },
    ]);
```

Command: `pnpm --filter @shoebox/exports test -- podklady-xlsx 2>&1 | tail -30` → green. Also run `pnpm --filter @shoebox/exports test -- podklady-pdf 2>&1 | tail -30` (must stay green; the PDF is untouched).

### Step 3: `packages/db/src/podklady.ts`

3a. Imports. Anchor: `  type ReadinessInput,` (inside the `@shoebox/domain` import block) → add after it the lines `  resolveFxRate,` and `  convertToCzk,` and `  round2,` (keep alphabetical order if biome complains: `convertToCzk` and `round2` and `resolveFxRate` are all exported from `@shoebox/domain`).

3b. Result type. Anchor:

```ts
  readonly ledgerHash: string;
  readonly documents: ReadonlyArray<{ documentId: string; revision: number }>;
}
```

Replace with:

```ts
  readonly ledgerHash: string;
  readonly documents: ReadonlyArray<{ documentId: string; revision: number }>;
  /** Personal documents in a foreign currency with no ČNB rate (excluded from privateUse). */
  readonly privateUseFxMissing: readonly string[];
}
```

3c. Signature. Anchor:

```ts
  year: number,
  currentLedgerAlgo: bigint,
): Promise<PodkladyRows> {
```

Replace with:

```ts
  year: number,
  currentLedgerAlgo: bigint,
  /** Rule `fx.max_lookback_days`: how far back a ČNB rate may be taken for a personal document. */
  fxMaxLookbackDays: number,
): Promise<PodkladyRows> {
```

3d. Personal documents. Anchor:

```ts
  const personalRows = await rowsOf<{ document_id: string; paid_at: string; amount: string }>(
    tx,
    sql`select id as document_id, paid_at::text, coalesce(total_gross, 0)::text as amount
        from documents
        where org_id = ${orgId} and business_flag = 'personal' and deleted_at is null
          and paid_at between ${yearStart}::date and ${yearEnd}::date
        order by paid_at, id`,
  );
```

Replace with:

```ts
  const personalRows = await rowsOf<{
    document_id: string;
    paid_at: string;
    currency: string;
    amount: string;
    fx_rate: string | null;
  }>(
    tx,
    sql`select id as document_id, paid_at::text, currency, coalesce(total_gross, 0)::text as amount, fx_rate::text
        from documents
        where org_id = ${orgId} and business_flag = 'personal' and deleted_at is null
          and paid_at between ${yearStart}::date and ${yearEnd}::date
        order by paid_at, id`,
  );
  // ZDP § 38: foreign amounts enter the podklady in CZK. documents.fx_rate is the per-unit ČNB rate
  // set at categorization; without it, the ČNB fixing of the payment date (fx_rates) is used.
  const foreignCurrencies = [...new Set(personalRows.map((r) => r.currency).filter((c) => c !== 'CZK'))];
  const fxRows =
    foreignCurrencies.length === 0
      ? []
      : await rowsOf<{ rate_date: string; currency: string; amount: number; rate: string }>(
          tx,
          sql`select rate_date::text, currency, amount, rate::text from fx_rates
              where currency in (${sql.join(foreignCurrencies.map((c) => sql`${c}`), sql`, `)})
                and rate_date between (${yearStart}::date - ${fxMaxLookbackDays}::int) and ${yearEnd}::date
              order by rate_date`,
        );
  const privateUseFxMissing: string[] = [];
  const personalDocuments: PrivateUseInput['personalDocuments'][number][] = [];
  for (const r of personalRows) {
    const paidAt = parseLegalDate(r.paid_at);
    if (r.currency === 'CZK') {
      personalDocuments.push({ documentId: r.document_id, paidAt, amountCzk: czk(r.amount) });
      continue;
    }
    const foreign = Money.parse(r.amount, r.currency as Currency);
    if (r.fx_rate !== null) {
      personalDocuments.push({
        documentId: r.document_id,
        paidAt,
        amountCzk: round2(Money.fromDecimal(foreign.toDecimal().times(r.fx_rate), CZK)),
      });
      continue;
    }
    const fx = resolveFxRate(
      r.currency as Currency,
      paidAt,
      fxRows.map((x) => ({
        rateDate: parseLegalDate(x.rate_date),
        currency: x.currency as Currency,
        amount: x.amount,
        rate: x.rate,
      })),
      'rate_valid_on_date_else_last_published',
      fxMaxLookbackDays,
    );
    if (fx === null) {
      privateUseFxMissing.push(r.document_id);
      continue;
    }
    personalDocuments.push({ documentId: r.document_id, paidAt, amountCzk: round2(convertToCzk(foreign, fx)) });
  }
```

Add `Currency` to the `@shoebox/domain` type imports (`type Currency,`). If `Money.fromDecimal` is not exported, use `Money.parse(foreign.toDecimal().times(r.fx_rate).toFixed(6), CZK)` instead.

3e. Partial-share lines. Anchor:

```ts
    sql`select l.document_id, l.id as line_id, l.description, coalesce(l.gross, 0)::text as total, l.business_share_pct::text as share
        from document_lines l
        join documents d on d.id = l.document_id and d.org_id = l.org_id
        where l.org_id = ${orgId} and l.business_share_pct > 0 and l.business_share_pct < 100
          and d.status in ('ready', 'finalized') and d.deleted_at is null and d.class in (${bookable})
          and coalesce(d.paid_at, d.issue_date) between ${yearStart}::date and ${yearEnd}::date
        order by d.issue_date, l.document_id, l.position`,
```

Replace with (the CZK total is what the tax ledger booked for the line in the year, K-C01 basis):

```ts
    sql`select l.document_id, l.id as line_id, l.description,
               coalesce((select sum(e.amount_czk) from tax_ledger_entries e
                         where e.org_id = l.org_id and e.line_id = l.id and e.tax_year = ${year}), 0)::text as total,
               l.business_share_pct::text as share
        from document_lines l
        join documents d on d.id = l.document_id and d.org_id = l.org_id
        where l.org_id = ${orgId} and l.business_share_pct > 0 and l.business_share_pct < 100
          and d.status in ('ready', 'finalized') and d.deleted_at is null and d.class in (${bookable})
          and exists (select 1 from tax_ledger_entries e
                      where e.org_id = l.org_id and e.line_id = l.id and e.tax_year = ${year})
        order by d.issue_date, l.document_id, l.position`,
```

3f. Use the new list. Anchor:

```ts
    personalDocuments: personalRows.map((r) => ({
      documentId: r.document_id,
      paidAt: parseLegalDate(r.paid_at),
      amountCzk: czk(r.amount),
    })),
```

Replace with `    personalDocuments,`.

3g. Return the new field: find the `return {` of `readPodkladyRows` (it lists `ledgerHash` and `documents`) and add `privateUseFxMissing,` after `documents`.

Command: `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30` → no errors.

### Step 4: `apps/web/src/podklady/load.ts`

Anchor: `    rows: await readPodkladyRows(tx, orgId, year, BigInt(LEDGER_ALGO_VERSION)),`
Replace with:

```ts
    rows: await readPodkladyRows(
      tx,
      orgId,
      year,
      BigInt(LEDGER_ALGO_VERSION),
      rules.at(`${year}-12-31`).get('fx.max_lookback_days'),
    ),
```

(`rules` is `createCzRules()` two lines above.) If `rules.at(...)` needs a `LegalDate`, wrap with `parseLegalDate` from `@shoebox/domain`.

Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` → no errors. Then `grep -rn 'readPodkladyRows(' apps packages --include=*.ts | grep -v export` and fix any other caller the same way (the DB test is step 5).

### Step 5: `packages/db/test/podklady.db.test.ts`

5a. Anchor: `    db.withTenant(org, (tx) => readPodkladyRows(tx, org, year, LEDGER_ALGO));` → `    db.withTenant(org, (tx) => readPodkladyRows(tx, org, year, LEDGER_ALGO, 7));`

5b. Add a constant `const D_EUR = id(7);` after `const D_B = id(6);`.

5c. In the `insert into documents (...)` seed (anchor: the line starting `    await sql\`insert into documents (id, org_id, entry_mode, status, class, direction, currency, issue_date, paid_at, total_gross, business_flag, revision) values`), add one more row for org A: `D_EUR`, the same entry_mode/status as the other personal row, class `received_receipt`, direction `in`, currency `EUR`, issue_date `2026-05-03`, paid_at `2026-05-03`, total_gross `100.00`, business_flag `personal`, revision 1. Then add, right after that statement: `await sql\`update documents set fx_rate = '25.000000', fx_rate_date = '2026-05-03' where id = ${D_EUR}\`;`

5d. Extend the test at the anchor `      expect(privateUse.partialShareLines.map((l) => l.lineId)).toEqual([L_SMALL]);` → add after it:

```ts
      expect(privateUse.partialShareLines[0]?.totalCzk.toFixed2()).toBe('3000.00');
      expect(privateUse.personalDocuments.find((p) => p.documentId === D_EUR)?.amountCzk.toFixed2()).toBe(
        '2500.00',
      );
      expect(rows.privateUseFxMissing).toEqual([]);
```

Use the variable names the test already uses for the read result (read the 10 lines around the anchor first; if the result object is not called `rows`, use its name).

Command: `pnpm db:start 2>&1 | tail -5 && DATABASE_URL=<as the repo's db test setup prints> pnpm --filter @shoebox/db test -- podklady 2>&1 | tail -30`. If `pnpm db:start` is not available in this container, run `pnpm --filter @shoebox/db test -- podklady 2>&1 | tail -30` (the suite skips without `DATABASE_URL`) and write in the report: "DB test not run here, CI runs it".

## 5. Do not touch

- The PDF, the Private sheet layout, the `privateUseFxMissing` list in the UI (a later brief lists it on the Missing sheet). Do not touch `packages/domain`.

## 6. Commands

- `pnpm --filter @shoebox/exports test -- podklady-xlsx 2>&1 | tail -30`
- `pnpm --filter @shoebox/exports test -- podklady-pdf 2>&1 | tail -30`
- `pnpm --filter @shoebox/exports typecheck 2>&1 | tail -30`
- `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30`
- `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`
- `pnpm --filter @shoebox/db test -- podklady 2>&1 | tail -30`

## 7. Acceptance

- [ ] XLSX Summary: `Expenses` 98 460,00, `Expenses before rounding` 98 459,81, `Base before adjustments` 141 540,00 (income 240 000 − 98 460).
- [ ] `readPodkladyRows` converts a EUR personal document with `fx_rate` 25 and total 100 to 2 500,00 CZK; a partial-share line's `totalCzk` equals its ledger sum.
- [ ] All typechecks green; exports tests green.

## 8. Stop and ask

An anchor is not found verbatim, a test the brief wrote seems wrong, or a step admits two readings: stop, write the report with `Status: blocked` and the question.

## 9. Report

`docs/tasks/0601-report.md` per `docs/context/executor.md`. Commit as `0601 step k`. Do not push and do not open a PR: the orchestrator merges this branch.
