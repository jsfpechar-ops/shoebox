import { t } from '@shoebox/i18n';
import type { MetadataRoute } from 'next';

/** Home-screen install (M01 §4.1.1 PWA). Served at /manifest.webmanifest, public (guard.ts). */
export default function manifest(): MetadataRoute.Manifest {
  // manifest needs literal colours (07 tokens: background, foreground)
  return {
    name: t('shell.app.name'),
    short_name: t('shell.manifest.short_name'),
    description: t('shell.manifest.description'),
    start_url: '/inbox',
    scope: '/',
    display: 'standalone',
    background_color: '#FFFFFF',
    theme_color: '#37352F',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
    shortcuts: [{ name: t('shell.manifest.shortcut_upload'), url: '/inbox' }],
  };
}
