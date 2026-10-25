import { describe, expect, it } from 'vitest';
import { packageName } from '../src/index';

describe('@shoebox/platform', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@shoebox/platform');
  });
});
