# 0603 report

Status: review

Files (vs claude/project-thread-owbjjp; that branch has moved on, so the stat also lists unrelated 0601 files): domain `treatment.ts`, `kh.ts`, `checks-accountant.ts`, `rules/cz/vat-phase3.ts`; tax-xml `kh.ts`; worker `vat/map.ts`; new `kh-reverse-charge.test.ts` in domain and tax-xml; edited domain tests `vat-treatment`, `classify-period`, `rules-values`, `kh`, `kh-deduction`, `kh-dp3.property`; tax-xml test `kh-shv`.

Commands (all green):
- domain test (vat-treatment, kh-reverse-charge, kh, kh-deduction, classify-period, rules, kh-dp3.property, dphdp3-deduction): 718 passed (718)
- tax-xml test kh-reverse-charge, kh-shv: 67 passed (67), golden byte-identical
- typecheck domain, tax-xml, worker: no errors

Acceptance: [x] step 3/5 tests unchanged and passing [x] B2C code is iss_domestic_vat; received code without supplier CZ DIČ is not RC [x] policy 2026.3, S_RC_COMMODITY passes for one code [x] typechecks green

Deviations:
- `KhDocumentInfo` literals given `rcCommodityCodes: []` in kh.test, kh-deduction.test, kh-dp3.property.test, tax-xml kh-shv.test (allowed). Worker needed none.
- kh.test.ts "Věta C mirrors the DPHDP3": existing toEqual lacked the 3 new věta C keys; added plnRezPren/rezPren23/rezPren5 '0.00' (not covered by the brief's allowance, unavoidable).
- Pinned '2026.2' updated to '2026.3' in rules-values.test.ts and classify-period.test.ts (policyVersion expectation).
- pnpm `-- <name>` did not filter, so each domain/tax-xml run was the whole package suite.

Questions: none.
