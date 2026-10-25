import { afterAll, describe, expect, it } from 'vitest';
import { createDbPing } from '../src/health';

// The reachable case needs DATABASE_URL (local-pg.sh or Supabase CLI); the unreachable case needs nothing.
const DATABASE_URL = process.env.DATABASE_URL;

describe('createDbPing: unreachable database', () => {
  it('rejects quickly on a closed port instead of hanging', async () => {
    const probe = createDbPing('postgresql://postgres@127.0.0.1:1/nothing', { connectTimeoutS: 1 });
    const started = performance.now();
    await expect(probe.ping()).rejects.toThrow();
    expect(performance.now() - started).toBeLessThan(3_000);
    await probe.close();
  });
});

describe.skipIf(DATABASE_URL === undefined)('createDbPing: reachable database', () => {
  const probe = createDbPing(DATABASE_URL ?? '');
  afterAll(() => probe.close());

  it('answers select 1 and reuses the connection on the second probe', async () => {
    await probe.ping();
    const started = performance.now();
    await probe.ping();
    // M12 §4.2 budget: 200 ms. The second probe has a warm connection.
    expect(performance.now() - started).toBeLessThanOrEqual(200);
  });
});
