import { describe, expect, it } from 'vitest';
import { packageName } from '../src/index';

describe('@shoebox/exports', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@shoebox/exports');
  });
});
