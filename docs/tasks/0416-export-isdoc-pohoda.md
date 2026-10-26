# 0416: Accountant ZIP also carries ISDOC files and a Pohoda XML

Status: todo
Ticket: lane D, M10 §4 (files `isdoc/…`, `pohoda_{ICO}_{period}_v1.xml`), K-B03 wiring | Depends on: lane B 0216 (merged) | Branch: claude/project-thread-yn56ih | PR base: phase/0
Executor: Sonnet 5.5 (money mapping across several tables) | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

The ZIP from `/api/export?period=…` (Accountant page) keeps the originals and the Excel register, and adds:
- `isdoc/{name}.isdoc` for every document that `buildIsdoc` can express (CZK invoices, credit notes and simplified tax documents);
- `pohoda_{ICO}_{periodKey}_v1.xml` from `buildPohodaDataPack` with all bookable documents of the period.

The accountant imports the files instead of retyping them. Money stays as decimal strings end to end (rule 1, never `Number`).

## 2. Context

- Builders (lane B, read their input types first): `packages/exports/src/isdoc/build.ts` (`IsdocExportInput`, `buildIsdoc` returns null when not expressible) and `packages/exports/src/pohoda/types.ts` + `build.ts` (`PohodaInput`, `PohodaProfile`, `buildPohodaDataPack(input, profile) → { xml, items, warnings }`).
- K-B03: Pohoda is CZK only, summary mode, and emits no členění/předkontace until the accountant maps them. So the profile uses `classificationVAT: {}` and `accounting: {}` (warnings, not errors). M10 §5 says the same: unmapped → omitted.
- Current export: `apps/web/src/documents/export-data.ts` (`loadExportDocs`, columns list) and `apps/web/app/api/export/route.ts`. Names: `exportEntryName` in `export-period.ts`.
- Tables (check column names in `docs/v3/05-data-model.md` §4 with `grep -n`; do not guess): `documents` (class, revision, direction, partner_snapshot, buyer_snapshot, document_number, variable_symbol, issue_date, duzp, received_date?, vat_point_date?, due_date, currency, total_gross, payment_method, pay_to_account), `document_vat_summary` (vat_rate_type, vat_rate_pct, base, vat), `document_lines` (net, vat, gross, vat_rate_type, vat_rate_pct, vat_treatment, category_code), `categories` (code, label_cs), `organizations` (name, ico, dic), `taxpayer_profiles` (vat_status; current = `currentProfile` in `src/settings/settings-data.ts`). Drop any field whose column does not exist (pass null) and say so in the report.
- ISDOC document type: `received_invoice`/`issued_invoice` → `'1'`, `*_credit_note` → `'2'`, `received_advance_tax_doc` → `'5'`, `received_receipt` → `'7'`; any other class → no ISDOC. Direction `in` (received_*): supplier = partner snapshot, customer = the org; `out` (issued_*): the reverse. `notTaxDocument` = `tax_doc_status === 'not_tax_document'`.
- Pohoda documents: only classes the builder handles (read `build.ts`: it decides the agenda); skip `deleted_at` (already filtered) and documents without lines AND without a VAT summary.

## 3. Files

| Path | Action |
|---|---|
| `apps/web/src/documents/export-formats.ts` | new: pure mappers + one loader |
| `apps/web/test/export-formats.test.ts` | new |
| `apps/web/app/api/export/route.ts` | edit: add the files |
| `docs/context/known-issues.md` | edit: K-B03 row, drop "and is not yet wired into the accountant package" and its "package wiring" fix note |

## 4. Steps

1. `export-formats.ts`:
   - `export interface FormatDoc` (the joined row you load) and `export interface FormatOrg { name; ico; dic; vatStatus }`.
   - `export function isdocTypeOf(cls: string): '1' | '2' | '5' | '7' | null` (table above).
   - `export function isdocInputOf(orgId: string, org: FormatOrg, doc: FormatDoc): IsdocExportInput | null`: null when no type, no number, no issue date or no gross total.
   - `export function pohodaDocumentOf(doc: FormatDoc): PohodaDocument | null`.
   - `export function pohodaProfileOf(org: FormatOrg, labels: ReadonlyMap<string, string>): PohodaProfile` (`classificationVAT: {}`, `accounting: {}`, `categoryLabel: (code) => labels.get(code) ?? code`).
   - `export async function loadFormatData(supabase, orgId, documentIds: readonly string[]): Promise<{ org: FormatOrg; docs: FormatDoc[]; labels: Map<string, string> } | null>`: one documents query with embedded `document_vat_summary(...)` and `document_lines(...)`, `.eq('org_id', orgId).in('id', ids)` (chunks of 200 ids); organizations by id; taxpayer_profiles of the org → current vat_status (fallback `'neplatce'`); categories `code, label_cs`. Any error → null.
2. Test `export-formats.test.ts`: at least these cases, with literal fixture objects:
   - a received CZK invoice maps to an ISDOC input whose supplier is the partner, customer the org, vatRows from the summary, money strings unchanged (`'1210.00'` stays `'1210.00'`), and `buildIsdoc(...)` returns a string containing the document number;
   - an `issued_invoice` swaps supplier and customer; a `contract` gives null;
   - `pohodaDocumentOf` keeps lines and the VAT summary as strings and maps the partner address; `buildPohodaDataPack({ periodLabel: '2026-Q3', version: 1, documents: [doc] }, profile)` returns XML containing the number and at least one `unmapped_*` warning.
3. `route.ts`: after the Excel entry, `const formats = await loadFormatData(supabase, auth.orgId, docs.map((d) => d.row.id))` (use the real id field of `RegisterRow`). When not null:
   - each non-null `buildIsdoc(isdocInputOf(...))` → entry `isdoc/` + the same base name the original file got (or `exportEntryName` with a `.isdoc` extension when there is no file; names unique within `isdoc/`), data `new TextEncoder().encode(xml)`;
   - Pohoda documents (non-null) → when at least one, `buildPohodaDataPack({ periodLabel: period.key, version: 1, documents }, pohodaProfileOf(...))` → entry `pohoda_${org.ico}_${period.key}_v1.xml`; header `X-Export-Warnings: String(result.warnings.length)`.
   - A builder that throws must not break the ZIP: wrap each call in try/catch, count it into `X-Export-Skipped`.
4. Known-issues edit (step 3 of §3 table).
5. Checks: `pnpm --filter @shoebox/web test -- export-formats 2>&1 | tail -8`, `pnpm --filter @shoebox/web typecheck 2>&1 | tail -10`, `pnpm exec biome check apps/web/src/documents apps/web/app/api/export apps/web/test/export-formats.test.ts 2>&1 | tail -8` (fix your files with `--write`), `python3 scripts/context_lint.py 2>&1 | tail -3`.

## 5. Do not touch

`packages/exports` (lane B owns it; if a builder bug blocks you, stop and report it), other routes, migrations. Hard rules 1, 3, 4 (no document content in logs).

## 6. Commands

As in step 5.

## 7. Acceptance

- [ ] export-formats tests pass; typecheck 0; biome clean; context lint OK; money never passes through `Number`/`parseFloat` (grep your diff).

## 8. Stop and ask

As TEMPLATE §8.

## 9. Report

`docs/tasks/0416-report.md`, 200 tokens at most, list any columns that did not exist. Set `Status: review`.
