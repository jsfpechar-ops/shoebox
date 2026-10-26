'use client';

import { t } from '@shoebox/i18n';
import { useState } from 'react';
import { PrepareSummaryButton } from './podklady-actions';

type Yn = 'yes' | 'no' | 'unknown';
const RATES = ['80', '60', '40', '30'] as const;

function YesNo({
  name,
  legend,
  value,
  onChange,
}: {
  name: string;
  legend: string;
  value: Yn;
  onChange: (v: Yn) => void;
}) {
  const options: { v: Yn; label: string }[] = [
    { v: 'yes', label: t('podklady.answers.yes') },
    { v: 'no', label: t('podklady.answers.no') },
    { v: 'unknown', label: t('podklady.answers.unknown') },
  ];
  return (
    <fieldset className="grid gap-1">
      <legend className="text-body font-semibold">{legend}</legend>
      <div className="flex flex-wrap gap-4">
        {options.map((o) => (
          <label key={o.v} className="flex min-h-11 items-center gap-2 text-body">
            <input
              type="radio"
              name={name}
              value={o.v}
              checked={value === o.v}
              onChange={() => onChange(o.v)}
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function RateSelect({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-body font-semibold">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-11 rounded-control border border-border bg-card px-2 text-body text-foreground"
      >
        <option value="">{t('podklady.answers.none')}</option>
        {RATES.map((r) => (
          <option key={r} value={r}>
            {`${r} %`}
          </option>
        ))}
      </select>
    </div>
  );
}

export function AnswersForm({
  year,
  regime,
  canWrite,
}: {
  year: number;
  regime: string | null;
  canWrite: boolean;
}) {
  const [otherIncome, setOtherIncome] = useState<Yn>('unknown');
  const [approx, setApprox] = useState('');
  const [employment, setEmployment] = useState<Yn>('unknown');
  const [insolvency, setInsolvency] = useState<Yn>('unknown');
  const [comparison, setComparison] = useState('');
  const [activity, setActivity] = useState('');
  if (!canWrite) return null;

  const pausalni = regime === 'pausalni_dan';
  const evidence = regime === 'danova_evidence';
  const rate = (v: string): 80 | 60 | 40 | 30 | null =>
    v === '80' ? 80 : v === '60' ? 60 : v === '40' ? 40 : v === '30' ? 30 : null;

  const answers = {
    otherIncome,
    otherIncomeApprox:
      pausalni && otherIncome === 'yes' && /^\d+$/.test(approx) ? Number(approx) : null,
    employmentBeyondLimits: pausalni ? employment : 'unknown',
    insolvencyOrPartner: pausalni ? insolvency : 'unknown',
    comparisonRate: evidence ? rate(comparison) : null,
    activityClass: pausalni ? rate(activity) : null,
  };

  return (
    <details className="rounded-card border border-border bg-card p-6 text-foreground">
      <summary className="min-h-11 cursor-pointer text-body font-semibold">
        {t('podklady.answers.open')}
      </summary>
      <div className="mt-4 grid gap-4">
        <YesNo
          name="otherIncome"
          legend={t('podklady.answers.other_income')}
          value={otherIncome}
          onChange={setOtherIncome}
        />
        {pausalni && otherIncome === 'yes' ? (
          <div className="grid gap-1">
            <label htmlFor="otherIncomeApprox" className="text-body font-semibold">
              {t('podklady.answers.other_income_approx')}
            </label>
            <input
              id="otherIncomeApprox"
              inputMode="numeric"
              value={approx}
              onChange={(e) => setApprox(e.target.value)}
              className="min-h-11 rounded-control border border-border bg-card px-2 text-body text-foreground"
            />
          </div>
        ) : null}
        {pausalni ? (
          <>
            <YesNo
              name="employmentBeyondLimits"
              legend={t('podklady.answers.employment')}
              value={employment}
              onChange={setEmployment}
            />
            <YesNo
              name="insolvencyOrPartner"
              legend={t('podklady.answers.insolvency')}
              value={insolvency}
              onChange={setInsolvency}
            />
            <RateSelect
              id="activityClass"
              label={t('podklady.answers.activity_class')}
              value={activity}
              onChange={setActivity}
            />
          </>
        ) : null}
        {evidence ? (
          <RateSelect
            id="comparisonRate"
            label={t('podklady.answers.comparison_rate')}
            value={comparison}
            onChange={setComparison}
          />
        ) : null}
        <PrepareSummaryButton year={year} answers={answers} />
      </div>
    </details>
  );
}
