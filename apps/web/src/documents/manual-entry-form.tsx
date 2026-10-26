'use client';

import { t } from '@shoebox/i18n';
import { Button, cn, focusRing, Input, Label } from '@shoebox/ui';
import { useActionState, useId, useState } from 'react';
import { type ManualState, saveManualEntryAction } from './manual-entry-actions';

const idle: ManualState = { errors: {} };
const selectClass = cn(
  'min-h-11 rounded-control border border-input bg-card px-3 text-body',
  focusRing,
);
const radioLabel = 'flex min-h-11 items-center gap-2 text-body';

/** A typed document. The checks run on it when it is saved, the same as on an upload. */
export function ManualEntryForm() {
  const id = useId();
  const [state, action, pending] = useActionState(saveManualEntryAction, idle);
  const [missing, setMissing] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${id}-kind`}>{t('manual.kind')}</Label>
        <select
          id={`${id}-kind`}
          name="kind"
          defaultValue="received_receipt"
          className={selectClass}
        >
          <option value="received_receipt">{t('manual.kind.received_receipt')}</option>
          <option value="received_invoice">{t('manual.kind.received_invoice')}</option>
          <option value="issued_invoice">{t('manual.kind.issued_invoice')}</option>
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor={`${id}-partner`}>{t('manual.partner')}</Label>
        <Input
          id={`${id}-partner`}
          name="partner"
          aria-invalid={state.errors.partner ? true : undefined}
          aria-describedby={`${id}-partner-hint ${state.errors.partner ? `${id}-partner-error` : ''}`.trim()}
        />
        <p id={`${id}-partner-hint`} className="text-body">
          {t('manual.partner.hint')}
        </p>
        {state.errors.partner ? (
          <p id={`${id}-partner-error`} role="alert" className="text-body text-destructive">
            {t(state.errors.partner)}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor={`${id}-date`}>{t('manual.date')}</Label>
        <Input
          id={`${id}-date`}
          name="date"
          type="date"
          defaultValue={today}
          aria-invalid={state.errors.date ? true : undefined}
          aria-describedby={state.errors.date ? `${id}-date-error` : undefined}
        />
        {state.errors.date ? (
          <p id={`${id}-date-error`} role="alert" className="text-body text-destructive">
            {t(state.errors.date)}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor={`${id}-amount`}>{t('manual.amount')}</Label>
        <Input
          id={`${id}-amount`}
          name="amount"
          inputMode="decimal"
          aria-invalid={state.errors.amount ? true : undefined}
          aria-describedby={state.errors.amount ? `${id}-amount-error` : undefined}
        />
        {state.errors.amount ? (
          <p id={`${id}-amount-error`} role="alert" className="text-body text-destructive">
            {t(state.errors.amount)}
          </p>
        ) : null}
      </div>

      <fieldset className="flex flex-col gap-1">
        <legend className="text-body">{t('manual.paid')}</legend>
        {(['cash', 'card', 'bank_transfer', 'unpaid'] as const).map((method) => (
          <label key={method} className={radioLabel}>
            <input type="radio" name="paid" value={method} defaultChecked={method === 'cash'} />
            {t(`manual.paid.${method}`)}
          </label>
        ))}
      </fieldset>

      <div className="flex flex-col gap-1">
        <Label htmlFor={`${id}-note`}>{t('manual.note')}</Label>
        <Input id={`${id}-note`} name="note" />
      </div>

      <label className={radioLabel}>
        <input
          type="checkbox"
          name="missing"
          checked={missing}
          onChange={(event) => setMissing(event.target.checked)}
        />
        {t('manual.missing')}
      </label>

      {missing ? (
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-reason`}>{t('manual.reason')}</Label>
          <select id={`${id}-reason`} name="reason" defaultValue="lost" className={selectClass}>
            <option value="lost">{t('manual.reason.lost')}</option>
            <option value="damaged">{t('manual.reason.damaged')}</option>
            <option value="never_issued">{t('manual.reason.never_issued')}</option>
            <option value="other">{t('manual.reason.other')}</option>
          </select>
          <p className="text-body">{t('manual.substitute.note')}</p>
        </div>
      ) : null}

      {state.errors.form ? (
        <p role="alert" className="text-body text-destructive">
          {t(state.errors.form)}
        </p>
      ) : null}

      <div>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {t('manual.save')}
        </Button>
      </div>
    </form>
  );
}
