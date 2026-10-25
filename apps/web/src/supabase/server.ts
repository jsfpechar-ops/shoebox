import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { AUTH_COOKIE_OPTIONS } from '../auth/session';
import { supabaseEnv } from './env';

export { appOrigin, supabaseEnv } from './env';

/**
 * Supabase client for server actions, route handlers and server components (ADR-012, @supabase/ssr).
 * Session cookies are HttpOnly + Secure + Lax (AUTH_COOKIE_OPTIONS overrides the library default
 * `httpOnly: false`; no browser client exists, so nothing needs to read them from JavaScript).
 */
export async function createSupabaseServerClient() {
  const { url, anonKey } = supabaseEnv();
  const store = await cookies();
  return createServerClient(url, anonKey, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Server Components cannot write cookies; the middleware refreshes the session instead.
        }
      },
    },
  });
}
