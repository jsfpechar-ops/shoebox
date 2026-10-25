import { docExtractJob, jobIdFromKey, jobKey } from '@shoebox/pipeline';
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

/** Queues `doc.extract` with the worker's idempotency key: a second call for the same document is a no-op. */
export async function enqueueDocExtract(orgId: string, documentId: string): Promise<void> {
  const payload = docExtractJob.payload.parse({ orgId, documentId });
  const key = jobKey(docExtractJob, payload);
  await (await boss()).send(docExtractJob.name, payload, {
    id: jobIdFromKey(key),
    singletonKey: key,
  });
}
