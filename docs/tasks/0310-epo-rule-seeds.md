# 0310: seed `epo.dphdp3_row_map` and `epo.kh_routing` into the 2025 and 2026 rule years

Status: done
Ticket: P1-LEDG-02 (a, seeding part) | Depends on: 0302, 0309 | Base commit: 496b1e9 | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 20 tool calls, 40k tokens

## 1. Objective

The typed row map and KH routing data from brief 0309 (`packages/domain/src/rules/cz/epo.ts`) become rule entries, so that `rules.at(date).get('epo.dphdp3_row_map')` and `rules.at(date).get('epo.kh_routing')` resolve in both seeded years and the VAT ledger (brief 0311) reads them only through the resolver. Also export the `epo.ts` module from the package index.

## 2. Context

Hard rule 1: row maps live only in `packages/domain/src/rules`; M05 §4.2 step 8 (pasted): "rows come from `rules.at(vat_point_date).get('epo.dphdp3_row_map')`; no row number is written in code". 06 §2.1 lists `epo.dphdp3_row_map` and `epo.kh_routing` as yearly-verified law keys (the form version changes with the year). Both keys already exist in `RULE_SCHEMAS` (`law.ts`), so `rules-keys.test.ts` ("75 keys") does not change.

State of the files after briefs 0302 and 0309 (the anchors below assume it; if an anchor is missing, stop and ask):

- `packages/domain/src/rules/cz/2025.ts` and `2026.ts` each have `const KH_METHODOLOGY = 'https://financnisprava.gov.cz/assets/cs/prilohy/d-seznam-dani/Metodicka_informace_k_vyplneni_KH_20240101.pdf';`, a `base(key, source, value)` helper (2025: `valid_from '2025-01-01'`, `valid_to '2025-12-31'`; 2026: open-ended), the line `base('vat.kh_document_limit', KH_METHODOLOGY, 10_000),` and, from 0302, three entries ending with `{ ...base('vat.reduced_rate_categories', \`${ZDPH}#p47\`, []), verified_at: '2026-10-26' },`.
- `packages/domain/test/rules-values.test.ts` has (from 0302) `SEEDED_KEYS` with 21 keys, `PRIMARY_HOSTS` ending in `'github.com',`, `expect(RULES_CZ_2025).toHaveLength(21); expect(RULES_CZ_2026).toHaveLength(22);`, the `valid_from === '2026-01-01'` filter expecting 21, and the verified_at list `['2026-10-18', '2026-10-25', '2026-10-26']`.
- `packages/domain/src/rules/cz/epo.ts` exports `CZ_DPHDP3_ROW_MAP`, `CZ_KH_ROUTING`, `parseDphdp3RowMap`, `parseKhRouting` (0309).

Source URLs: the DPHDP3 form structure is published by the Financial Administration's EPO at `https://adisspr.mfcr.cz/dpr/adis/idpr_pub/epo2_info/popis_struktury_detail.faces?zkratka=DPHDP3` `[verify]` (record in the report whether the page lists the `VetaD`/`Veta1`..`Veta6` attributes; the executor does not need network access to finish). KH routing uses the GFŘ methodology already referenced as `KH_METHODOLOGY`.

