'use client';

import { type MessageKey, t } from '@shoebox/i18n';
import { isValidIco } from '@shoebox/registries';
import { Button, Card, cn, focusRing, Input } from '@shoebox/ui';
import {
  type FormEvent,
  type ReactNode,
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from 'react';
import { completeOnboarding, type LookupResult, lookupIco, type OnboardingState } from './actions';
import { ChipQuestion } from './chips';
import { HelpTip } from './help-tip';
import type { OnboardingPrefill } from './prefill';
import { type TAX_REGIME_ANSWERS, VAT_ANSWERS } from './schema';
import {
  isLastStep,
  normalizeIcoInput,
  regimeOptions,
  stepsFor,
  type WizardStep,
} from './wizard-logic';

type Regime = (typeof TAX_REGIME_ANSWERS)[number];
type ManualField = 'name' | 'street' | 'city' | 'zip';

const VAT_LABELS: Record<(typeof VAT_ANSWERS)[number], MessageKey> = {
  neplatce: 'onboarding.vat.neplatce',
  platce_monthly: 'onboarding.vat.platce_monthly',
  platce_quarterly: 'onboarding.vat.platce_quarterly',
  identifikovana_osoba: 'onboarding.vat.identifikovana_osoba',
};

const REGIME_LABELS: Record<Regime, MessageKey> = {
  danova_evidence: 'onboarding.regime.danova_evidence',
  pausalni_vydaje: 'onboarding.regime.pausalni_vydaje',
  pausalni_dan: 'onboarding.regime.pausalni_dan',
  nevim: 'onboarding.regime.nevim',
};

const RATES = ['80', '60', '40', '30'] as const;
const BANDS = ['1', '2', '3'] as const;

const MANUAL_FIELDS: readonly { key: ManualField; label: MessageKey; autoComplete: string }[] = [
  { key: 'name', label: 'onboarding.manual.name', autoComplete: 'organization' },
  { key: 'street', label: 'onboarding.manual.street', autoComplete: 'street-address' },
  { key: 'city', label: 'onboarding.manual.city', autoComplete: 'address-level2' },
  { key: 'zip', label: 'onboarding.manual.zip', autoComplete: 'postal-code' },
];

const idle: OnboardingState = { status: 'idle' };

const CHECK_MARK = '\u2713';

/** ARES street line: street, then house number with the orientation number after a slash. */
function streetLine(prefill: OnboardingPrefill): string {
  const { street, house_number, orientation_number } = prefill.address;
  const house = house_number
    ? `${house_number}${orientation_number ? `/${orientation_number}` : ''}`
    : '';
  return [street, house].filter((part) => part !== '').join(' ');
}

/** The confirmation after a firm is created: the inbound address to send documents to (07 §2). */
function DoneView({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
    } catch {
      // Clipboard blocked: the address stays on screen to copy by hand.
    }
  }

  return (
    <section className="grid gap-6">
      <div className="grid justify-items-start gap-4">
        <span
          aria-hidden="true"
          className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-success text-title font-medium text-primary-foreground"
        >
          {CHECK_MARK}
        </span>
        <h2 ref={titleRef} tabIndex={-1} className="text-title focus:outline-none">
          {t('onboarding.done.title')}
        </h2>
        <p className="text-body">{t('onboarding.done.text')}</p>
      </div>
      <div className="grid gap-3">
        <p className="text-body">{t('onboarding.done.address')}</p>
        <Card className="p-4">
          <p className="break-all text-card-title">{address}</p>
        </Card>
        <Button variant="secondary" onClick={copy}>
          {copied ? t('onboarding.done.copied') : t('onboarding.done.copy')}
        </Button>
      </div>
      <a
        href="/inbox"
        className={cn(
          'inline-flex min-h-11 items-center justify-center rounded-control bg-primary px-4 text-body font-medium text-primary-foreground hover:opacity-90',
          focusRing,
        )}
      >
        {t('onboarding.done.continue')}
      </a>
    </section>
  );
}

/**
 * The wizard: one question per screen, with a progress bar and Back. The IČO is looked up by itself
 * at 8 digits. Server work is in ./actions. Only the final submit posts the form; the answers of the
 * other screens travel as hidden inputs so going Back never loses them.
 */
