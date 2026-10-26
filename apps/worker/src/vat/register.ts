import { parseLegalDate } from '@shoebox/domain';
import {
  type TenantJobDefinition,
  type VatFilingGeneratePayload,
  type VatPeriodEvaluatePayload,
  vatAmendmentDetectJob,
  vatFilingGenerateJob,
  vatPeriodEvaluateJob,
} from '@shoebox/pipeline';
import { createSupabaseBlobStore, type Logger } from '@shoebox/platform';
import type { JobRegistry, TenantHandler } from '../registry';
import { createVatAmendmentDetectHandler } from './amendment-detect';
import { evaluatePeriod, generateBundle, type VatDeps } from './service';

const REQUIRED = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;

export function createVatPeriodEvaluateHandler(
  deps: VatDeps,
): TenantHandler<VatPeriodEvaluatePayload> {
  return async (payload, ctx) => {
    const result = await evaluatePeriod(
      ctx.tx,
      payload.orgId,
      parseLegalDate(payload.periodStart),
      deps,
    );
    deps.logger.info(
      {
        event: 'vat.period.evaluate.done',
        orgId: payload.orgId,
        periodStart: payload.periodStart,
        result: 'skipped' in result ? result.skipped : result.verdict,
      },
      'vat.period.evaluate done',
    );
  };
}

export function createVatFilingGenerateHandler(
  deps: VatDeps,
): TenantHandler<VatFilingGeneratePayload> {
  return async (payload, ctx) => {
    const outcome = await generateBundle(
      ctx.tx,
      payload.orgId,
      {
        periodStart: parseLegalDate(payload.periodStart),
        kind: payload.kind,
        requestedBy: payload.requestedBy,
        ...(payload.amendsFilingId === undefined ? {} : { amendsFilingId: payload.amendsFilingId }),
        ...(payload.discoveredOn === undefined
          ? {}
          : { discoveredOn: parseLegalDate(payload.discoveredOn) }),
      },
      deps,
    );
    deps.logger.info(
      {
        event: 'vat.filing.generate.done',
        orgId: payload.orgId,
        periodStart: payload.periodStart,
        outcome: outcome.outcome,
      },
      'vat.filing.generate done',
    );
  };
}

export function registerVatJobs(
  registry: Pick<JobRegistry, 'registerTenant' | 'enqueue'>,
  env: Readonly<Record<string, string | undefined>>,
  logger: Pick<Logger, 'info' | 'warn'>,
): boolean {
  const url = env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    logger.warn({ missing: REQUIRED.filter((name) => !env[name]) }, 'vat jobs not registered');
    return false;
  }
  const deps: VatDeps = {
    blobs: createSupabaseBlobStore({ url, apiKey: serviceKey }),
    logger,
    enqueue: <P extends { orgId: string }>(def: TenantJobDefinition<P>, payload: P) =>
      registry.enqueue(def, payload),
  };
  registry.registerTenant(vatPeriodEvaluateJob, createVatPeriodEvaluateHandler(deps));
  registry.registerTenant(vatFilingGenerateJob, createVatFilingGenerateHandler(deps));
  registry.registerTenant(vatAmendmentDetectJob, createVatAmendmentDetectHandler(deps));
  logger.info({}, 'vat jobs registered');
  return true;
}
