import { describe, expect, it } from 'vitest';
import { packageName } from '../src/index';

describe('@shoebox/tax-xml', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@shoebox/tax-xml');
  });
});
