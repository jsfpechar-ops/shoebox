// Hosting helpers for the prototype page (decisions 2026-10-18 [proto], Render). HTTP Basic auth:
// any user name, the password must equal PROTO_PASSWORD; without a password the page is open
// (local use). Hashing both sides first makes the comparison constant-time and length-blind.
import { createHash, timingSafeEqual } from 'node:crypto';

/** Title of the browser's password prompt. */
export const AUTH_REALM = 'Shoebox prototyp';

const digest = (text: string): Buffer => createHash('sha256').update(text, 'utf8').digest();

/** True when no password is configured or the `Authorization: Basic …` header carries it. */
export function isAuthorized(header: string | undefined, password: string | undefined): boolean {
  if (password === undefined || password === '') return true;
  if (header === undefined || !header.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon < 0) return false;
  return timingSafeEqual(digest(decoded.slice(colon + 1)), digest(password));
}

/** Render (and Cloud Run) set PORT and need 0.0.0.0; locally the default port on 127.0.0.1. */
export function listenAddress(
  env: Readonly<Record<string, string | undefined>>,
  defaultPort: number,
): { port: number; host: string } {
  const raw = env.PORT;
  if (raw === undefined || raw === '') return { port: defaultPort, host: '127.0.0.1' };
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`PORT must be a TCP port, got "${raw}"`);
  }
  return { port, host: '0.0.0.0' };
}
