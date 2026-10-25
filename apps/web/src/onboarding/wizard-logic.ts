import { TAX_REGIME_ANSWERS } from './schema';

/** One screen of the onboarding wizard. */
export type WizardStep = 'ico' | 'vat' | 'regime' | 'detail';

/** Czech chips show every regime except the flat-rate tax, which a VAT payer may not use. */
export function regimeOptions(vat: string | null): readonly string[] {
  return vat?.startsWith('platce_')
    ? TAX_REGIME_ANSWERS.filter((answer) => answer !== 'pausalni_dan')
    : TAX_REGIME_ANSWERS;
}

/** Digits only (spaces removed), at most 8. */
export function normalizeIcoInput(raw: string): string {
  return raw.replace(/\D+/g, '').slice(0, 8);
}

/** Steps the user will see, in order: detail only for pausalni_vydaje / pausalni_dan. */
export function stepsFor(regime: string): readonly WizardStep[] {
  return regime === 'pausalni_vydaje' || regime === 'pausalni_dan'
    ? ['ico', 'vat', 'regime', 'detail']
    : ['ico', 'vat', 'regime'];
}

/** True when this answer is the last one needed, so the screen shows "Finish" instead of moving on. */
export function isLastStep(step: WizardStep, regime: string): boolean {
  if (step === 'detail') return true;
  if (step === 'regime') return !stepsFor(regime).includes('detail');
  return false;
}
