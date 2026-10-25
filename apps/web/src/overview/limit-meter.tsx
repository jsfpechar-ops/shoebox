import type { LimitMeter } from '@shoebox/domain';
import { t } from '@shoebox/i18n';
import { OctagonAlert, TriangleAlert } from 'lucide-react';
import { formatCzkWhole, meterText } from './format';
import { HelpTip } from './help-tip';

const FILL = {
  ok: 'bg-primary',
  warn: 'bg-warning',
  alert: 'bg-destructive',
  exceeded: 'bg-destructive',
} as const;

/** One limit meter (M09 §4.4): a bar, the numbers as text, and a sentence for warn, alert and exceeded. */
export function LimitMeterBar({ meter }: { meter: LimitMeter }) {
  const labelId = `meter-${meter.id}`;
  const label = t(`overview.meter.${meter.id}`);
  const text = meterText(meter);
  const fill = Math.min(meter.percent, 100);
  const Icon = meter.level === 'exceeded' ? OctagonAlert : TriangleAlert;
  return (
    <li className="grid gap-1">
      <div className="flex items-center justify-between gap-2">
        <span id={labelId} className="text-body font-semibold">
          {label}
        </span>
        <HelpTip
          term={label}
          text={t(`overview.help.${meter.id}`, { limit: formatCzkWhole(meter.limit) })}
        />
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: a div bar carries the zone ticks and token colours a native meter cannot (M09 §4.4) */}
      <div
        role="meter"
        aria-labelledby={labelId}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={fill}
        aria-valuetext={text}
        className="relative h-3 overflow-hidden rounded-control bg-muted"
      >
        <div className={`h-full ${FILL[meter.level]}`} style={{ width: `${fill}%` }} />
        <div className="absolute inset-y-0 left-[80%] w-0.5 bg-background" />
        <div className="absolute inset-y-0 left-[95%] w-0.5 bg-background" />
      </div>
      <p className="num text-body">{text}</p>
      {meter.level === 'ok' ? null : (
        <p className="flex items-start gap-2 text-body">
          <Icon
            aria-hidden="true"
            className={`mt-0.5 size-5 shrink-0 ${meter.level === 'warn' ? 'text-warning' : 'text-destructive'}`}
          />
          <span>{t(`overview.meter.level.${meter.level}`)}</span>
        </p>
      )}
      {meter.hint === null ? null : (
        <p className="text-body">{t(`overview.meter.hint.${meter.hint}`)}</p>
      )}
    </li>
  );
}
