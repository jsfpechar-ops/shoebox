import {
  bankImportStatementJob,
  bankMatchDecideJob,
  bankRadarRefreshJob,
  type CategorizeTrigger,
  docCategorizeJob,
  docExtractJob,
  docSplitJob,
  emailReceivedJob,
  importSpreadsheetRunJob,
  importSpreadsheetUndoJob,
  jobIdFromKey,
  jobKey,
  podkladyGenerateJob,
  type VatFilingGeneratePayload,
  vatFilingGenerateJob,
  vatWorkbookGenerateJob,
} from '@shoebox/pipeline';
import { PgBoss } from 'pg-boss';

let started: Promise<PgBoss> | undefined;

/** One sender per server process; no workers, crons or migrations here (the worker owns those). */
function boss(): Promise<PgBoss> {
  if (started === undefined) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) return Promise.reject(new Error('DATABASE_URL is not set'));
    const instance = new PgBoss({
      connectionString,
      schema: 'pgboss',
      supervise: false,
      schedule: false,
      migrate: false,
    });
    started = instance.start().then(() => instance);
    started.catch(() => {
      started = undefined;
    });
  }
  return started;
}

/**
 * Queues `doc.extract` with the worker's idempotency key: a second call for the same document is a no-op.
 * `retry` (any unique string) makes a new job for a document whose read failed.
 */
export async function enqueueDocExtract(
  orgId: string,
  documentId: string,
  retry?: string,
): Promise<void> {
  const payload = docExtractJob.payload.parse({ orgId, documentId });
  const base = jobKey(docExtractJob, payload);
  const key = retry === undefined ? base : `${base}:retry:${retry}`;
  await (await boss()).send(docExtractJob.name, payload, {
    id: jobIdFromKey(key),
    singletonKey: key,
  });
}

/** Queues `doc.split` for one upload drop (page sorting); it queues the reads itself. */
export async function enqueueDocSplit(orgId: string, batchId: string): Promise<void> {
  const payload = docSplitJob.payload.parse({ orgId, batchId });
  const key = jobKey(docSplitJob, payload);
  await (await boss()).send(docSplitJob.name, payload, {
    id: jobIdFromKey(key),
    singletonKey: key,
  });
}

/** Queues `email.received` for one stored inbound e-mail; a second call for the same mail is a no-op. */
export async function enqueueEmailReceived(orgId: string, inboundEmailId: string): Promise<void> {
  const payload = emailReceivedJob.payload.parse({ orgId, inboundEmailId });
  const key = jobKey(emailReceivedJob, payload);
  await (await boss()).send(emailReceivedJob.name, payload, {
    id: jobIdFromKey(key),
    singletonKey: key,
  });
}

/** Queues `import.spreadsheet.run` for one parsed spreadsheet, 200 data rows per run from `fromRow`. */
export async function enqueueImportRun(
  orgId: string,
  importId: string,
  fromRow: number,
): Promise<void> {
  const payload = importSpreadsheetRunJob.payload.parse({ orgId, importId, fromRow });
  const key = jobKey(importSpreadsheetRunJob, payload);
  await (await boss()).send(importSpreadsheetRunJob.name, payload, {
    id: jobIdFromKey(key),
    singletonKey: key,
  });
}

/** Queues `doc.categorize` for a user action; `nonce` keeps two quick answers from collapsing into one job. */
export async function enqueueDocCategorize(
  orgId: string,
  documentId: string,
  revision: number,
  trigger: CategorizeTrigger,
  nonce: number = Date.now(),
): Promise<void> {
  const payload = docCategorizeJob.payload.parse({ orgId, documentId, revision, trigger, nonce });
  const key = jobKey(docCategorizeJob, payload);
  await (await boss()).send(docCategorizeJob.name, payload, {
    id: jobIdFromKey(key),
    singletonKey: key,
  });
}

/** Queues `import.spreadsheet.undo` for one import (the worker soft-deletes its untouched documents). */
export async function enqueueImportUndo(orgId: string, importId: string): Promise<void> {
  const payload = importSpreadsheetUndoJob.payload.parse({ orgId, importId });
  const key = jobKey(importSpreadsheetUndoJob, payload);
  await (await boss()).send(importSpreadsheetUndoJob.name, payload, {
    id: jobIdFromKey(key),
    singletonKey: key,
  });
}

/** Queues `bank.import.statement` for one stored statement file; a second call for the same file is a no-op. */
export async function enqueueBankImport(orgId: string, sourceFileId: string): Promise<void> {
  const payload = bankImportStatementJob.payload.parse({ orgId, sourceFileId });
  const key = jobKey(bankImportStatementJob, payload);
  await (await boss()).send(bankImportStatementJob.name, payload, {
    id: jobIdFromKey(key),
    singletonKey: key,
  });
}

/** Queues `bank.match.decide`: the owner's tap on a suggested payment. One job per suggestion. */
export async function enqueueMatchDecision(
  orgId: string,
  suggestionId: string,
  decision: 'accept' | 'reject',
  userId: string,
): Promise<void> {
  const payload = bankMatchDecideJob.payload.parse({ orgId, suggestionId, decision, userId });
  const key = jobKey(bankMatchDecideJob, payload);
  await (await boss()).send(bankMatchDecideJob.name, payload, {
    id: jobIdFromKey(key),
    singletonKey: key,
  });
}

/** Queues `bank.radar.refresh` for the org (one job per org and minute). */
export async function enqueueRadarRefresh(orgId: string): Promise<void> {
  const payload = bankRadarRefreshJob.payload.parse({
    orgId,
    at: new Date().toISOString().slice(0, 16).replace(':', '-'),
  });
  const key = jobKey(bankRadarRefreshJob, payload);
  await (await boss()).send(bankRadarRefreshJob.name, payload, {
    id: jobIdFromKey(key),
    singletonKey: key,
  });
}

/** Queues `vat.filing.generate` for one period and kind; the nonce lets a later request run again (a finished job keeps its id). Returns the job id. */
export async function enqueueVatFilingGenerate(
  orgId: string,
  input: Omit<VatFilingGeneratePayload, 'orgId'>,
): Promise<string> {
  const payload = vatFilingGenerateJob.payload.parse({ nonce: Date.now(), ...input, orgId });
  const key = jobKey(vatFilingGenerateJob, payload);
  const id = jobIdFromKey(key);
  await (await boss()).send(vatFilingGenerateJob.name, payload, { id, singletonKey: key });
  return id;
}

/** Queues `vat.workbook.generate` for one period. Returns the job id. */
export async function enqueueVatWorkbookGenerate(
  orgId: string,
  periodStart: string,
  requestedBy?: string,
): Promise<string> {
  const payload = vatWorkbookGenerateJob.payload.parse({
    orgId,
    periodStart,
    requestedBy,
    nonce: Date.now(),
  });
  const key = jobKey(vatWorkbookGenerateJob, payload);
  const id = jobIdFromKey(key);
  await (await boss()).send(vatWorkbookGenerateJob.name, payload, { id, singletonKey: key });
  return id;
}

/** Queues `podklady.generate` for one tax year and answers version; the nonce lets a later request run again. */
export async function enqueuePodkladyGenerate(
  orgId: string,
  year: number,
  answersVersion: number,
  requestedBy: string,
): Promise<string> {
  const payload = podkladyGenerateJob.payload.parse({
    orgId,
    year,
    answersVersion,
    requestedBy,
    nonce: Date.now(),
  });
  const key = jobKey(podkladyGenerateJob, payload);
  const id = jobIdFromKey(key);
  await (await boss()).send(podkladyGenerateJob.name, payload, { id, singletonKey: key });
  return id;
}
