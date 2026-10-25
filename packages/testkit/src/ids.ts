/** Deterministic UUID-shaped ids for tests: the same seed always yields the same sequence. */
export interface IdGenerator {
  /** The next id: `ssssssss-0000-4000-8000-nnnnnnnnnnnn` (s = seed, n = counter, both hex). */
  next(): string;
  /** Starts the sequence again from 1. */
  reset(): void;
}

const MAX_SEED = 0xffffffff;

function hex(value: number, width: number): string {
  return value.toString(16).padStart(width, '0');
}

/** Creates a generator; use a different `seed` (0..0xffffffff) per org so ids never collide. */
export function createIdGenerator(seed = 0): IdGenerator {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > MAX_SEED) {
    throw new RangeError(`createIdGenerator: seed must be an integer 0..${MAX_SEED}, got ${seed}`);
  }
  let counter = 0;
  return {
    next() {
      counter += 1;
      return `${hex(seed, 8)}-0000-4000-8000-${hex(counter, 12)}`;
    },
    reset() {
      counter = 0;
    },
  };
}
