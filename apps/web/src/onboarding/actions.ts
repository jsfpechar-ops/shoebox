'use server';

import { createAresClient, isValidIco } from '@shoebox/registries';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '../supabase/server';
import { type OnboardingPrefill, prefillFromAres } from './prefill';
import { parseOnboardingForm, toCreateFirmInput } from './schema';

export type LookupResult =
  | { status: 'found'; prefill: OnboardingPrefill }
  | { status: 'invalid' }
  | { status: 'not_found' }
  | { status: 'unavailable' };

export type OnboardingState =
  | { status: 'idle' }
  | {
      status: 'error';
      code: 'invalid' | 'pausal_rate_required' | 'band_required' | 'pausal_dan_payer' | 'unknown';
    }
  | { status: 'done'; inboundAddress: string };

const REFINE_CODES = ['pausal_rate_required', 'band_required', 'pausal_dan_payer'] as const;

/** Prague calendar date (YYYY-MM-DD). */
function todayInPrague(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague' }).format(new Date());
}

/** ARES lookup for the onboarding form. Logs nothing. */
export async function lookupIco(ico: string): Promise<LookupResult> {
  const normalized = ico.replace(/\s+/g, '');
  if (!isValidIco(normalized)) return { status: 'invalid' };

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/prihlaseni');

  const aresBaseUrl = process.env.SHOEBOX_ARES_BASE_URL;
  const result = await createAresClient(aresBaseUrl ? { baseUrl: aresBaseUrl } : {}).subject(
    normalized,
  );

  if (result.status === 'ok') {
    return { status: 'found', prefill: prefillFromAres(result.data, todayInPrague()) };
  }
  if (result.status === 'not_found') return { status: 'not_found' };
  return { status: 'unavailable' };
}

/** Validates the three answers and creates the firm through `public.create_firm` (0061). Logs nothing. */
export async function completeOnboarding(
  _previous: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const parsed = parseOnboardingForm(formData);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message;
    const code = (REFINE_CODES as readonly string[]).includes(first ?? '')
      ? (first as (typeof REFINE_CODES)[number])
      : 'invalid';
    return { status: 'error', code };
  }

  let rpcData: unknown = null;
  let rpcError: string | null = null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc('create_firm', {
      p: toCreateFirmInput(parsed.data),
    });
    rpcData = data;
    if (error) rpcError = error.message ?? 'unknown';
  } catch {
    return { status: 'error', code: 'unknown' };
  }

  // Outside the try: redirect() throws, and the catch above must not swallow it.
  if (rpcError !== null) {
    if (rpcError.includes('already_has_firm')) redirect('/inbox');
    return { status: 'error', code: 'unknown' };
  }

  const row = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as {
    inbound_email_slug?: unknown;
    inbound_email_secret?: unknown;
  } | null;
  if (typeof row?.inbound_email_slug !== 'string' || typeof row.inbound_email_secret !== 'string') {
    return { status: 'error', code: 'unknown' };
  }
  // TODO(decision-inbound-domain): default domain until the owner picks one.
  const domain = process.env.SHOEBOX_INBOUND_DOMAIN || 'in.shoebox.cz';
  return {
    status: 'done',
    inboundAddress: `${row.inbound_email_slug}-${row.inbound_email_secret.toLowerCase()}@${domain}`,
  };
}
