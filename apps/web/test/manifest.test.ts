import { describe, expect, it } from 'vitest';
import manifest from '../app/manifest';

describe('web app manifest', () => {
  it('installs as Sysel, opens the inbox, has an icon', () => {
    const m = manifest();
    expect(m.name).toBe('Sysel');
    expect(m.start_url).toBe('/inbox');
    expect(m.display).toBe('standalone');
    expect(m.icons?.[0]?.src).toBe('/icon.svg');
    expect(m.shortcuts?.[0]?.url).toBe('/inbox');
  });
});
