// @vitest-environment happy-dom
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SONNER_STYLE_HASH } from '../src/security/headers';

describe('CSP hash for the <style> that sonner injects (M12 §4.5)', () => {
  it('SONNER_STYLE_HASH is the sha256 of the CSS sonner injects at module load', async () => {
    // @shoebox/ui re-exports sonner (overlay.tsx); importing it runs sonner's __insertCSS in happy-dom.
    await import('@shoebox/ui');
    const styles = Array.from(document.head.querySelectorAll('style'));
    const sonner = styles.find((style) => style.textContent?.includes('[data-sonner-toaster]'));
    expect(sonner, 'sonner injected no <style>; drop SONNER_STYLE_HASH from the CSP').toBeDefined();
    const hash = `sha256-${createHash('sha256')
      .update(sonner?.textContent ?? '', 'utf8')
      .digest('base64')}`;
    expect(hash, 'sonner CSS changed: update SONNER_STYLE_HASH in src/security/headers.ts').toBe(
      SONNER_STYLE_HASH,
    );
  });
});
