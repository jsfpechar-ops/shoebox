import { t } from '@shoebox/i18n';
import { HelpTip } from '../overview/help-tip';

const card = 'grid gap-4 rounded-card border border-border bg-card p-6 text-foreground';

export function ReserveTile({ text }: { text: { main: string; badge: string } }) {
  return (
    <section aria-labelledby="reserve-title" className={card}>
      <h2 id="reserve-title" className="text-body font-semibold">
        {t('reserve.label')}
      </h2>
      <p className="num text-kpi">{text.main}</p>
      <span className="justify-self-start rounded-control border border-border px-2 text-body">
        {text.badge}
      </span>
      <HelpTip term={t('reserve.label')} text={t('reserve.how')} />
    </section>
  );
}
