// Entry point of the worker container (Cloud Run worker pool, M12 §4.2). Not imported by index.ts.
import { logger } from '@shoebox/platform';
import { registerBankImport } from './bank-import/register';
import { registerDocCategorize } from './categorize/register';
import { registerDocExtract } from './doc-extract/register';
import { registerDocSplit } from './doc-split/register';
import { registerEmailReceived } from './email-received/register';
import { registerImportRun } from './import-run/register';
import { registerLedgerJobs } from './ledger/register';
import { registerTrashPurge } from './retention/trash-purge';
import { loadWorkerConfig, startWorker } from './worker';

const worker = await startWorker(loadWorkerConfig(process.env), {
  logger,
  register: (registry, db) => {
    registerDocExtract(registry, process.env, logger);
    registerDocCategorize(registry, process.env, logger);
    registerEmailReceived(registry, process.env, logger);
    registerBankImport(registry, process.env, logger);
    registerDocSplit(registry, process.env, logger);
    registerImportRun(registry, process.env, logger);
    registerTrashPurge(registry, db, process.env, logger);
    registerLedgerJobs(registry, db, logger);
  },
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void worker.stop().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}
