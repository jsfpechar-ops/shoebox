'use client';

import { cn } from '@shoebox/ui';
import type { ReactNode } from 'react';

export interface ChipOption<V extends string> {
  value: V;
  label: string;
}

const CHECK_MARK = '\u2713';

/** One question with radio chips (keyboard works: the inputs are real radios). WCAG 2.2 AA (07 §8). */
export function ChipQuestion<V extends string>({
  name,
  legend,
  help,
  options,
  value,
  onChange,
  layout = 'pills',
  hideLegend = false,
}: {
  name: string;
  legend: string;
  help?: ReactNode;
  options: readonly ChipOption<V>[];
  value: V | '';
  onChange: (value: V) => void;
  /** 'cards': full-width option blocks for the main questions of the wizard. */
  layout?: 'pills' | 'cards';
  /** The page shows the question as its own heading: keep the legend for screen readers only. */
  hideLegend?: boolean;
}) {
  const cards = layout === 'cards';
  return (
    <fieldset className="grid gap-2">
      <legend
        className={cn(hideLegend ? 'sr-only' : 'flex items-center gap-2 text-body font-medium')}
      >
        <span>{legend}</span>
        {hideLegend ? null : help}
      </legend>
      <div className={cn(cards ? 'grid gap-3' : 'flex flex-wrap gap-2')}>
        {options.map((option) => {
          const checked = value === option.value;
          return (
            <label
              key={option.value}
              className={cn('relative cursor-pointer', cards ? 'flex w-full' : 'inline-flex')}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                onChange={() => onChange(option.value)}
                className="peer sr-only"
              />
              <span
                className={cn(
                  cards
                    ? 'flex min-h-14 w-full items-center justify-between gap-3 rounded-card border border-border bg-card p-4 text-body text-foreground'
                    : 'inline-flex min-h-11 items-center rounded-control border border-border bg-card px-4 text-body text-foreground',
                  cards
                    ? 'peer-checked:border-primary peer-checked:bg-muted'
                    : 'peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground',
                  'peer-focus-visible:outline-none peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background',
                )}
              >
                {option.label}
                {cards && checked && (
                  <span aria-hidden="true" className="font-medium text-success">
                    {CHECK_MARK}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
