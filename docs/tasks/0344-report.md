# 0344 report

Status: review

Files: apps/worker/src/vat/{map,service,register}.ts (new), apps/worker/src/main.ts, apps/worker/src/ledger/handler.ts, apps/worker/test/filing-lifecycle.test.ts (new).

Commands (last lines):
- worker vitest filing-lifecycle: 8 passed. ledger-rebuild: 8 passed.
- worker typecheck: clean. biome check on changed paths: clean. depcruise: no violations.
- grep mojedane|epo_podani in apps/worker/src: empty.

§7 ticked: eight cases green; main.ts registers jobs; ledger hook enqueues vat.period.evaluate.

Deviations:
- Ledger hook: rebuildDocument return kept unchanged (the existing test asserts it exactly), so the handler reads periods via store.read (distinct vat periodStart) after `changed: true`. `familyFor` is optional, default 'PAYER'.
- IO bundles contain DPHDP3 only (no DPHSHV), per the brief; IO SH obligations are not emitted (TODO to decide).
- The hook has no dedicated test (not in the eight cases).
- Payments for vat_payment matching: `payments: []` (TODO(0344-payments)). amendsFilingId is set on DPHDP3 only (TODO(0348)).

Questions: none. Owner steps: none.
