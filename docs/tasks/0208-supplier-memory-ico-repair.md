# 0208: Remember suppliers and repair a misread IČO

Status: review
Ticket: P1-EXT-08 (vendor memory, proto subset) | Depends on: 0202, 0207 | Base commit: branch claude/project-thread-90sd7q | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens
Report: docs/tasks/0208-report.md

## 1. Objective

Every read document with a valid supplier IČO saves that supplier in `partners` and links the document to it. When the next reading has an IČO that fails its check digit and exactly one known supplier is one digit (or one swap) away, the app uses that IČO and shows a warning asking the user to confirm. The AI misreads about 1 IČO in 5; this fixes most of them for repeat suppliers.

## 2. Context

Tables exist (migration 0004, RLS applied): `partners (id, org_id, name not null, ico, dic, vat_id, country, …, unique (org_id, ico))`, `documents.partner_id`. Drizzle: `partners` in `packages/db/src/schema/partners.ts`, `documents` in `schema/documents.ts`. No migration needed. `vendor_profiles` category fields belong to lane C: do not touch `vendor_profiles`.

`icoChecksumValid`, `icoRepairCandidates` from `@shoebox/validation`. Store excerpt (verbatim, `apps/worker/src/doc-extract/handler.ts`):

```ts
export interface ReadingStore {
  readonly load: typeof loadDocumentForRead;
  readonly setStatus: typeof setDocumentStatus;
  readonly save: typeof saveDocumentReading;
  readonly fail: typeof recordFailedRead;
}
```

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/src/suppliers.ts` | new | `knownSupplierIcos`, `rememberSupplier` |
| `packages/db/src/index.ts` | edit | `export * from './suppliers';` |
| `packages/db/src/document-reading.ts` | edit | field source union adds `'vendor_memory'` |
| `apps/worker/src/doc-extract/rows.ts` | edit | `FieldRow.source` adds `'vendor_memory'` |
| `apps/worker/src/doc-extract/handler.ts` | edit | repair + remember |
| `packages/i18n/messages/en.json` | edit | one key |
| `apps/worker/test/doc-extract-handler.test.ts` | edit | 3 tests |

## 4. Steps

1. `suppliers.ts` (copy query style from `document-reading.ts`; `TenantTx` from `./tenant`):

```ts
/** IČOs of the org's saved suppliers. */
export async function knownSupplierIcos(tx: TenantTx, orgId: string): Promise<string[]>;
/** Upserts the supplier by (org, ico) and sets documents.partner_id; returns the partner id. Name falls back to the IČO. dic/name are only overwritten by non-null values. */
export async function rememberSupplier(tx: TenantTx, s: { orgId: string; documentId: string; ico: string; name: string | null; dic: string | null; country: string | null }): Promise<string>;
```
   Use `insert(partners).values(…).onConflictDoUpdate({ target: [partners.orgId, partners.ico], set: { name: sql\`coalesce(excluded.name, ${partners.name})\`, dic: sql\`coalesce(excluded.dic, ${partners.dic})\`, updatedAt: sql\`now()\` } }).returning({ id: partners.id })`, then `update(documents).set({ partnerId }).where(and(eq(documents.id, documentId), eq(documents.orgId, orgId)))`. Country: 2 uppercase letters or `'CZ'`.

2. `handler.ts`:
   - `ReadingStore` gains optional `readonly knownSupplierIcos?: typeof knownSupplierIcos;` and `readonly rememberSupplier?: typeof rememberSupplier;`; `dbReadingStore` sets both.
   - After the bytes load: `known = await store.knownSupplierIcos?.(ctx.tx, doc.orgId) ?? []` (a throw → `[]`).
   - In `toWrite`, after `applyExactData`, only when `source !== 'isdoc'`: let `ico = extraction.supplier.ico`. If `ico !== null && !icoChecksumValid(ico)`: `hits = icoRepairCandidates(ico).filter((c) => known.includes(c) && c !== doc.orgIco)`. Exactly one hit → new extraction with `supplier.ico = hit`, and `supplier.dic = 'CZ' + hit` when the old DIČ was `'CZ' + ico`; field sources `supplier.ico` (and `supplier.dic` when changed) = `'vendor_memory'`; append a validation row `{ ruleId: 'PROTO_ICO_REPAIRED', ruleVersion: 1, severity: 'warning', params: { from: ico, to: hit, messageKey: 'proto.check.ico_repaired.warn' } }`. Run the checks on the repaired extraction.
   - After `store.save` succeeds: when the saved supplier IČO is valid and ≠ `doc.orgIco`, call `store.rememberSupplier` inside `ctx.tx.transaction(async (sp) => …)` (a savepoint) wrapped in try/catch, so a failure never fails the reading. If `ctx.tx` has no `transaction` method in the types, call it directly in try/catch instead and say so in the report.
3. `en.json`, next to the other `proto.check.*` keys: `"proto.check.ico_repaired.warn": "The supplier IČO was read as {from}, which fails its check digit. We used {to}, a supplier you already have. Check it is right.",`
4. Tests in `doc-extract-handler.test.ts` (copy an existing test's shape; the fake store gets `knownSupplierIcos: async () => ['25596641']` and a `rememberSupplier` that records its argument):
   (a) the reading's supplier IČO is `25596614` (adjust the test's `wire()` input) → saved field `supplier.ico` = `25596641` source `vendor_memory`, a `PROTO_ICO_REPAIRED` warning, no `PROTO_ICO_CHECKSUM` row;
   (b) known list `[]` → IČO unchanged, `PROTO_ICO_CHECKSUM` blocking row present;
   (c) a valid supplier IČO → `rememberSupplier` called once with that IČO.

## 5. Do not touch

Everything outside §3, `vendor_profiles`, migrations. Hard rule 3 (org-scoped queries).

## 6. Commands

```
pnpm --filter @shoebox/worker test -- doc-extract 2>&1 | tail -30
pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30
pnpm --filter @shoebox/db typecheck 2>&1 | tail -30
pnpm --filter @shoebox/web typecheck 2>&1 | tail -30
pnpm --filter @shoebox/i18n test 2>&1 | tail -30
pnpm exec biome check --write packages/db apps/worker packages/i18n 2>&1 | tail -30
```

## 7. Acceptance

- [ ] §6 passes.

## 8. Stop and ask

Per TEMPLATE §8.

## 9. Report

`docs/tasks/0208-report.md`, 200 tokens at most. Set `Status: review`.

## Risk list (for the reviewer)

`suppliers.ts` (org scoping), `handler.ts` repair rule.
