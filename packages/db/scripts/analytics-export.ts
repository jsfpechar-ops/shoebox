// Staff-only CSV export of the failure analytics views (brief 0521). One CSV per view.
// Usage: DATABASE_URL=<service-role or postgres URL> node packages/db/scripts/analytics-export.ts \
//          [--from 2026-10-01] [--out analytics-out]
// The CSVs hold codes, counts and supplier IČO only. Do not commit them.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { ANALYTICS_VIEWS, readAnalyticsView, toCsv } from '../src/analytics.ts';

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

const url = process.env.DATABASE_URL;
if (!url) {
  process.stderr.write('DATABASE_URL is not set\n');
  process.exit(2);
}
const out = arg('out') ?? 'analytics-out';
const from = arg('from');
mkdirSync(out, { recursive: true });
const sql = postgres(url, { max: 1, onnotice: () => undefined });
try {
  for (const view of ANALYTICS_VIEWS) {
    const rows = await readAnalyticsView(sql, view, from);
    writeFileSync(join(out, `${view}.csv`), toCsv(rows));
    process.stdout.write(`${view}: ${rows.length} rows\n`);
  }
} finally {
  await sql.end();
}
