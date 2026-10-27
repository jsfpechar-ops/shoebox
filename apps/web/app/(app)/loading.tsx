import { t } from '@shoebox/i18n';

export default function Loading() {
  return (
    <p role="status" className="text-body text-muted-foreground">
      {t('shell.loading')}
    </p>
  );
}
