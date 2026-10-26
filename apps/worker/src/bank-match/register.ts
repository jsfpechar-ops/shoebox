import { authorityRulesOf } from '@shoebox/bank';
import {
  insertPaymentLinks,
  loadDocumentLinks,
  loadDocumentPaidView,
  loadMatchContextRows,
  loadOpenDocuments,
  loadOwnAccounts,
  loadTransactionsForMatch,
  setDocumentPaidAt,
  setTransactionMatch,
  syncOpenSuggestions,
} from '@shoebox/db';
import { createCzRules, pragueToday } from '@shoebox/domain';
import { bankMatchDocumentJob, bankMatchTransactionsJob } from '@shoebox/pipeline';
import type { Logger } from '@shoebox/platform';
import type { JobRegistry } from '../registry';
import { createBankMatchDocumentHandler, createBankMatchTransactionsHandler } from './handler';

export function registerBankMatch(
  registry: Pick<JobRegistry, 'registerTenant'>,
  _env: Readonly<Record<string, string | undefined>>,
  logger: Pick<Logger, 'info' | 'warn'>,
): boolean {
  const clock = { now: () => Date.now() };
  // TODO(rules per run date): resolved once at start.
  const rules = authorityRulesOf(
    createCzRules().at(pragueToday(clock)).get('bank.authority_accounts') as Record<
      string,
      unknown
    >,
  );
  const deps = {
    rules,
    clock,
    store: {
      loadTransactions: loadTransactionsForMatch,
      loadDocuments: loadOpenDocuments,
      loadContext: loadMatchContextRows,
      loadOwnAccounts,
      insertLinks: insertPaymentLinks,
      syncSuggestions: syncOpenSuggestions,
      setTransaction: setTransactionMatch,
      loadDocumentLinks,
      loadDocumentPaidView,
      setPaidAt: setDocumentPaidAt,
    },
  };
  registry.registerTenant(bankMatchTransactionsJob, createBankMatchTransactionsHandler(deps));
  registry.registerTenant(bankMatchDocumentJob, createBankMatchDocumentHandler(deps));
  logger.info({}, 'bank.match registered');
  return true;
}
