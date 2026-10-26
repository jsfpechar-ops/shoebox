import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  bankRadarNightlyJob,
  bankRadarRefreshJob,
  CRON_TIME_ZONE,
  DEFAULT_RETRY,
  deadLetterName,
  defineSystemJob,
  defineTenantJob,
  docCategorizeJob,
  docExtractJob,
  documentStagePayload,
  idempotencyKey,
  isJobName,
  JOB_NAMES,
  type JobName,
  jobIdFromKey,
  jobKey,
  ledgerRebuildDocumentJob,
  ledgerRebuildOrgJob,
  ledgerVerifyJob,
  opsHeartbeatJob,
  podkladyGenerateJob,
  podkladyReserveNightlyJob,
  podkladyReserveRefreshJob,
  tenantPayload,
  vatAmendmentDetectJob,
  vatFilingGenerateJob,
  vatPeriodEvaluateJob,
  vatWorkbookGenerateJob,
} from '../src/jobs';

const ORG = 'aaaaaaaa-0000-4000-8000-000000000001';
const DOC = 'bbbbbbbb-0000-4000-8000-000000000002';

describe('job names (03 §3.1)', () => {
  it('lists the 40 concrete job names, unique and `<domain>.<action>`', () => {
    expect(JOB_NAMES).toHaveLength(40);
    expect(new Set(JOB_NAMES).size).toBe(JOB_NAMES.length);
    for (const name of JOB_NAMES) {
      expect(name).toMatch(/^[a-z]+(\.[a-z_]+)+$/);
    }
    expect(JOB_NAMES).toContain('doc.split');
    expect(JOB_NAMES).toContain('ingest.item.process');
    expect(JOB_NAMES).toContain('notifications.urgent');
  });

  it('accepts concrete names and members of the bank/package/retention/privacy/ops families', () => {
    expect(isJobName('doc.categorize')).toBe(true);
    expect(isJobName('retention.eml_purge')).toBe(true);
    expect(isJobName('privacy.export_org')).toBe(true);
    expect(isJobName('ops.heartbeat')).toBe(true);
  });

  it('rejects events, unknown domains and malformed names', () => {
    expect(isJobName('document.received')).toBe(false);
    expect(isJobName('doc.unknown')).toBe(false);
    expect(isJobName('ops')).toBe(false);
    expect(isJobName('ops.')).toBe(false);
    expect(isJobName('ops.Heartbeat')).toBe(false);
    expect(isJobName('foo.bar')).toBe(false);
  });
});

describe('payloads carry ids only', () => {
  it('documentStagePayload accepts { orgId, documentId }', () => {
    expect(documentStagePayload.parse({ orgId: ORG, documentId: DOC })).toEqual({
      orgId: ORG,
      documentId: DOC,
    });
  });

  it('rejects a non-id field, a non-UUID id and a missing orgId', () => {
    expect(
      documentStagePayload.safeParse({ orgId: ORG, documentId: DOC, ocrText: 'Faktura' }).success,
    ).toBe(false);
    expect(documentStagePayload.safeParse({ orgId: ORG, documentId: 'doc-1' }).success).toBe(false);
    expect(documentStagePayload.safeParse({ documentId: DOC }).success).toBe(false);
  });

  it('tenantPayload adds orgId and stays strict', () => {
    const schema = tenantPayload({ transactionId: z.uuid() });
    expect(schema.safeParse({ orgId: ORG, transactionId: DOC }).success).toBe(true);
    expect(schema.safeParse({ orgId: ORG, transactionId: DOC, amount: '1.00' }).success).toBe(
      false,
    );
  });
});

describe('idempotency key {org_id}:{stage}:{entity_id}:{version}', () => {
  it('formats the four parts', () => {
    expect(idempotencyKey({ orgId: ORG, stage: 'doc.split', entityId: DOC, version: 2 })).toBe(
      `${ORG}:doc.split:${DOC}:2`,
    );
  });

  it('rejects a non-UUID org, a ":" in a part and a version below 1', () => {
    expect(() =>
      idempotencyKey({ orgId: 'org', stage: 'doc.split', entityId: DOC, version: 1 }),
    ).toThrow(TypeError);
    expect(() =>
      idempotencyKey({ orgId: ORG, stage: 'doc:split', entityId: DOC, version: 1 }),
    ).toThrow(TypeError);
    expect(() =>
      idempotencyKey({ orgId: ORG, stage: 'doc.split', entityId: '', version: 1 }),
    ).toThrow(TypeError);
    expect(() =>
      idempotencyKey({ orgId: ORG, stage: 'doc.split', entityId: DOC, version: 0 }),
    ).toThrow(TypeError);
    expect(() =>
      idempotencyKey({ orgId: ORG, stage: 'doc.split', entityId: DOC, version: 1.5 }),
    ).toThrow(TypeError);
  });

  it('jobKey uses the definition name, entityId and version', () => {
    const split = defineTenantJob({
      name: 'doc.split',
      payload: documentStagePayload,
      version: 3,
      entityId: (p) => p.documentId,
    });
    expect(jobKey(split, { orgId: ORG, documentId: DOC })).toBe(`${ORG}:doc.split:${DOC}:3`);
  });
});

