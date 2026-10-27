'use client';

import { t } from '@shoebox/i18n';
import { Button, cn, focusRing, Label } from '@shoebox/ui';
import { useState } from 'react';

export interface ExportOption {
  readonly key: string;
  readonly label: string;
}

interface EmptyHint {
  readonly first: string | null;
  readonly last: string | null;
  readonly period: string;
}

type State =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'empty'; hint: EmptyHint }
  | { kind: 'failed' };

const selectClass = cn(
  'min-h-11 rounded-control border border-input bg-card px-3 text-body',
  focusRing,
);

function hintOf(body: unknown): EmptyHint | null {
  if (typeof body !== 'object' || body === null || !('hint' in body)) return null;
  const hint = body.hint as Record<string, unknown> | null;
  if (typeof hint !== 'object' || hint === null) return null;
  const text = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  return { first: text(hint.first), last: text(hint.last), period: text(hint.period) ?? '' };
}

/** Picks a period and downloads the ZIP; an empty period becomes a sentence with links, never an empty file. */
export function ExportForm({
  options,
  selected,
  monthLabels,
}: {
  options: readonly ExportOption[];
  selected: string;
  /** Month key to its readable label ("June 2025"), for the empty-period links. */
  monthLabels: Readonly<Record<string, string>>;
}) {
  const [period, setPeriod] = useState(selected);
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function download(key: string) {
    setState({ kind: 'busy' });
    try {
      const res = await fetch(`/api/export?period=${encodeURIComponent(key)}`);
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download =
          /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ??
          `sysel-${key}.zip`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setState({ kind: 'idle' });
        return;
      }
      const body: unknown = await res.json().catch(() => null);
      const hint = res.status === 409 ? hintOf(body) : null;
      setState(hint === null ? { kind: 'failed' } : { kind: 'empty', hint });
    } catch {
      setState({ kind: 'failed' });
    }
  }

  function pick(key: string) {
    setPeriod(key);
    setState({ kind: 'idle' });
  }

  const labelOf = (key: string) => monthLabels[key] ?? key;

  return (
    <div className="grid gap-3">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void download(period);
        }}
      >
        <div className="flex flex-col gap-1">
          <Label htmlFor="export-period">{t('export.period')}</Label>
          <select
            id="export-period"
            name="period"
            value={period}
            onChange={(event) => pick(event.target.value)}
            className={selectClass}
          >
            {options.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={state.kind === 'busy'}>
          {state.kind === 'busy' ? t('download.busy') : t('export.download')}
        </Button>
      </form>
      {state.kind === 'empty' ? (
        <div role="alert" className="grid gap-2 text-body">
          {state.hint.first !== null && state.hint.last !== null ? (
            <>
              <p>
                {t('export.empty', {
                  period: labelOf(state.hint.period),
                  first: labelOf(state.hint.first),
                  last: labelOf(state.hint.last),
                })}
              </p>
              <p className="flex flex-wrap gap-3">
                {[state.hint.first, state.hint.last]
                  .filter((key, i, all) => all.indexOf(key) === i)
                  .map((key) => (
                    <button
                      key={key}
                      type="button"
                      className={cn('min-h-11 text-primary underline', focusRing)}
                      onClick={() => pick(key)}
                    >
                      {labelOf(key)}
                    </button>
                  ))}
              </p>
            </>
          ) : (
            <p>{t('export.empty_none')}</p>
          )}
        </div>
      ) : null}
      {state.kind === 'failed' ? (
        <p role="alert" className="text-body">
          {t('download.failed')}
        </p>
      ) : null}
    </div>
  );
}
