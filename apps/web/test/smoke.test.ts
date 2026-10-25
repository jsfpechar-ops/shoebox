import { describe, expect, it } from 'vitest';
import { packageName } from '../src/index';

describe('@shoebox/web', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@shoebox/web');
  });
});