describe('job definitions', () => {
  it('a tenant job gets the default retry policy: 5 attempts with exponential backoff', () => {
    const split = defineTenantJob({
      name: 'doc.split',
      payload: documentStagePayload,
      version: 1,
      entityId: (p) => p.documentId,
    });
    expect(split.scope).toBe('tenant');
    expect(split.retry).toEqual(DEFAULT_RETRY);
    expect(DEFAULT_RETRY.retryLimit).toBe(4);
    expect(DEFAULT_RETRY.retryBackoff).toBe(true);
    expect(deadLetterName(split.name)).toBe('doc.split.dlq');
  });

  it('retry overrides merge over the default', () => {
    const job = defineSystemJob({
      name: 'ops.rate_limit_gc',
      payload: z.strictObject({}),
      cron: '0 3 * * *',
      retry: { retryLimit: 1 },
    });
    expect(job.retry).toEqual({ ...DEFAULT_RETRY, retryLimit: 1 });
    expect(job.cron).toBe('0 3 * * *');
  });

  it('rejects a name outside 03 §3.1 and a version below 1', () => {
    expect(() =>
      defineTenantJob({
        name: 'doc.ocr' as JobName,
        payload: documentStagePayload,
        version: 1,
        entityId: (p) => p.documentId,
      }),
    ).toThrow(/03 §3.1/);
    expect(() =>
      defineTenantJob({
        name: 'doc.split',
        payload: documentStagePayload,
        version: 0,
        entityId: (p) => p.documentId,
      }),
    ).toThrow(TypeError);
  });

  it('ops.heartbeat is a system cron every minute, crons run in Europe/Prague', () => {
    expect(opsHeartbeatJob.scope).toBe('system');
    expect(opsHeartbeatJob.name).toBe('ops.heartbeat');
    expect(opsHeartbeatJob.cron).toBe('* * * * *');
    expect(opsHeartbeatJob.retry.retryLimit).toBe(0);
    expect(CRON_TIME_ZONE).toBe('Europe/Prague');
  });
});

describe('docExtractJob and jobIdFromKey', () => {
  const ORG = '11111111-1111-4111-8111-111111111111';
  const DOC = '22222222-2222-4222-8222-222222222222';
  it('keys on the document', () => {
    expect(jobKey(docExtractJob, { orgId: ORG, documentId: DOC })).toBe(
      `${ORG}:doc.extract:${DOC}:1`,
    );
  });
  it('derives a stable UUID from the key', () => {
    const id = jobIdFromKey(`${ORG}:doc.extract:${DOC}:1`);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(jobIdFromKey(`${ORG}:doc.extract:${DOC}:1`)).toBe(id);
  });
});

describe('M04 jobs', () => {
  const ORG = '11111111-1111-4111-8111-111111111111';
  const DOC = '22222222-2222-4222-8222-222222222222';
  it('doc.categorize keys on document, revision and trigger, plus the nonce when given', () => {
    expect(
      jobKey(docCategorizeJob, { orgId: ORG, documentId: DOC, revision: 2, trigger: 'pipeline' }),
    ).toBe(`${ORG}:doc.categorize:${DOC}-2-pipeline:1`);
    expect(
      jobKey(docCategorizeJob, {
        orgId: ORG,
        documentId: DOC,
        revision: 2,
        trigger: 'question_answered',
        nonce: 17,
      }),
    ).toBe(`${ORG}:doc.categorize:${DOC}-2-question_answered-17:1`);
    expect(
      docCategorizeJob.payload.safeParse({
        orgId: ORG,
        documentId: DOC,
        revision: 1,
        trigger: 'nope',
      }).success,
    ).toBe(false);
    expect(
      docCategorizeJob.payload.safeParse({
        orgId: ORG,
        documentId: DOC,
        revision: 1,
        trigger: 'pipeline',
        text: 'x',
      }).success,
    ).toBe(false);
  });
  it('ledger.rebuild_document keys on document and reason', () => {
    expect(
      jobKey(ledgerRebuildDocumentJob, { orgId: ORG, documentId: DOC, reason: 'categorized' }),
    ).toBe(`${ORG}:ledger.rebuild_document:${DOC}-categorized:1`);
  });
  it('ledger.rebuild_org accepts an optional from date and is retried once', () => {
    expect(ledgerRebuildOrgJob.payload.parse({ orgId: ORG, reason: 'manual' })).toEqual({
      orgId: ORG,
      reason: 'manual',
    });
    expect(
      jobKey(ledgerRebuildOrgJob, { orgId: ORG, reason: 'profile_changed', from: '2026-01-01' }),
    ).toBe(`${ORG}:ledger.rebuild_org:org-profile_changed-2026-01-01:1`);
    expect(
      ledgerRebuildOrgJob.payload.safeParse({ orgId: ORG, reason: 'manual', from: '01.01.2026' })
        .success,
    ).toBe(false);
    expect(ledgerRebuildOrgJob.retry.retryLimit).toBe(1);
  });
  it('ledger.verify is a nightly system cron with samplePct defaulting to 1', () => {
    expect(ledgerVerifyJob.scope).toBe('system');
    expect(ledgerVerifyJob.cron).toBe('45 3 * * *');
    expect(ledgerVerifyJob.payload.parse({})).toEqual({ samplePct: 1 });
  });
});

