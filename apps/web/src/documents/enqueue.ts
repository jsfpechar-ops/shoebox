import {
  bankImportStatementJob,
  bankMatchDecideJob,
  docExtractJob,
  docSplitJob,
  emailReceivedJob,
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
