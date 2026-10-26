'use client';

import { catalogs, type MessageKey, t } from '@shoebox/i18n';
import type { ImportMapping, ImportOptions, ImportPreview } from '@shoebox/pipeline';
import { Button, Card, cn, focusRing, Label } from '@shoebox/ui';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  canUndo,
  isRunning,
  missingRequired,
  setTarget,
  skippedTotal,
  TARGET_ORDER,
  type WizardImportState,
  type WizardTarget,
} from './wizard-state';

interface Parsed {
  id: string;
  headers: string[];
  mapping: ImportMapping;
  options: ImportOptions;
  preview: ImportPreview;
}

interface Status {
  state: WizardImportState | 'undoing';
  rowCount: number;
  importedCount: number;
  skippedCount: number;
  duplicateCount: number;
  createdAt: string;
}

const API = '/api/v1/imports';
const selectClass = cn(
  'min-h-11 rounded-control border border-input bg-card px-3 text-body',
  focusRing,
);

function errorText(code: unknown): string {
  const key = typeof code === 'string' ? code : '';
  return key in catalogs.en ? t(key as MessageKey) : t('import.unreadable');
}

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function ImportWizard() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [undone, setUndone] = useState(false);
  const requestCounter = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: focus the heading whenever the step changes
  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(API, { method: 'POST', body: form });
      const json = await res.json();
      if (!res.ok) {
        setError(errorText(json?.error));
        return;
      }
      setParsed(json as Parsed);
      setStep(2);
    } catch {
      setError(t('import.unreadable'));
    } finally {
      setBusy(false);
    }
  }

  async function onTarget(target: WizardTarget, value: string) {
    if (!parsed) return;
    const mapping = setTarget(parsed.mapping, target, value === '' ? null : Number(value));
    setParsed({ ...parsed, mapping });
    const mine = ++requestCounter.current;
    try {
      const res = await postJson(`${API}/${parsed.id}/preview`, {
        mapping,
        options: parsed.options,
      });
      const json = await res.json();
      if (mine !== requestCounter.current) return; // an older response
      if (!res.ok) {
        setError(errorText(json?.error));
        return;
      }
      setError(null);
      setParsed((current) => (current ? { ...current, preview: json.preview } : current));
    } catch {
      if (mine === requestCounter.current) setError(t('import.unreadable'));
    }
  }

  async function onStart() {
    if (!parsed) return;
    setError(null);
    setBusy(true);
    try {
      const res = await postJson(`${API}/${parsed.id}/start`, {
        mapping: parsed.mapping,
        options: parsed.options,
      });
      const json = await res.json();
      if (!res.ok) {
        setError(errorText(json?.error));
        return;
      }
      setStatus(null);
      setStep(3);
    } catch {
      setError(t('import.unreadable'));
    } finally {
      setBusy(false);
    }
  }

  const importId = parsed?.id;
  const poll = useCallback(async () => {
    if (!importId) return null;
    const res = await fetch(`${API}/${importId}`);
    if (!res.ok) return null;
    return (await res.json()) as Status;
  }, [importId]);

  const running = step === 3 && (status === null || isRunning(status.state as WizardImportState));
  useEffect(() => {
    if (step !== 3 || !running) return;
    let cancelled = false;
    const tick = async () => {
      const next = await poll().catch(() => null);
      if (!cancelled && next) setStatus(next);
    };
    void tick();
    const timer = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [step, running, poll]);

  async function onUndo() {
    if (!parsed) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`${API}/${parsed.id}/undo`, { method: 'POST' });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setError(errorText(json?.error));
        return;
      }
      setUndone(true);
    } catch {
      setError(t('import.unreadable'));
    } finally {
      setBusy(false);
    }
  }

  const headingClass = cn('text-title', focusRing);
  const errorEl = error ? (
    <p role="alert" className="text-body text-destructive">
      {error}
    </p>
  ) : null;

  if (step === 1) {
    return (
      <Card className="flex flex-col gap-4 p-6">
        <h2 ref={heading} tabIndex={-1} className={headingClass}>
          {t('import.wizard.step1')}
        </h2>
        <Label htmlFor="import-file">{t('import.wizard.choose')}</Label>
        <input
          id="import-file"
          type="file"
          accept=".xlsx,.csv"
          disabled={busy}
          onChange={(e) => void onFile(e.target.files?.[0])}
          className={cn('text-body', focusRing)}
        />
        {errorEl}
      </Card>
    );
  }

  if (!parsed) return null;

  if (step === 2) {
    const missing = missingRequired(parsed.mapping);
    const shown = TARGET_ORDER.filter((target) => parsed.mapping[target] !== undefined);
    const { counts } = parsed.preview;
    return (
      <Card className="flex flex-col gap-4 p-6">
        <h2 ref={heading} tabIndex={-1} className={headingClass}>
          {t('import.wizard.step2')}
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-body">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th scope="col" className="px-2 py-1">
                  {t('import.wizard.row', { n: '' }).trim()}
                </th>
                {shown.map((target) => (
                  <th key={target} scope="col" className="px-2 py-1">
                    {t(`import.target.${target}` as MessageKey)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {parsed.preview.rows.map((row) => (
                <tr key={row.rowNumber} className="border-t border-input">
                  <td className="px-2 py-1">{row.rowNumber}</td>
                  {row.result.ok ? (
                    shown.map((target) => {
                      const value = (row.result.ok ? row.result.value : null)?.[target];
                      return (
                        <td key={target} className="px-2 py-1">
                          {value === null || value === undefined ? '' : String(value)}
                        </td>
                      );
                    })
                  ) : (
                    <td colSpan={Math.max(shown.length, 1)} className="px-2 py-1 text-warning">
                      {t(`import.skip.${row.result.reason}` as MessageKey)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {TARGET_ORDER.map((target) => (
            <div key={target} className="flex flex-col gap-1">
              <Label htmlFor={`map-${target}`}>{t(`import.target.${target}` as MessageKey)}</Label>
              <select
                id={`map-${target}`}
                className={selectClass}
                value={parsed.mapping[target] === undefined ? '' : String(parsed.mapping[target])}
                onChange={(e) => void onTarget(target, e.target.value)}
              >
                <option value="">{t('import.wizard.not_used')}</option>
                {parsed.headers.map((header, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: the column index is the identity
                  <option key={index} value={String(index)}>
                    {header}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <p aria-live="polite" className="text-body">
          {t('import.wizard.step3', { valid: counts.valid, skipped: skippedTotal(counts) })}
        </p>
        {missing.length > 0 ? <p className="text-body">{t('import.missing_targets')}</p> : null}
        {errorEl}
        <div className="flex gap-3">
          <Button variant="secondary" onClick={() => setStep(1)}>
            {t('import.wizard.back')}
          </Button>
          <Button disabled={missing.length > 0 || busy} onClick={() => void onStart()}>
            {t('import.wizard.import')}
          </Button>
        </div>
      </Card>
    );
  }

  const skipped = status ? status.skippedCount : 0;
  return (
    <Card className="flex flex-col gap-4 p-6">
      <h2 ref={heading} tabIndex={-1} className={headingClass}>
        {t('import.wizard.import')}
      </h2>
      <p aria-live="polite" className="text-body">
        {undone
          ? t('import.wizard.undone')
          : status === null || isRunning(status.state as WizardImportState)
            ? t('import.wizard.running', {
                done: status?.importedCount ?? 0,
                total: status?.rowCount ?? parsed.preview.counts.valid,
              })
            : status.state === 'failed'
              ? t('import.wizard.failed')
              : t('import.wizard.done', {
                  imported: status.importedCount,
                  skipped,
                  duplicates: status.duplicateCount,
                })}
      </p>
      {errorEl}
      <div className="flex flex-wrap items-center gap-4">
        <Link href="/inbox" className="text-body underline">
          {t('import.wizard.open_inbox')}
        </Link>
        {status &&
        !undone &&
        canUndo(status.state as WizardImportState, status.createdAt, new Date()) ? (
          <Button variant="secondary" disabled={busy} onClick={() => void onUndo()}>
            {t('import.wizard.undo')}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
