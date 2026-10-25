import { describe, expect, it } from 'vitest';
import { packageName } from '../src/index';

describe('@shoebox/email-worker', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@shoebox/email-worker');
  });
});
