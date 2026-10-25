/** Env readers shared by the Edge middleware and the Node server code. No Next or Node API. */

/** `SUPABASE_URL` + `SUPABASE_ANON_KEY` (M12 §4.13: public, build-time env). Throws early when missing. */
export function supabaseEnv(): { url: string; anonKey: string } {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set');
  return { url, anonKey };
}

/** `APP_URL`: the public origin used in e-mail links and redirects (never the Host header). */
export function appOrigin(): string {
  return new URL(process.env.APP_URL ?? 'http://localhost:3000').origin;
}