export function OnboardingWizard() {
  const uid = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const icoRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
  const advanceTimer = useRef<number | undefined>(undefined);
  const [step, setStep] = useState<WizardStep>('ico');
  const [icoInput, setIcoInput] = useState('');
  const [ico, setIco] = useState('');
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const [statusKey, setStatusKey] = useState<MessageKey | null>(null);
  const [searching, startSearch] = useTransition();
  const [vat, setVat] = useState('');
  const [regime, setRegime] = useState('');
  const [rate, setRate] = useState('');
  const [band, setBand] = useState('');
  const [manualFields, setManualFields] = useState<Record<ManualField, string>>({
    name: '',
    street: '',
    city: '',
    zip: '',
  });
  const [formState, formAction, pending] = useActionState(completeOnboarding, idle);

  // Focus the IČO field on arrival, and the new screen's question after every step change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the focus moves on every step change
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      icoRef.current?.focus();
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  useEffect(() => () => window.clearTimeout(advanceTimer.current), []);

  const prefill = lookup?.status === 'found' ? lookup.prefill : null;
  const manualMode = lookup?.status === 'unavailable';
  const steps = stepsFor(regime);
  const stepIndex = Math.max(steps.indexOf(step), 0);

  if (formState.status === 'done') return <DoneView address={formState.inboundAddress} />;

  const errorKey =
    formState.status === 'error' ? (`onboarding.error.${formState.code}` as MessageKey) : null;
  const message = errorKey ?? statusKey;

  const manualFilled = MANUAL_FIELDS.every((field) => manualFields[field.key].trim() !== '');
  const canSubmit =
    vat !== '' &&
    regime !== '' &&
    (regime !== 'pausalni_vydaje' || rate !== '') &&
    (regime !== 'pausalni_dan' || band !== '') &&
    (!manualMode || manualFilled);

  const hidden: Record<string, string> | null = prefill
    ? {
        ico: prefill.ico,
        name: prefill.name,
        dic: prefill.dic ?? '',
        street: streetLine(prefill),
        houseNumber: prefill.address.house_number ?? '',
        orientationNumber: prefill.address.orientation_number ?? '',
        city: prefill.address.city,
        zip: prefill.address.zip,
        fuCode: prefill.fuCode ?? '',
        validFrom: prefill.validFrom,
        slugBase: prefill.slugBase,
      }
    : manualMode
      ? {
          ico,
          dic: '',
          houseNumber: '',
          orientationNumber: '',
          fuCode: '',
          validFrom: `${new Date().getFullYear()}-01-01`,
          slugBase: '',
        }
      : null;

  // A radio group exists only on its own screen; every other answer is sent as a hidden input.
  const answers: Record<string, string> = { ...hidden };
  if (step !== 'vat' && vat) answers.vat = vat;
  if (step !== 'regime' && regime) answers.regime = regime;
  if (step !== 'detail' && regime === 'pausalni_vydaje' && rate) answers.pausalRate = rate;
  if (step !== 'detail' && regime === 'pausalni_dan' && band) answers.pausalDanBand = band;
  if (manualMode && step !== 'ico') Object.assign(answers, manualFields);

  function go(next: WizardStep) {
    window.clearTimeout(advanceTimer.current);
    setStep(next);
  }

  /** Move on after 250 ms, so the tick on the chosen card is seen. */
  function advanceLater(next: WizardStep) {
    window.clearTimeout(advanceTimer.current);
    advanceTimer.current = window.setTimeout(() => setStep(next), 250);
  }

  function back() {
    const index = steps.indexOf(step);
    const previous = steps[index - 1];
    if (index > 0 && previous) go(previous);
  }

  function reset() {
    setLookup(null);
    setIco('');
    setVat('');
    setRegime('');
    setRate('');
    setBand('');
    setStatusKey(null);
    go('ico');
  }

  function onFind(value: string) {
    if (!isValidIco(value)) {
      setLookup(null);
      setStatusKey('onboarding.ico.invalid');
      return;
    }
    setStatusKey(null);
    startSearch(async () => {
      let result: LookupResult;
      try {
        result = await lookupIco(value);
      } catch {
        result = { status: 'unavailable' };
      }
      setIco(value);
      setLookup(result);
      if (result.status === 'found') {
        setVat(result.prefill.vatGuess === 'neplatce' ? 'neplatce' : '');
        setStatusKey(null);
      } else if (result.status === 'not_found') {
        setStatusKey('onboarding.ico.not_found');
      } else if (result.status === 'unavailable') {
        setStatusKey('onboarding.ico.unavailable');
      } else {
        setStatusKey('onboarding.ico.invalid');
      }
    });
  }

  function onIcoChange(raw: string) {
    const normalized = normalizeIcoInput(raw);
    setIcoInput(normalized);
    if (normalized.length === 8) {
      onFind(normalized);
    } else {
      setLookup(null);
      setStatusKey(null);
    }
  }

  /** Enter on the IČO screen looks the IČO up or continues; it never posts the wizard. */
  function onIcoSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (searching) return;
    if (manualMode) {
      if (manualFilled) go('vat');
      return;
    }
    if (!prefill) onFind(icoInput);
  }

  function onVat(value: string) {
    setVat(value);
    // A VAT payer cannot use the flat-rate tax: clear it if it was chosen.
    if (value.startsWith('platce_') && regime === 'pausalni_dan') setRegime('');
    advanceLater('regime');
  }

  function onRegime(value: string) {
    setRegime(value);
    // The last answer stays on screen with "Finish"; the rate or band comes next otherwise.
    if (!isLastStep('regime', value)) advanceLater('detail');
  }

  const question: Record<WizardStep, MessageKey> = {
    ico: 'onboarding.q.ico',
    vat: 'onboarding.vat.question',
    regime: 'onboarding.regime.question',
    detail: regime === 'pausalni_vydaje' ? 'onboarding.rate.question' : 'onboarding.band.question',
  };
  const why: Partial<Record<WizardStep, MessageKey>> = {
    ico: 'onboarding.why.ico',
    vat: 'onboarding.why.vat',
    regime: 'onboarding.why.regime',
  };
  const helpTip = {
    ico: <HelpTip term="help.term.ico" text="help.ico" />,
    vat: <HelpTip term="help.term.vat" text="help.vat" />,
    regime: <HelpTip term="help.term.expenses" text="help.expenses" />,
    detail:
      regime === 'pausalni_vydaje' ? (
        <HelpTip term="help.term.pausal_rate" text="help.pausal_rate" />
      ) : (
        <HelpTip term="help.term.pausal_dan" text="help.pausal_dan" />
      ),
  }[step];

  const finishVisible =
    step === 'detail' || (step === 'regime' && regime !== '' && isLastStep('regime', regime));

  let primary: ReactNode = null;
  if (step === 'ico' && manualMode) {
    primary = (
      <Button type="submit" disabled={!manualFilled}>
        {t('onboarding.next')}
      </Button>
    );
  } else if (step === 'vat' && vat !== '') {
    primary = (
      <Button type="button" onClick={() => go('regime')}>
        {t('onboarding.next')}
      </Button>
    );
  } else if (finishVisible) {
    primary = (
      <Button type="submit" disabled={!canSubmit || pending} aria-busy={pending}>
        {pending ? t('onboarding.saving') : t('onboarding.finish')}
      </Button>
    );
  }

  return (
    <form
      className="grid gap-8"
      {...(step === 'ico' ? { onSubmit: onIcoSubmit } : { action: formAction })}
    >
      {Object.entries(answers).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      <div className="grid gap-2">
        <ol aria-hidden="true" className="flex gap-1">
          {steps.map((item, index) => (
            <li
              key={item}
              className={cn(
                'h-1.5 flex-1 rounded-full',
                index < stepIndex ? 'bg-success' : index === stepIndex ? 'bg-primary' : 'bg-border',
              )}
            />
          ))}
        </ol>
        <p className="text-meta text-muted-foreground">
          {t('onboarding.step.count', { n: String(stepIndex + 1), total: String(steps.length) })}
        </p>
      </div>

      <div className="grid gap-3">
        <div className="flex items-start gap-2">
          <h2 ref={headingRef} tabIndex={-1} className="text-title focus:outline-none">
            {t(question[step])}
          </h2>
          {helpTip}
        </div>
        {why[step] && <p className="text-body">{t(why[step] as MessageKey)}</p>}
      </div>

      {step === 'ico' && (
        <div className="grid gap-6">
          <div className="grid gap-3">
            <label htmlFor={`${uid}-ico`} className="text-body font-medium">
              {t('onboarding.ico.label')}
            </label>
            <div className="flex gap-2">
              <Input
                ref={icoRef}
                id={`${uid}-ico`}
                inputMode="numeric"
                autoComplete="off"
                maxLength={10}
                value={icoInput}
                onChange={(event) => onIcoChange(event.target.value)}
                className="min-w-0 flex-1"
              />
              <Button type="submit" variant="secondary" disabled={searching} aria-busy={searching}>
                {searching ? t('onboarding.ico.searching') : t('onboarding.ico.find')}
              </Button>
            </div>
          </div>

          {prefill && (
            <Card className="grid gap-3 p-4">
              <p className="text-body font-medium">{t('onboarding.found.question')}</p>
              <div className="grid gap-1">
                <p className="text-card-title">{prefill.name}</p>
                <p className="text-body">{prefill.addressText}</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" onClick={() => go('vat')}>
                  {t('onboarding.found.yes')}
                </Button>
                <Button type="button" variant="link" onClick={reset}>
                  {t('onboarding.found.not_me')}
                </Button>
              </div>
            </Card>
          )}

          {manualMode &&
            MANUAL_FIELDS.map((field) => (
              <div key={field.key} className="grid gap-2">
                <label htmlFor={`${uid}-${field.key}`} className="text-body font-medium">
                  {t(field.label)}
                </label>
                <Input
                  id={`${uid}-${field.key}`}
                  name={field.key}
                  autoComplete={field.autoComplete}
                  required
                  value={manualFields[field.key]}
                  onChange={(event) =>
                    setManualFields((current) => ({
                      ...current,
                      [field.key]: event.target.value,
                    }))
                  }
                />
              </div>
            ))}
        </div>
      )}

      {step === 'vat' && (
        <div className="grid gap-4">
          {prefill?.vatGuess === 'platce' && (
            <p className="text-body">{t('onboarding.vat.from_registry_payer')}</p>
          )}
          <ChipQuestion
            name="vat"
            layout="cards"
            hideLegend
            legend={t('onboarding.vat.question')}
            options={VAT_ANSWERS.map((answer) => ({
              value: answer,
              label: t(VAT_LABELS[answer]),
            }))}
            value={vat}
            onChange={onVat}
          />
          <div>
            <HelpTip term="help.term.identifikovana_osoba" text="help.identifikovana_osoba" />
          </div>
        </div>
      )}

      {step === 'regime' && (
        <ChipQuestion
          name="regime"
          layout="cards"
          hideLegend
          legend={t('onboarding.regime.question')}
          options={regimeOptions(vat).map((answer) => ({
            value: answer,
            label: t(REGIME_LABELS[answer as Regime]),
          }))}
          value={regime}
          onChange={onRegime}
        />
      )}

      {step === 'detail' && regime === 'pausalni_vydaje' && (
        <ChipQuestion
          name="pausalRate"
          layout="cards"
          hideLegend
          legend={t('onboarding.rate.question')}
          options={RATES.map((rateValue) => ({
            value: rateValue,
            label: t('onboarding.rate.option', { rate: rateValue }),
          }))}
          value={rate}
          onChange={setRate}
        />
      )}

      {step === 'detail' && regime === 'pausalni_dan' && (
        <ChipQuestion
          name="pausalDanBand"
          layout="cards"
          hideLegend
          legend={t('onboarding.band.question')}
          options={BANDS.map((bandValue) => ({
            value: bandValue,
            label: t('onboarding.band.option', { band: bandValue }),
          }))}
          value={band}
          onChange={setBand}
        />
      )}

      <p role="status" aria-live="polite" className="min-h-6 text-body">
        {message && <span className="text-destructive">{t(message)}</span>}
      </p>

      <div className="flex items-center justify-between gap-3">
        {stepIndex > 0 ? (
          <Button type="button" variant="ghost" onClick={back}>
            {t('onboarding.back')}
          </Button>
        ) : (
          <span />
        )}
        {primary}
      </div>
    </form>
  );
}
