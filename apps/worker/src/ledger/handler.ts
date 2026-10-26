import {
  listDocumentsForRebuild,
  loadLedgerInputs,
  readLedgerEntries,
  replaceLedgerEntries,
  type TenantTx,
} from '@shoebox/db';
import {
  createCzRules,
  LEDGER_ALGO_VERSION,
  type RULE_SCHEMAS,
  type RuleResolver,
} from '@shoebox/domain';
import {
  type LedgerRebuildDocumentPayload,
  type LedgerRebuildOrgPayload,
  type LedgerVerifyPayload,
  ledgerRebuildDocumentJob,
  type TenantJobDefinition,
} from '@shoebox/pipeline';
import type { Logger } from '@shoebox/platform';
import type { SystemHandler, TenantHandler } from '../registry';
import { canonicalJson, computeLedgerDrafts, inputHashOf } from './build';

export interface LedgerStore {
  readonly load: typeof loadLedgerInputs;
  readonly replace: typeof replaceLedgerEntries;
  readonly read: typeof readLedgerEntries;
  readonly list: typeof listDocumentsForRebuild;
}

export const dbLedgerStore: LedgerStore = {
  load: loadLedgerInputs,
  replace: replaceLedgerEntries,
  read: readLedgerEntries,
  list: listDocumentsForRebuild,
};

export type Enqueue = <P extends { orgId: string }>(
  def: TenantJobDefinition<P>,
  payload: P,
) => Promise<string | null>;

export interface LedgerDeps {
  readonly logger: Pick<Logger, 'info' | 'warn'>;
  readonly rules?: RuleResolver<typeof RULE_SCHEMAS>;
  readonly store?: LedgerStore;
  readonly enqueue: Enqueue;
}

export const ORG_REBUILD_BATCH = 200;

type Resolved = Required<Pick<LedgerDeps, 'store' | 'rules' | 'logger'>>;

function resolveDeps(deps: LedgerDeps): Resolved {
  return {
    store: deps.store ?? dbLedgerStore,
    rules: deps.rules ?? createCzRules(),
    logger: deps.logger,
  };
}

export interface VerifyDeps extends LedgerDeps {
  readonly listOrgIds: () => Promise<string[]>;
  readonly withTenant: <T>(orgId: string, fn: (tx: TenantTx) => Promise<T>) => Promise<T>;
}

/** Rebuilds one document's ledger rows; a no-op when the stored input hash and algo version match (AC-5). */
export async function rebuildDocument(
  tx: TenantTx,
  orgId: string,
  documentId: string,
  deps: Required<Pick<LedgerDeps, 'store' | 'rules' | 'logger'>>,
): Promise<{ changed: boolean; buildVersion?: string; skipped?: 'missing' }> {
  const inputs = await deps.store.load(tx, documentId);
  if (!inputs) return { changed: false, skipped: 'missing' };

  const inputHash = inputHashOf(inputs, LEDGER_ALGO_VERSION);
  if (inputs.current?.h === inputHash && inputs.current.v === LEDGER_ALGO_VERSION) {
    return { changed: false };
  }

  const drafts = computeLedgerDrafts(inputs, deps.rules);
  if (Object.keys(drafts.issues).length > 0) {
    deps.logger.info(
      { event: 'ledger.issues', documentId, issues: drafts.issues },
      'ledger issues',
    );
  }
  const buildVersion = await deps.store.replace(tx, {
    orgId,
    documentId,
    algoVersion: LEDGER_ALGO_VERSION,
    inputHash,
    tax: drafts.tax,
    vat: drafts.vat,
  });
  deps.logger.info(
    {
      event: 'ledger.document_rebuilt',
      documentId,
      buildVersion,
      periodsAffected: drafts.periods,
      taxYearsAffected: drafts.taxYears,
    },
    'ledger document rebuilt',
  );
  return { changed: true, buildVersion };
}

export function createLedgerRebuildDocumentHandler(
  deps: LedgerDeps,
): TenantHandler<LedgerRebuildDocumentPayload> {
  const resolved = resolveDeps(deps);
  return async (payload, ctx) => {
    await rebuildDocument(ctx.tx, payload.orgId, payload.documentId, resolved);
  };
}

function documentReason(
  reason: LedgerRebuildOrgPayload['reason'],
): LedgerRebuildDocumentPayload['reason'] {
  return reason === 'manual' ? 'verify' : reason;
}

export function createLedgerRebuildOrgHandler(
  deps: LedgerDeps,
): TenantHandler<LedgerRebuildOrgPayload> {
  const resolved = resolveDeps(deps);
  return async (payload, ctx) => {
    let offset = 0;
    let batchIndex = 0;
    for (;;) {
      const ids = await resolved.store.list(
        ctx.tx,
        payload.orgId,
        payload.from ?? null,
        offset,
        ORG_REBUILD_BATCH,
      );
      for (const documentId of ids) {
        await deps.enqueue(ledgerRebuildDocumentJob, {
          orgId: payload.orgId,
          documentId,
          reason: documentReason(payload.reason),
          nonce: batchIndex,
        });
      }
      offset += ids.length;
      batchIndex += 1;
      if (ids.length < ORG_REBUILD_BATCH) break;
    }
    resolved.logger.info(
      { event: 'ledger.rebuild_org.fanout', orgId: payload.orgId, documents: offset },
      'ledger org rebuild fanned out',
    );
  };
}

/** Nightly determinism check. Dry-run only: it never calls replace. */
export function createLedgerVerifyHandler(deps: VerifyDeps): SystemHandler<LedgerVerifyPayload> {
  const resolved = resolveDeps(deps);
  return async (payload) => {
    if (payload.samplePct <= 0) return;
    const every = Math.max(1, Math.round(100 / payload.samplePct));
    const orgIds = await deps.listOrgIds();
    let sampled = 0;
    let diffs = 0;
    for (const orgId of orgIds) {
      await deps.withTenant(orgId, async (tx) => {
        const ids = await resolved.store.list(tx, orgId, null, 0, 10_000);
        for (const [index, documentId] of ids.entries()) {
          if (index % every !== 0) continue;
          sampled += 1;
          const inputs = await resolved.store.load(tx, documentId);
          if (!inputs) continue;
          const drafts = computeLedgerDrafts(inputs, resolved.rules);
          const stored = await resolved.store.read(tx, documentId);
          const same =
            canonicalJson({ tax: drafts.tax, vat: drafts.vat }) ===
            canonicalJson({ tax: stored.tax, vat: stored.vat });
          if (!same) {
            diffs += 1;
            resolved.logger.warn(
              { event: 'ledger.verify.diff', orgId, documentId },
              'ledger dry-run differs from stored rows',
            );
          }
        }
      });
    }
    resolved.logger.info(
      { event: 'ledger.verify.done', orgs: orgIds.length, sampled, diffs },
      'ledger verify finished',
    );
  };
}
