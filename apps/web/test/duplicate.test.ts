import { describe, expect, it } from 'vitest';
import { type DuplicateStore, keepBoth } from '../src/documents/duplicate';

function fakeStore(status: string | null, blocking: number, failKeep = false) {
  const kept: Array<{ id: string; status: string }> = [];
  const store: DuplicateStore = {
    originalOf: async () => 'orig',
    statusOf: async () => status,
    openBlockingCount: async () => blocking,
    keep: async (id, s) => {
      if (failKeep) throw new Error('boom');
      kept.push({ id, status: s });
    },
  };
  return { store, kept };
}

describe('keepBoth', () => {
  it('a duplicate without blocking checks becomes ready', async () => {
    const { store, kept } = fakeStore('duplicate', 0);
    expect(await keepBoth(store, 'd1')).toEqual({ ok: true, status: 'ready' });
    expect(kept).toEqual([{ id: 'd1', status: 'ready' }]);
  });
  it('a duplicate with a blocking check goes to review', async () => {
    const { store } = fakeStore('duplicate', 2);
    expect(await keepBoth(store, 'd1')).toEqual({ ok: true, status: 'needs_review' });
  });
  it('anything that is not a duplicate is left alone', async () => {
    const { store, kept } = fakeStore('ready', 0);
    expect(await keepBoth(store, 'd1')).toEqual({ ok: false });
    expect(kept).toEqual([]);
  });
  it('a failed write is reported, not thrown', async () => {
    const { store } = fakeStore('duplicate', 0, true);
    expect(await keepBoth(store, 'd1')).toEqual({ ok: false });
  });
});
