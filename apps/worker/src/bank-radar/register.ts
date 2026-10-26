import {
  applyRadarAnswerToTransaction,
  insertRadarQuestion,
  loadLastSupplierSender,
  loadOrgInvoicingDetails,
  loadRadarQuestions,
  loadRadarTransactions,
  markRadarAnswerApplied,
  organizations,
  resolveRadarQuestion,
  type TenantDb,
} from '@shoebox/db';
import { bankRadarNightlyJob, bankRadarRefreshJob } from '@shoebox/pipeline';
import type { Logger } from '@shoebox/platform';
import type { JobRegistry } from '../registry';
import { createBankRadarNightlyHandler, createBankRadarRefreshHandler } from './handler';

export function registerBankRadar(
  registry: Pick<JobRegistry, 'registerTenant' | 'registerSystem' | 'enqueue'>,
  db: Pick<TenantDb, 'withServiceRole'>,
  logger: Pick<Logger, 'info'>,
): boolean {
  registry.registerTenant(
    bankRadarRefreshJob,
    createBankRadarRefreshHandler({
      clock: { now: () => Date.now() },
      store: {
        loadTransactions: loadRadarTransactions,
        loadQuestions: loadRadarQuestions,
        insertQuestion: insertRadarQuestion,
        resolveQuestion: resolveRadarQuestion,
        markApplied: markRadarAnswerApplied,
        applyAnswer: applyRadarAnswerToTransaction,
        loadOrgDetails: loadOrgInvoicingDetails,
        loadSupplierSender: loadLastSupplierSender,
      },
    }),
  );
  registry.registerSystem(
    bankRadarNightlyJob,
    createBankRadarNightlyHandler({
      listActiveOrgIds: () =>
        db.withServiceRole('admin', async (tx) =>
          (
            await tx
              .select({ id: organizations.id, deletedAt: organizations.deletedAt })
              .from(organizations)
          )
            .filter((row) => row.deletedAt === null)
            .map((row) => row.id),
        ),
      enqueue: (orgId) => registry.enqueue(bankRadarRefreshJob, { orgId }),
    }),
  );
  logger.info({}, 'bank.radar registered');
  return true;
}
