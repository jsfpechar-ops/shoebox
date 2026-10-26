// M05 §4.10 worker: build the VAT workbook of a period and store it as a VAT_WORKBOOK filing.
// Runs when a period needs an accountant and on demand. Never submits anything (AGENTS rule 8).
// Logs carry ids and counts only, never document content.

import type { PeriodDocumentRow, PeriodEntryRow, TenantTx } from '@shoebox/db';
import { classifyPeriod, computeDphdp3, type LegalDate, parseLegalDate } from '@shoebox/domain';
import {
  buildVatWorkbook,
  type VatWorkbookInput,
  type WorkbookEntry,
  XLSX_MIME,
} from '@shoebox/exports';
import type { VatWorkbookGeneratePayload } from '@shoebox/pipeline';
import type { TenantHandler } from '../registry';
import { toClassifierInput, toEntryDraft } from './map';
import { loadPeriod, resolve, type VatDeps } from './service';

export type WorkbookOutcome =
  | { readonly outcome: 'generated'; readonly filingId: string; readonly path: string }
  | { readonly outcome: 'skipped'; readonly reason: 'no_profile' | 'not_vat_registered' };

// TODO(0350): partner name and received date are not in the period ledger read yet.
function workbookEntry(e: PeriodEntryRow, doc: PeriodDocumentRow | undefined): WorkbookEntry {
  return {
    documentId: e.documentId,
    documentNumber: doc?.documentNumber ?? null,
    partnerName: null,
    partnerVatId: doc?.partner?.vatId ?? e.counterpartyVatId,
    partnerCountry: doc?.partner?.country ?? null,
    issueDate: doc?.issueDate ?? null,
    duzp: doc?.duzp ?? null,
    receivedDate: null,
    vatPointDate: e.vatPointDate,
    vatTreatment: e.vatTreatment,
    vatRatePct: Number.parseFloat(e.vatRatePct),
    currency: e.currency,
    baseForeign: e.baseForeign,
    fxRate: e.fxRate,
    fxRateDate: e.fxRateDate,
    baseCzk: e.baseCzk,
    vatCzk: e.vatCzk,
    dphdp3Rows: e.dphdp3Rows,
    khSection: e.khSection,
    shvCode: e.shvCode,
  };
}

/** Supersedes an open workbook of the period, writes the new one and its VAT_WORKBOOK filing row. */
export async function generateWorkbook(
  tx: TenantTx,
  orgId: string,
  periodStart: LegalDate,
  requestedBy: string | null,
  deps: VatDeps,
): Promise<WorkbookOutcome> {
  const c = resolve(deps);
  const loaded = await loadPeriod(tx, orgId, periodStart, c);
  if ('skipped' in loaded) return { outcome: 'skipped', reason: loaded.skipped };
  const { ledger, profile, status, period } = loaded;
  const check = classifyPeriod(
    toClassifierInput(ledger, status, period, new Date(c.now()).toISOString()),
    c.rules,
  );
  // Provisional totals: shown in the workbook as "Unverified computation", never as a filing figure.
  const dp3 = computeDphdp3(ledger.entries.map(toEntryDraft), status, c.rules, period.start);
  const documents = new Map(ledger.documents.map((d) => [d.id, d] as const));
  const money = (value: { toFixed2(): string }) => value.toFixed2();
  const input: VatWorkbookInput = {
    periodStart: period.start,
    periodEnd: period.end,
    profile: {
      legalName: [profile.firstName, profile.lastName]
        .filter((part): part is string => Boolean(part))
        .join(' '),
      dic: profile.dic,
      vatStatus: status,
    },
    verdict: check.verdict,
    checks: check.checks,
    rows: Object.fromEntries(
      Object.entries(dp3.rows).map(([row, v]) => [row, { base: money(v.base), tax: money(v.tax) }]),
    ),
    result: {
      row62: money(dp3.row62),
      row63: money(dp3.row63),
      row64: money(dp3.row64),
      row65: money(dp3.row65),
    },
    entries: ledger.entries.map((e) => workbookEntry(e, documents.get(e.documentId))),
    documentNumbers: Object.fromEntries(ledger.documents.map((d) => [d.id, d.documentNumber])),
  };

  const superseded = await c.store.supersedeOpenFilings(
    tx,
    orgId,
    'VAT_WORKBOOK',
    period.start,
    'radne',
  );
  for (const id of superseded) {
    c.logger.info(
      { event: 'filing.state_changed', filingId: id, from: 'open', to: 'superseded' },
      'filing state changed',
    );
  }
  const filingId = await c.store.insertFiling(
    tx,
    {
      orgId,
      type: 'VAT_WORKBOOK',
      kind: 'radne',
      periodStart: period.start,
      periodEnd: period.end,
      state: 'generated',
      totals: { ledgerHash: ledger.ledgerHash, rows: input.rows, verdict: check.verdict },
      simpleCheck: check,
      generatedAt: new Date(c.now()),
      generatedBy: requestedBy,
    },
    [],
    [],
  );
  const path = `org/${orgId}/filings/${filingId}/VAT_WORKBOOK.xlsx`;
  await c.blobs.put(path, buildVatWorkbook(input, new Date(c.now())), XLSX_MIME);
  await c.store.setFilingState(tx, orgId, filingId, 'generated', { xlsxPath: path });
  c.logger.info(
    {
      event: 'vat.workbook.generated',
      orgId,
      periodStart: period.start,
      filingId,
      entries: input.entries.length,
      verdict: check.verdict,
    },
    'vat workbook generated',
  );
  return { outcome: 'generated', filingId, path };
}

export function createVatWorkbookGenerateHandler(
  deps: VatDeps,
): TenantHandler<VatWorkbookGeneratePayload> {
  return async (payload, ctx) => {
    const outcome = await generateWorkbook(
      ctx.tx,
      payload.orgId,
      parseLegalDate(payload.periodStart),
      payload.requestedBy ?? null,
      deps,
    );
    deps.logger.info(
      {
        event: 'vat.workbook.generate.done',
        orgId: payload.orgId,
        periodStart: payload.periodStart,
        outcome: outcome.outcome,
      },
      'vat.workbook.generate done',
    );
  };
}
