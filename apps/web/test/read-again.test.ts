import { describe, expect, it } from 'vitest';
import { type ReadAgainDeps, restartFailedRead } from '../src/documents/read-again';

const ORG = '11111111-1111-4111-8111-111111111111';

function fake(options: { failed?: boolean; queueDown?: boolean } = {}) {
  const queued: { id: string; retry: string }[] = [];
  const deps: ReadAgainDeps = {
    async markReceived() {
      return options.failed ?? true;
    },
    async enqueue(_org, id, retry) {
      if (options.queueDown) throw new Error('down');
      queued.push({ id, retry });
    },
    now: () => 1_761_436_800_000,
  };
  return { deps, queued };
}

describe('restartFailedRead', () => {
  it('moves a failed document back to the queue with a new job key', async () => {
    const { deps, queued } = fake();
    expect(await restartFailedRead(deps, ORG, 'doc-1')).toBe(true);
    expect(queued).toEqual([{ id: 'doc-1', retry: '1761436800000' }]);
  });

  it('does nothing for a document that did not fail', async () => {
    const { deps, queued } = fake({ failed: false });
    expect(await restartFailedRead(deps, ORG, 'doc-1')).toBe(false);
    expect(queued).toEqual([]);
  });

  it('still counts as restarted when the queue is down', async () => {
    const { deps } = fake({ queueDown: true });
    expect(await restartFailedRead(deps, ORG, 'doc-1')).toBe(true);
  });
});
