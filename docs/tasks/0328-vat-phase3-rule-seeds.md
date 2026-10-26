# 0328: Phase 3 VAT rule seeds (`vat.simple_period_policy`, rounding, amendment windows, `epo.forms`)

Status: todo
Ticket: P3-VAT-03/04/06 (rule data) | Depends on: none (wave 1 merged) | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 15 tool calls, 40k tokens

## 1. Objective

Seed the five law keys Phase 3 reads (`vat.simple_period_policy`, `vat.return_rounding`, `vat.shv_rounding`, `vat.amendment_windows`, `epo.forms`) into the CZ rule set, so every later VAT brief reads them through `rules.at(date).get(...)` and never hard-codes a value (AGENTS rule 1).

## 2. Context

Schemas already exist in `packages/domain/src/rules/law.ts` (do not edit them):
```ts
  'vat.simple_period_policy': z.looseObject({ version: z.string().min(1) }),
  'vat.return_rounding': z.enum(['sum_entries_then_round', 'round_base_then_multiply']),
  'vat.shv_rounding': z.enum(['ceil', 'round', 'floor']),
  'vat.amendment_windows': z.strictObject({
    dp3_dodatecne_due: z.enum(['end_of_month_after_discovery']),
    kh_nasledne_working_days: PositiveInt,
  }),
  'epo.forms': z.record(z.string().regex(/^[A-Z0-9]+$/), ModuleOwnedRecord),
```
Seed files: `packages/domain/src/rules/cz/2026.ts` and `cz/2025.ts` use `base(key, source, value)` entries (see the existing `epo.kh_routing` line: `{ ...base('epo.kh_routing', KH_METHODOLOGY, CZ_KH_ROUTING), verified_at: '2026-10-26' }`). Constants `ZDPH`, `KH_METHODOLOGY`, `DPHDP3_STRUCTURE` exist in 2026.ts; reuse them (grep the file for their definitions and copy the pattern for a new `EPO_STRUCTURES` constant = `'https://adisspr.mfcr.cz/dpr/adis/idpr_pub/epo2_info/popis_struktury_seznam.faces'`).

Values (M05 §4.3 default policy, verbatim; 22 D-11 default; M05 §4.5; M05 §4.11; research/czech-tax-filings.md §1.1 [O] versions dated 11. 8. 2026):
```ts
export const CZ_SIMPLE_PERIOD_POLICY = {
  version: '2026.1',
  allowed_treatments: {
    identifikovana_osoba: ['rcv_eu_service_reverse_charge','rcv_non_eu_service_reverse_charge',
      'rcv_domestic_vat','rcv_domestic_no_vat','rcv_foreign_vat_charged','rcv_out_of_scope','iss_no_vat'],
    platce: ['iss_domestic_vat','iss_eu_service','iss_eu_goods','iss_non_eu_service','iss_no_vat',
      'rcv_domestic_vat','rcv_domestic_no_vat','rcv_eu_service_reverse_charge',
      'rcv_non_eu_service_reverse_charge','rcv_eu_goods_acquisition','rcv_foreign_vat_charged','rcv_out_of_scope'] },
  forbid_document_classes: ['received_advance_tax_doc'],
  forbid_line_types: ['advance_deduction'],
  max_docs: 150, max_rates_per_eu_goods_document: 1,
  allow_partial_business_share_on_deduction: false, allow_prior_period_credit_notes: false,
} as const;
// vat.return_rounding: 'sum_entries_then_round'            (D-11 default; TODO(decision-D-11))
// vat.shv_rounding:    'ceil'                              (CTF §1.4 "rounded up"; [verify])
// vat.amendment_windows: { dp3_dodatecne_due: 'end_of_month_after_discovery', kh_nasledne_working_days: 5 }  (TODO(TA-10))
export const CZ_EPO_FORMS = {
  DPHDP3: { version: '03.01.04', verze_pis: '03.01', xsd: 'dphdp3_epo2.xsd', source_url: 'https://adisspr.mfcr.cz/adis/jepo/schema/dphdp3_epo2.xsd', valid_for_periods_from: '2026-01-01' },
  DPHKH1: { version: '03.01.15', verze_pis: '03.01', xsd: 'dphkh1_epo2.xsd', source_url: 'https://adisspr.mfcr.cz/adis/jepo/schema/dphkh1_epo2.xsd', valid_for_periods_from: '2026-01-01' },
  DPHSHV: { version: '02.01.05', verze_pis: '02.01', xsd: 'dphshv_epo2.xsd', source_url: 'https://adisspr.mfcr.cz/adis/jepo/schema/dphshv_epo2.xsd', valid_for_periods_from: '2026-01-01' },
} as const;
```
`verze_pis` = first two groups of the popis version is an inference ([I], research §1.1) → mark `[verify]` in the report (T-02). Put both constants in a new file `packages/domain/src/rules/cz/vat-phase3.ts` and import them from 2026.ts and 2025.ts (same values in both years; `valid_for_periods_from` stays `2026-01-01`).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/src/rules/cz/vat-phase3.ts` | create | the two constants above + `export type SimplePeriodPolicy = typeof CZ_SIMPLE_PERIOD_POLICY` and `export type EpoForms = typeof CZ_EPO_FORMS` |
| `packages/domain/src/rules/cz/2026.ts` | edit | 5 `base(...)` entries after the `epo.kh_routing` line |
| `packages/domain/src/rules/cz/2025.ts` | edit | the same 5 entries after its last `vat.*` entry |
| `packages/domain/test/rules-values.test.ts` | edit | add the 5 keys to `SEEDED_KEYS` and the `describe` below |
| `packages/domain/src/index.ts` | edit | append `export * from './rules/cz/vat-phase3';` after the `./rules/cz/epo` line |

## 4. Steps

1. Create `vat-phase3.ts` (constants above, `as const`, doc comments citing M05 §4.3 / D-11 / CTF §1.1).
2. Edit 2026.ts: after the `epo.kh_routing` entry add
```ts
  // M05 §4.3 simple-period policy (version 2026.1), §4.4 rounding (D-11 default), §4.5 SH rounding,
  // §4.11 amendment windows (TA-10 defaults), §4.8 EPO form versions (CTF §1.1, dated 11. 8. 2026).
  { ...base('vat.simple_period_policy', `${ZDPH}#p101`, CZ_SIMPLE_PERIOD_POLICY), verified_at: '2026-10-26' },
  base('vat.return_rounding', `${ZDPH}#p37`, 'sum_entries_then_round'),
  base('vat.shv_rounding', `${ZDPH}#p102`, 'ceil'),
  base('vat.amendment_windows', `${ZDPH}#p141`, { dp3_dodatecne_due: 'end_of_month_after_discovery', kh_nasledne_working_days: 5 }),
  { ...base('epo.forms', EPO_STRUCTURES, CZ_EPO_FORMS), verified_at: '2026-10-26' },
