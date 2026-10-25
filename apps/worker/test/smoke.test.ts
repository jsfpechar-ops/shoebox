import { describe, expect, it } from 'vitest';
import { packageName } from '../src/index';

describe('@shoebox/worker', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@shoebox/worker');
  });
});
