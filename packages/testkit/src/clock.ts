import type { Clock } from '@shoebox/domain';

/** Default start of every fake clock: a fixed instant, never the wall clock. */
export const FAKE_CLOCK_START = '2026-01-01T00:00:00.000Z';

/** A `Clock` for tests: it moves only when the test says so. */
export interface FakeClock extends Clock {
  /** Moves the clock forward by `ms` milliseconds (a non-negative integer). */
  advance(ms: number): void;
  /** Jumps to an instant: an ISO 8601 string with an offset or `Z`, or epoch milliseconds. */
  set(instant: string | number): void;
}

function toEpochMs(instant: string | number): number {
  const ms = typeof instant === 'number' ? instant : Date.parse(instant);
  if (!Number.isFinite(ms)) {
    throw new RangeError(`fakeClock: not a valid instant: ${String(instant)}`);
  }
  return ms;
}

/** Creates a fake clock frozen at `start` (default `FAKE_CLOCK_START`). */
export function fakeClock(start: string | number = FAKE_CLOCK_START): FakeClock {
  let current = toEpochMs(start);
  return {
    now: () => current,
    advance(ms: number) {
      if (!Number.isSafeInteger(ms) || ms < 0) {
        throw new RangeError(`fakeClock.advance: ms must be a non-negative integer, got ${ms}`);
      }
      current += ms;
    },
    set(instant: string | number) {
      current = toEpochMs(instant);
    },
  };
}