```
   and the import `import { CZ_EPO_FORMS, CZ_SIMPLE_PERIOD_POLICY } from './vat-phase3';`. If `base(...)` has a different arity in this file, STOP and report. Command: `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30` → 0 errors.
3. Same in 2025.ts (define `EPO_STRUCTURES` there too if the constant is per file).
4. Edit the test: add the five keys to `SEEDED_KEYS` (alphabetical) and append:
```ts
describe('Phase 3 VAT seeds (0328)', () => {
  const at = rules.at(parseLegalDate('2026-09-15'));
  it('simple-period policy 2026.1 forbids EU goods for an IO and allows them for a payer', () => {
    const p = at.get('vat.simple_period_policy') as typeof CZ_SIMPLE_PERIOD_POLICY;
    expect(p.version).toBe('2026.1');
    expect(p.allowed_treatments.identifikovana_osoba).not.toContain('rcv_eu_goods_acquisition');
    expect(p.allowed_treatments.platce).toContain('rcv_eu_goods_acquisition');
    expect(p.max_docs).toBe(150);
  });
  it('rounding and windows', () => {
    expect(at.get('vat.return_rounding')).toBe('sum_entries_then_round');
    expect(at.get('vat.shv_rounding')).toBe('ceil');
    expect(at.get('vat.amendment_windows')).toEqual({ dp3_dodatecne_due: 'end_of_month_after_discovery', kh_nasledne_working_days: 5 });
  });
  it('epo.forms carries the 11. 8. 2026 versions', () => {
    const f = at.get('epo.forms') as typeof CZ_EPO_FORMS;
    expect(f.DPHDP3.version).toBe('03.01.04');
    expect(f.DPHKH1.version).toBe('03.01.15');
    expect(f.DPHSHV.version).toBe('02.01.05');
    expect(rules.at(parseLegalDate('2025-06-01')).get('vat.return_rounding')).toBe('sum_entries_then_round');
  });
});
```
   (import `parseLegalDate` from `../src/dates/index` and the two constants from `../src/rules/cz/vat-phase3` if not already). Command: `pnpm --filter @shoebox/domain test -- rules 2>&1 | tail -30` → all green.
5. Append the index export line. Commit: `feat(domain): seed Phase 3 VAT rule keys (0328)`.

## 5. Do not touch

`law.ts`, `keys.ts`, `epo.ts`, anything outside §3. Values are data: no code reads them in this brief.

## 6. Commands

`pnpm --filter @shoebox/domain test -- rules 2>&1 | tail -30` · `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`

## 7. Acceptance

- [ ] All five keys resolve on 2025 and 2026 dates; `rules-values` green; typecheck 0 errors.
- [ ] No other rule value changed (`git diff --stat` shows only §3 files).

## 8. Stop and ask

Standard list (TEMPLATE §8), plus: `base()` signature differs, or a `looseObject` schema rejects the policy.

## 9. Report

`docs/tasks/0328-report.md`: files, commands (last 5 lines), §7 ticked, `[verify]` T-02 `verze_pis` noted as inference.

## Risk list

`vat-phase3.ts` (tax data), both seed files.

## Owner steps

1. None now. Decisions file: the orchestrator appends "2026-10-26 D-11 default `sum_entries_then_round` seeded; `verze_pis` inferred from popis version (T-02)".
