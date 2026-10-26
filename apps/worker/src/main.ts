// Entry point of the worker container (Cloud Run worker pool, M12 §4.2). Not imported by index.ts.
import { logger } from '@shoebox/platform';
import { registerDocExtract } from './doc-extract/register';
import { registerDocSplit } from './doc-split/register';
import { registerEmailReceived } from './email-received/register';
import { loadWorkerConfig, startWorker } from './worker';

const worker = await startWorker(loadWorkerConfig(process.env), {
  logger,
  register: (registry) => {
    registerDocExtract(registry, process.env, logger);
    registerEmailReceived(registry, process.env, logger);
    registerDocSplit(registry, process.env, logger);
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
