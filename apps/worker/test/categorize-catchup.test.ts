import type { TenantTx } from '@shoebox/db';
import { describe, expect, it } from 'vitest';
import { createCategorizeCatchupHandler } from '../src/categorize/catchup';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '11111111-1111-4111-8111-111111111112';
const D1 = '22222222-2222-4222-8222-222222222221';
const D2 = '22222222-2222-4222-8222-222222222222';
const tx = {} as TenantTx;

describe('doc.categorize.catchup', () => {
  it('enqueues doc.categorize once per waiting document of every org, with one nonce per run', async () => {
    const enqueued: unknown[] = [];
    const logs: unknown[] = [];
    const handler = createCategorizeCatchupHandler({
      listOrgIds: async () => [ORG_A, ORG_B],
      withTenant: async (_org, fn) => fn(tx),
      enqueue: async (def, payload) => {
        enqueued.push({ name: def.name, payload });
        return enqueued.length === 2 ? null : `job-${enqueued.length}`;
      },
      logger: { info: (obj) => logs.push(obj) },
      now: () => 1_700_000_000_000,
      list: async (_tx, orgId) =>
        orgId === ORG_A
          ? [
              { id: D1, revision: 1 },
              { id: D2, revision: 2 },
            ]
          : [],
    });
    await handler({}, { attempt: 1 } as never);
    expect(enqueued).toEqual([
      {
        name: 'doc.categorize',
        payload: { orgId: ORG_A, documentId: D1, revision: 1, trigger: 'pipeline', nonce: 1_700_000_000_000 },
      },
      {
        name: 'doc.categorize',
        payload: { orgId: ORG_A, documentId: D2, revision: 2, trigger: 'pipeline', nonce: 1_700_000_000_000 },
      },
    ]);
    expect(logs).toEqual([{ event: 'doc.categorize.catchup.done', orgs: 2, enqueued: 1 }]);
  });
});
