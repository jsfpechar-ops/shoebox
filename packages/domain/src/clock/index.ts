// packages/domain never reads the wall clock (M12 §4.1 rule 2, lint no-date-now-in-domain).
// Callers pass a Clock; the system clock is built outside the domain (apps, worker).

/** The only way domain code learns the current time. */
export interface Clock {
  /** The current instant as milliseconds since the Unix epoch (UTC). */
  now(): number;
}

/** A clock frozen at one instant: an ISO 8601 string with an offset or `Z`, or epoch milliseconds. */
export function fixedClock(instant: string | number): Clock {
  const ms = typeof instant === 'number' ? instant : Date.parse(instant);
  if (!Number.isFinite(ms)) {
    throw new RangeError(`fixedClock: not a valid instant: ${String(instant)}`);
  }
  return { now: () => ms };
}
