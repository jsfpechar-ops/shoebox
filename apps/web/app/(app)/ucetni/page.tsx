import { t } from '@shoebox/i18n';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: t('accountant.title') };

export default function AccountantPage() {
  return <h1 className="text-title">{t('accountant.title')}</h1>;
}
