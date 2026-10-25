# OSVČ Zero-Click Accounting (working name: Digital Shoebox)

An AI-first bookkeeping and tax app for Czech OSVČ and small business owners. You forward an e-mail or snap a photo, and receipts and invoices get extracted, validated against public registries, matched to bank payments and turned into tax records and official tax-office XML filings. It also includes simple invoicing and a clean export for accountants.

## Repository layout

```
docs/
  plan-v2-original.md        founder's original V2 plan (input)
research/
  abra-flexi-accounting-model.md   how a real Czech accounting system models data
  czech-tax-filings.md       EPO XML: DPHDP3, DPHKH1, DPHSHV, DPFDP; OSVČ rules 2026
  registries-and-formats.md  ARES, ADIS/CRPDPH, VIES, ČNB, SPAYD, ISDOC, Pohoda/Money XML, ABO/GPC
  bank-connectivity.md       Czech banks, PSD2 aggregators, matching logic
```

## Research conventions

Research files follow REA's evidence discipline. Every claim is labelled **[O]** observed (with a source), **[I]** inferred or **[?]** unknown.

## Status

Research phase (Oct 2026). The next step is V3 plan, scoped MVP and architecture decision records.
