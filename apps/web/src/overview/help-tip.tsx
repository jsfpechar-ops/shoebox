import { t } from '@shoebox/i18n';
import { focusRing } from '@shoebox/ui';
import { CircleHelp } from 'lucide-react';

/** The "?" beside a tax term (07 §2 rule 12): native details, no JS, a 44 px target, body-size text. */
export function HelpTip({ term, text }: { term: string; text: string }) {
  return (
    <details className="relative shrink-0">
      <summary
        aria-label={t('overview.help.label', { term })}
        className={`flex size-11 cursor-pointer list-none items-center justify-center rounded-control text-foreground [&::-webkit-details-marker]:hidden ${focusRing}`}
      >
        <CircleHelp aria-hidden="true" className="size-5" />
      </summary>
      <p className="absolute right-0 top-11 z-10 w-72 max-w-[calc(100vw-3rem)] rounded-card border border-border bg-card p-4 text-body text-foreground">
        {text}
      </p>
    </details>
  );
}
