import { NextResponse } from 'next/server';
import { checkHealth } from '../../../src/health/check';
import { dbPing } from '../../../src/health/db-ping';

/** Postgres driver needs Node; never prerender a health check. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** M12 §4.2: `GET /api/health` → 200 `{ status: 'ok', db: { ok: true, ms } }`, 503 otherwise. */
export async function GET(): Promise<NextResponse> {
  const result = await checkHealth({ ping: dbPing(process.env.DATABASE_URL) });
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { 'Cache-Control': 'no-store' },
  });
}
