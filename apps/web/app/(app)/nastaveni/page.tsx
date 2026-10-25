import { t } from '@shoebox/i18n';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: t('settings.title') };

export default function SettingsPage() {
  return <h1 className="text-title">{t('settings.title')}</h1>;
}
