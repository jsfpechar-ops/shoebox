# 0611: Fix a misread supplier IČO from ARES; no buyer is fine

Status: ready
Ticket: REAL-DATA (owner test 2026-10-27, Josef) | Depends on: none | Base commit: d5c65a1 | Branch: claude/project-thread-w656wo | PR base: phase/0
Executor: Sonnet 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Real case: a Makro receipt was read as IČO 26465681 / DIČ CZ26465681. The mod-11 check correctly fails (ARES: not found). Makro's real IČO is 26450691 (ARES 2026-10-27, checked by the orchestrator). The app should fix this itself, not ask a layman. Also, "The invoice names no buyer" must not show at all: simplified tax documents and shop receipts legally need no buyer.

## 2. Context

- `packages/validation/src/proto-checks/checks.ts`: `icoChecksumValid` (verify, do not rewrite unless wrong), `checkBuyer` (`proto.check.buyer.missing` warn).
- `apps/worker/src/doc-extract/handler.ts`: `repairSupplierIco` (supplier memory, one digit/swap) and the `proto.check.ico_repaired.warn` row (~line 270); registry rows added ~line 387 via `registry-checks.ts`.
- `packages/registries/src/ares.ts`: `createAresClient().subject(ico)`. ARES name search: `POST https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/vyhledat` with JSON `{"obchodniJmeno": "<name>", "pocet": 10}` → `{ pocetCelkem, ekonomickeSubjekty: [{ ico, obchodniJmeno, dic? }] }`. Searching "Makro Cash & Carry ČR s.r.o." returns 3 subjects; only one has that exact name (case-insensitive).
- Registry calls must never block or throw out of the handler (follow `registry-checks.ts`: timeouts, `RegistryResult` unavailable).

## 3. Work

1. Tests in `packages/validation/test`: 26450691 valid, 26465681 invalid, 62904965 valid, 24771902 valid.
2. `ares.ts`: add `searchByName(name): Promise<RegistryResult<readonly { ico; name; dic: string | null }[]>>` using the same fetch/timeout pattern; fixture test with a mocked fetch.
3. Worker: when the supplier IČO fails the checksum and supplier memory did not repair it, search ARES by the supplier name. If exactly one subject's name equals the read name after normalising (lower case, collapse spaces, ignore a trailing comma/period), and its IČO passes the checksum, replace `supplier.ico` (and `supplier.dic` when it was `CZ` + the old IČO) and add the same kind of repaired row with a new key `proto.check.ico_repaired_ares.info` ("We corrected the IČO from the business register: {from} → {to}.") at severity `info` (0610 adds `info`; if it is not merged yet, use `warning` with empty `fieldKeys` and leave `TODO(0610)`). Otherwise keep today's behaviour.
4. `checkBuyer`: return nothing when the buyer is missing (delete the `missing` branch and its key usage; keep the key in en.json only if other code uses it).
5. Inject the ARES search through the existing deps so tests never call the network.

## 4. Do not touch

Totals/VAT checks, UI files. Hard rules 1, 2, 4 (no document content in logs).

## 5. Commands

`pnpm --filter @shoebox/validation test 2>&1 | tail -30`, `pnpm --filter @shoebox/registries test 2>&1 | tail -30`, `pnpm --filter @shoebox/worker test -- doc-extract 2>&1 | tail -30`, typecheck of those three.

## 6. Report

`docs/tasks/0611-report.md` (600 tokens max), `Status: review`, commit `0611: fix misread supplier IČO from ARES; missing buyer is fine`. Do not push.
