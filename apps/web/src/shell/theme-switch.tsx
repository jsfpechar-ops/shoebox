'use client';

import { type MessageKey, t } from '@shoebox/i18n';
import { cn, focusRing, motion } from '@shoebox/ui';
import { useId, useState, useTransition } from 'react';
import { parseTheme, type ThemeChoice, themeAttribute, themeChoices } from './theme';
import { saveTheme } from './theme-actions';

const labels: Readonly<Record<ThemeChoice, MessageKey>> = {
  system: 'shell.theme.system',
  light: 'shell.theme.light',
  dark: 'shell.theme.dark',
};

/** Světlý / Tmavý / Podle systému. Applies at once on <html>, then saves the cookie. */
export function ThemeSwitch({ initial }: { initial: ThemeChoice }) {
  const id = useId();
  const [choice, setChoice] = useState<ThemeChoice>(initial);
  const [, startTransition] = useTransition();

  function change(value: string) {
    const next = parseTheme(value);
    setChoice(next);
    const attribute = themeAttribute(next);
    if (attribute === undefined) {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', attribute);
    }
    startTransition(async () => {
      await saveTheme(next);
    });
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-meta text-muted-foreground">
        {t('shell.theme.label')}
      </label>
      <select
        id={id}
        value={choice}
        onChange={(event) => change(event.target.value)}
        className={cn(
          'min-h-11 rounded-control border border-input bg-card px-3 text-body text-foreground',
          motion,
          focusRing,
        )}
      >
        {themeChoices.map((option) => (
          <option key={option} value={option}>
            {t(labels[option])}
          </option>
        ))}
      </select>
    </div>
  );
}
