// Staff-only failure analytics (brief 0521): the views of migrations/0064_analytics_views.sql and a
// CSV writer. Read with the service role; app roles cannot use schema `analytics`.
import type { Sql } from 'postgres';

export const ANALYTICS_VIEWS = [
  'failure_reasons_weekly',
  'field_corrections',
  'document_journey',
  'ai_cost_weekly',
  'supplier_trouble',
] as const;
export type AnalyticsView = (typeof ANALYTICS_VIEWS)[number];

/** The column a `from` date filters on, per view; views without one are all-time. */
const FROM_COLUMN: Partial<Record<AnalyticsView, string>> = {
  failure_reasons_weekly: 'week',
  ai_cost_weekly: 'week',
  document_journey: 'first_at',
};

/** RFC 4180 CSV with a header row from the first row's keys. Arrays join with ';', dates as ISO. */
export function toCsv(rows: readonly Record<string, unknown>[]): string {
  const first = rows[0];
  if (!first) return '';
  const keys = Object.keys(first);
  const cell = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    const text =
      value instanceof Date
        ? value.toISOString()
        : Array.isArray(value)
          ? value.join(';')
          : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const lines = [keys.join(','), ...rows.map((row) => keys.map((key) => cell(row[key])).join(','))];
  return `${lines.join('\n')}\n`;
}

/** All rows of one view (whole view on purpose: it is an export), optionally from a date (YYYY-MM-DD). */
export async function readAnalyticsView(
  sql: Sql,
  view: AnalyticsView,
  from?: string,
): Promise<Record<string, unknown>[]> {
  if (!ANALYTICS_VIEWS.includes(view)) throw new Error('unknown_view');
  const column = FROM_COLUMN[view];
  if (from !== undefined && column !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error('bad_from_date');
    return sql.unsafe(`select * from analytics.${view} where ${column} >= $1`, [from]);
  }
  return sql.unsafe(`select * from analytics.${view}`);
}
