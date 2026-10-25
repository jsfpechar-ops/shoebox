import { expect, test } from './fixtures';

/** M12 §4.2: `GET /api/health` (web: DB ping ≤ 200 ms). The route is public and carries the M12 §4.5 headers. */

test('/api/health: JSON report, 200 with a DB ping ≤ 200 ms or 503 with a reason', async ({
  request,
}) => {
  const response = await request.get('/api/health');
  const body = (await response.json()) as {
    status: string;
    db: { ok: boolean; ms?: number; withinBudget?: boolean; reason?: string };
  };
  expect([200, 503]).toContain(response.status());
  if (response.status() === 200) {
    expect(body.status).toBe('ok');
    expect(body.db.ok).toBe(true);
    expect(body.db.ms).toBeLessThanOrEqual(200);
    expect(body.db.withinBudget).toBe(true);
  } else {
    // No DATABASE_URL in this environment (the owner/CI run has one, see the brief's §7).
    expect(body).toEqual({
      status: 'error',
      db: { ok: false, reason: expect.stringMatching(/^(unconfigured|unreachable|timeout)$/) },
    });
  }
  expect(JSON.stringify(body)).not.toMatch(/postgres(ql)?:\/\//);
});

test('/api/health carries the security headers and is never cached', async ({ request }) => {
  const response = await request.get('/api/health');
  const headers = response.headers();
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['strict-transport-security']).toContain('max-age=63072000');
  expect(headers['cache-control']).toContain('no-store');
  expect(headers['content-type']).toContain('application/json');
});
