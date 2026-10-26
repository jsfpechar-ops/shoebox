import { authorityRulesOf } from '@shoebox/bank';
import {
  decideSuggestion,
  insertPaymentLinks,
  loadDocumentLinks,
  loadDocumentPaidView,
  loadMatchContextRows,
  loadOpenDocuments,
  loadOwnAccounts,
  loadSuggestionForDecision,
  loadTransactionsForMatch,
  refreshTransactionMatchState,
  setDocumentPaidAt,
  setTransactionMatch,
  syncOpenSuggestions,
} from '@shoebox/db';
import { createCzRules, pragueToday } from '@shoebox/domain';
import {
  bankMatchDecideJob,
  bankMatchDocumentJob,
  bankMatchTransactionsJob,
} from '@shoebox/pipeline';
import type { Logger } from '@shoebox/platform';
import type { JobRegistry } from '../registry';
import {
  createBankMatchDecideHandler,
  createBankMatchDocumentHandler,
  createBankMatchTransactionsHandler,
} from './handler';

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
  registry.registerTenant(
    bankMatchDecideJob,
    createBankMatchDecideHandler({
      store: {
        loadSuggestion: loadSuggestionForDecision,
        decide: decideSuggestion,
        insertLinks: insertPaymentLinks,
        refreshTransaction: refreshTransactionMatchState,
        loadDocumentLinks,
        loadDocumentPaidView,
        setPaidAt: setDocumentPaidAt,
      },
    }),
  );
  logger.info({}, 'bank.match registered');
  return true;
}
