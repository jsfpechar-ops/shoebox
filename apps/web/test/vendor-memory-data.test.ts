import { describe, expect, it } from 'vitest';
import { vendorMemoryRowOf } from '../src/settings/vendor-memory-data';

describe('vendorMemoryRowOf', () => {
  it('maps a profile with its supplier and category', () => {
    expect(
      vendorMemoryRowOf({ id: 'v1', pinned: true, partners: { name: 'Shell' }, categories: [{ label_en: 'Fuel' }] }),
    ).toEqual({ id: 'v1', supplier: 'Shell', category: 'Fuel', pinned: true });
  });
  it('skips rows without a supplier or category', () => {
    expect(vendorMemoryRowOf({ id: 'v2', partners: null, categories: { label_en: 'Fuel' } })).toBeNull();
    expect(vendorMemoryRowOf({ id: 'v3', partners: { name: 'Shell' }, categories: null })).toBeNull();
  });
});
