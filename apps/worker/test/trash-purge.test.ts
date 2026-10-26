import type { ServiceTx, TrashPurge } from '@shoebox/db';
import { describe, expect, it, vi } from 'vitest';
import { createTrashPurgeHandler, TRASH_DAYS } from '../src/retention/trash-purge';

const ORG = 'aaaaaaaa-0000-4000-8000-000000000001';
const PATH = `org/${ORG}/files/${'a'.repeat(64)}`;
const ctx = { jobId: 'j', attempt: 1, signal: new AbortController().signal };
const db = {
  withServiceRole: vi.fn(async (_r: string, fn: (tx: ServiceTx) => Promise<unknown>) =>
    fn({} as ServiceTx),
  ),
};

describe('retention.trash_purge handler', () => {
  it('uses a 30-day cutoff and deletes the returned Storage objects', async () => {
    const now = Date.parse('2026-10-26T02:30:00Z');
    const purge = vi.fn(
      async (): Promise<TrashPurge> => ({ documents: 1, paths: [PATH, 'not-a-path'] }),
    );
    const blobs = { delete: vi.fn(async () => undefined) };
    const logger = { info: vi.fn() };
    await createTrashPurgeHandler({ db: db as never, blobs, logger, now: () => now, purge })(
      {},
      ctx,
    );
    const [, cutoff, today, limit] = purge.mock.calls[0] as unknown as [
      unknown,
      Date,
      string,
      number,
    ];
    expect(cutoff.getTime()).toBe(now - TRASH_DAYS * 86_400_000);
    expect(today).toBe('2026-10-26');
    expect(limit).toBe(200);
    expect(blobs.delete).toHaveBeenCalledWith([PATH]);
    expect(logger.info).toHaveBeenCalledWith(
      { documents: 1, objects: 1 },
      'retention.trash_purge done',
    );
  });

  it('runs another batch while a batch is full', async () => {
    const purge = vi
      .fn()
      .mockResolvedValueOnce({ documents: 200, paths: [] })
      .mockResolvedValueOnce({ documents: 3, paths: [] });
    const blobs = { delete: vi.fn(async () => undefined) };
    await createTrashPurgeHandler({ db: db as never, blobs, logger: { info: vi.fn() }, purge })(
      {},
      ctx,
    );
    expect(purge).toHaveBeenCalledTimes(2);
    expect(blobs.delete).not.toHaveBeenCalled();
  });

  it('a failed Storage delete fails the job (the batch rolls back)', async () => {
    const purge = vi.fn(async (): Promise<TrashPurge> => ({ documents: 1, paths: [PATH] }));
    const blobs = {
      delete: vi.fn(async () => {
        throw new Error('storage down');
      }),
    };
    await expect(
      createTrashPurgeHandler({ db: db as never, blobs, logger: { info: vi.fn() }, purge })(
        {},
        ctx,
      ),
    ).rejects.toThrow('storage down');
  });
});