describe('M05 VAT jobs', () => {
  const ORG = '11111111-1111-4111-8111-111111111111';
  const USER = '33333333-3333-4333-8333-333333333333';
  it('vat.filing.generate validates the M05 payload and keys on period and kind', () => {
    const payload = {
      orgId: ORG,
      periodStart: '2026-08-01',
      kind: 'radne' as const,
      requestedBy: USER,
    };
    expect(vatFilingGenerateJob.payload.parse(payload)).toEqual(payload);
    expect(() => vatFilingGenerateJob.payload.parse({ ...payload, kind: 'x' })).toThrow();
    expect(vatFilingGenerateJob.name).toBe('vat.filing.generate');
    expect(vatFilingGenerateJob.entityId(payload)).toBe('2026-08-01:radne');
    expect(
      vatPeriodEvaluateJob.entityId({ orgId: ORG, periodStart: '2026-08-01', family: 'IO' }),
    ).toBe('2026-08-01');
    expect(vatWorkbookGenerateJob.payload.parse({ orgId: ORG, periodStart: '2026-08-01' })).toEqual(
      {
        orgId: ORG,
        periodStart: '2026-08-01',
      },
    );
    expect(vatAmendmentDetectJob.version).toBe(1);
  });
});

describe('M06 podklady jobs', () => {
  const org = '11111111-1111-4111-8111-111111111111';
  const user = '33333333-3333-4333-8333-333333333333';
  it('podklady.generate validates year >= 2024 and keys on year and answers version', () => {
    const payload = { orgId: org, year: 2026, answersVersion: 2, requestedBy: user };
    expect(podkladyGenerateJob.payload.parse(payload)).toEqual(payload);
    expect(() => podkladyGenerateJob.payload.parse({ ...payload, year: 2023 })).toThrow();
    expect(() => podkladyGenerateJob.payload.parse({ ...payload, answersVersion: 1.5 })).toThrow();
    expect(podkladyGenerateJob.entityId(payload)).toBe('2026-2');
  });
  it('podklady.reserve.refresh accepts the three reasons only and keys on the reason', () => {
    const payload = { orgId: org, reason: 'ledger_rebuilt' as const };
    expect(podkladyReserveRefreshJob.payload.parse(payload)).toEqual(payload);
    expect(() => podkladyReserveRefreshJob.payload.parse({ orgId: org, reason: 'x' })).toThrow();
    expect(jobKey(podkladyReserveRefreshJob, payload)).toBe(
      `${org}:podklady.reserve.refresh:reserve-ledger_rebuilt:1`,
    );
  });
  it('podklady.reserve.nightly is a system cron at 02:30', () => {
    expect(podkladyReserveNightlyJob.scope).toBe('system');
    expect(podkladyReserveNightlyJob.cron).toBe('30 2 * * *');
  });
});

describe('bank radar jobs (M07 §4.8)', () => {
  it('bank.radar.refresh is a singleton per org', () => {
    const payload = { orgId: '11111111-1111-4111-8111-111111111111' };
    expect(bankRadarRefreshJob.payload.parse(payload)).toEqual(payload);
    expect(jobKey(bankRadarRefreshJob, payload)).toBe(
      `${payload.orgId}:bank.radar.refresh:refresh:1`,
    );
  });
  it('bank.radar.nightly is a system cron', () => {
    expect(bankRadarNightlyJob.scope).toBe('system');
    expect(bankRadarNightlyJob.cron).toBe('20 3 * * *');
  });
});
