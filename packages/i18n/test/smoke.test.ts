import { describe, expect, it } from 'vitest';
import { packageName } from '../src/index';

describe('@shoebox/i18n', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@shoebox/i18n');
  });
});
