import {
  docExtractJob,
  docSplitJob,
  emailReceivedJob,
  importSpreadsheetRunJob,
  importSpreadsheetUndoJob,
  jobIdFromKey,
  jobKey,
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

/** Queues `import.spreadsheet.undo` for one import (the worker soft-deletes its untouched documents). */
export async function enqueueImportUndo(orgId: string, importId: string): Promise<void> {
  const payload = importSpreadsheetUndoJob.payload.parse({ orgId, importId });
  const key = jobKey(importSpreadsheetUndoJob, payload);
  await (await boss()).send(importSpreadsheetUndoJob.name, payload, {
    id: jobIdFromKey(key),
    singletonKey: key,
  });
}
