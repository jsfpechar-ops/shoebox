import { t } from '@shoebox/i18n';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { supabaseMembershipCounter } from '../../src/onboarding/gate';
import { OnboardingWizard } from '../../src/onboarding/wizard';
import { createSupabaseServerClient } from '../../src/supabase/server';

export const metadata: Metadata = { title: t('onboarding.title') };

/** One firm per user: a user who already has a membership goes to the inbox. */
export default async function OnboardingPage() {
  const count = await supabaseMembershipCounter(
    await createSupabaseServerClient(),
  ).countMemberships();
  if ((count ?? 0) > 0) redirect('/inbox');

  return (
    <>
      <div className="grid gap-3">
        <h1 className="text-title">{t('onboarding.title')}</h1>
      </div>
      <div className="mt-8">
        <OnboardingWizard />
      </div>
    </>
  );
}
