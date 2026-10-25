/**
 * M12 §4.7: the only keys a log line may carry besides ts, level and msg.
 * Allowlist, not denylist: any other key (partnerName, text, iban, amount, fileName, err, ...) is dropped.
 */
export const LOG_FIELD_ALLOWLIST = [
  'service',
  'env',
  'release',
  'requestId',
  'traceId',
  'orgId',
  'userId',
  'jobName',
  'jobId',
  'documentId',
  'stage',
  'durationMs',
  'errorCode',
  'httpStatus',
] as const;

export type LogField = (typeof LOG_FIELD_ALLOWLIST)[number];

export type LogValue = string | number | boolean | null;

const ALLOWED: ReadonlySet<string> = new Set(LOG_FIELD_ALLOWLIST);

function isLogValue(value: unknown): value is LogValue {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  return typeof value === 'number' && Number.isFinite(value);
}

/** Keeps only allowlisted keys whose value is a primitive; nested objects are dropped. */
export function pickAllowed(input: Record<string, unknown>): Partial<Record<LogField, LogValue>> {
  const out: Partial<Record<LogField, LogValue>> = {};
  for (const [key, value] of Object.entries(input)) {
    if (ALLOWED.has(key) && isLogValue(value)) {
      out[key as LogField] = value;
    }
  }
  return out;
}