Counts after this brief: 2025 has 21 + 2 = 23 entries, 2026 has 22 + 2 = 24, of which 23 start on 2026-01-01 (the extra 2026 entry is the July insurance amendment, unchanged).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/src/rules/cz/2025.ts` | edit | two entries |
| `packages/domain/src/rules/cz/2026.ts` | edit | two entries |
| `packages/domain/test/rules-values.test.ts` | edit | counts, keys, hosts, one describe |
| `packages/domain/src/index.ts` | edit | export `epo.ts` |

## 4. Steps

1. Edit `packages/domain/test/rules-values.test.ts` (all anchors must be found):

   a. In `SEEDED_KEYS`, replace `  'deadlines.generators',\n` with `  'deadlines.generators',\n  'epo.dphdp3_row_map',\n  'epo.kh_routing',\n` (alphabetical order; `SEEDED_KEYS` now has 23 keys).

   b. In `PRIMARY_HOSTS`, replace `  'eur-lex.europa.eu',\n` with `  'eur-lex.europa.eu',\n  'adisspr.mfcr.cz',\n`.

   c. Replace `expect(RULES_CZ_2025).toHaveLength(21);\n    expect(RULES_CZ_2026).toHaveLength(22);` with `expect(RULES_CZ_2025).toHaveLength(23);\n    expect(RULES_CZ_2026).toHaveLength(24);`; replace `.filter((entry) => entry.valid_from === '2026-01-01')).toHaveLength(21);` with `.filter((entry) => entry.valid_from === '2026-01-01')).toHaveLength(23);`.

   d. Add to the import from `'../src/rules/index'` nothing; add a new import line after it: `import { parseDphdp3RowMap, parseKhRouting } from '../src/rules/cz/epo';` (biome's organizeImports may reorder it).

   e. Append at the end of the file:

   ```ts
   describe('EPO row map and KH routing (brief 0310)', () => {
     it('resolve in both years and parse with the strict schemas', () => {
       for (const date of ['2025-01-01', '2025-12-31', '2026-01-01', '2026-10-26']) {
         const at = rules.at(date);
         const rows = parseDphdp3RowMap(at.get('epo.dphdp3_row_map'));
         expect(rows).toHaveLength(19);
         expect(rows.map((r) => r.row)).toContain('5');
         const kh = parseKhRouting(at.get('epo.kh_routing'));
         expect(kh.version).toBe(1);
         expect(kh.rules.length).toBeGreaterThan(0);
       }
       expect(rules.at('2024-12-31').has('epo.dphdp3_row_map')).toBe(false);
     });

     it('the seeded entries carry a primary-source URL and the 2026-10-26 verification', () => {
       for (const entry of CZ_RULE_ENTRIES.filter((e) => e.key === 'epo.dphdp3_row_map' || e.key === 'epo.kh_routing')) {
         expect(entry.layer).toBe('base');
         expect(entry.verified_at).toBe('2026-10-26');
         expect(['adisspr.mfcr.cz', 'financnisprava.gov.cz']).toContain(new URL(entry.source).hostname);
       }
     });
   });
   ```

   Command: `pnpm --filter @shoebox/domain test -- rules-values 2>&1 | tail -30`. Expected: fails (counts and missing keys).

2. Edit `packages/domain/src/rules/cz/2025.ts`:

   a. After the line `import type { RuleEntryInput } from '../segment';` add `import { CZ_DPHDP3_ROW_MAP, CZ_KH_ROUTING } from './epo';`.

   b. After the `KH_METHODOLOGY` constant add:

   ```ts
   /** EPO: published structure of the DPHDP3 form (přiznání k DPH), rows and XML attributes. [verify] */
   const DPHDP3_STRUCTURE =
     'https://adisspr.mfcr.cz/dpr/adis/idpr_pub/epo2_info/popis_struktury_detail.faces?zkratka=DPHDP3';
   ```

   c. Replace `  { ...base('vat.reduced_rate_categories', \`${ZDPH}#p47\`, []), verified_at: '2026-10-26' },` with

   ```ts
     { ...base('vat.reduced_rate_categories', `${ZDPH}#p47`, []), verified_at: '2026-10-26' },
     // DPHDP3 row map (M05 §4.2 step 8, research/czech-tax-filings.md §2). Rows 40/41/42/50 carry
     // `confirmed: false` until Phase 3 checks their attrs against the XSD; see cz/epo.ts.
     { ...base('epo.dphdp3_row_map', DPHDP3_STRUCTURE, CZ_DPHDP3_ROW_MAP), verified_at: '2026-10-26' },
     // KH sections per treatment (research/czech-tax-filings.md §1.3.1); the 10 000 Kč split is
     // `vat.kh_document_limit`.
     { ...base('epo.kh_routing', KH_METHODOLOGY, CZ_KH_ROUTING), verified_at: '2026-10-26' },
   ```

3. Edit `packages/domain/src/rules/cz/2026.ts` the same way (same three edits; identical text). The 2026 segments are open-ended through `base`, nothing else changes.

   Command: `pnpm exec biome check --write packages/domain/src/rules/cz/2025.ts packages/domain/src/rules/cz/2026.ts 2>&1 | tail -5`, then `pnpm --filter @shoebox/domain test -- rules 2>&1 | tail -30`. Expected: all `rules-*` test files green (`rules-law` still passes: the loose law schema accepts the strict rows; `rules-keys` unchanged at 75).

4. Edit `packages/domain/src/index.ts`. Anchor: `export * from './rules/index';`. Insert before it: `export * from './rules/cz/epo';`. Typecheck and biome (§6). Also run `pnpm --filter @shoebox/domain test -- epo-rows kh-routing 2>&1 | tail -30` (the 0309 tests must stay green).

## 5. Do not touch

`epo.ts` data (0309 owns it), `law.ts`, other test files, other packages. Hard rule 1.

## 6. Commands

- `pnpm --filter @shoebox/domain test -- rules 2>&1 | tail -30`
- `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`
- `pnpm exec biome check packages/domain 2>&1 | tail -10`

## 7. Acceptance

- [ ] `rules-values`, `rules-keys`, `rules-law`, `epo-rows`, `kh-routing` green; `rules-keys` still says 75.
- [ ] `rules.at('2026-10-26').get('epo.dphdp3_row_map')` has 19 rows; `.get('epo.kh_routing').version === 1`.
- [ ] Commits `0310 step 1..4`; no push.

## 8. Stop and ask

As TEMPLATE §8. Also stop if the `rules-values.test.ts` anchors do not match (0302 not merged yet).

## 9. Report

`docs/tasks/0310-report.md`, `Status: review`, commit `0310 report`. Record the `[verify]` on `DPHDP3_STRUCTURE` (checked or not).

## Spec notes for the reviewer

- 06 §2.1 lists both keys as law keys verified yearly; the 2025 and 2026 values are identical today (form version 2025 vs 2026 is a Phase 3 `epo.forms` concern, not a row-map difference).
- The row map's `source` is the EPO structure page, not the ZDPH; the rows are an administrative form layout.

## Risk list (for the reviewer)

`packages/domain/src/rules/cz/2025.ts`, `2026.ts` (imports from `./epo`: a circular import is impossible, `epo.ts` imports only enums and money).

## Owner steps

None.
