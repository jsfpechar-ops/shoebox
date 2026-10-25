# 0037b: BlobStore interface, path helpers and the Supabase Storage implementation

Status: review
Ticket: P0-DB-10 (part b of a/b) | Depends on: 0037a (same branch) | Base commit: head of task/0037-storage after 0037a | Branch: task/0037-storage | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

`packages/platform/src/blob-store/` exports the `BlobStore` interface (`put`, `get`, `presignPut`, `signedUrl`, `delete`) that hides Supabase, the ADR-004 path helpers (`filePath(org, sha256)` → `org/{org}/files/{sha256}`, `emlPath`, `blobPath`, `orgPrefix`, `orgIdOfPath`, the TypeScript twin of 0037a's `app.storage_org_id()`), the constants `BLOB_BUCKET = 'org-files'` and `SIGNED_URL_TTL_SECONDS = 300`, and `createSupabaseBlobStore()` over the Supabase Storage HTTP API with plain `fetch` (no SDK, no new dependency). `test/blob-store.test.ts` pins the ticket's acceptance (path helper, 300 s TTL) plus path validation and the HTTP shape of every call with a fake `fetch`.

## 2. Context

Rules (AGENTS.md, rules.md Privacy), pasted:

- Hard rule 4 / rules.md Privacy: "Logs and Sentry get ids and error codes, never document content"; this module logs nothing and its error messages carry the operation and HTTP status only (the test asserts the sha is absent). EU regions only: the store talks to the project URL it is given (the EU Supabase project). Test data is placeholders (`example.supabase.co`, `anon-key-placeholder`, `'a' × 64`).
- Hard rule 7: no new dependency. `@supabase/supabase-js` is approved for `apps/web` (decisions 2026-10-18 [deps]) but not added to `packages/platform`: the storage API is five HTTP calls, so the store uses `globalThis.fetch` (Node 22) with an injectable `fetch` for tests. `packages/platform/package.json` is not touched.
- ADR-004 (03): "Code talks to a `BlobStore` interface (S3 API), so moving to Cloudflare R2 later … is a config change. Layout: `org/{org_id}/files/{sha256}` (content-addressed, dedup within tenant), `org/{org_id}/eml/{message_id}.eml`, `org/{org_id}/exports/…`, `org/{org_id}/filings/…`." M12 §4.5 V4.2: "signed storage URLs expire in 5 min" → `SIGNED_URL_TTL_SECONDS = 300`, the default of `signedUrl()`. M12 §4.5 item 169: "files go via presigned PUT" → `presignPut()`. M12 §4.6 export: "a link to a signed URL valid 7 days" → `SIGNED_URL_MAX_TTL_SECONDS = 604_800`, the most a caller may pass; anything else is `invalid_ttl`.
- Supabase Storage HTTP API (storage-api, what `@supabase/storage-js` calls; base `{project url}/storage/v1`): upload `POST /object/{bucket}/{path}` with the bytes, `content-type` and `x-upsert: false` (content-addressed paths never change); download `GET /object/{bucket}/{path}`; signed download URL `POST /object/sign/{bucket}/{path}` with `{"expiresIn": seconds}` → `{"signedURL": "/object/sign/…?token=…"}`, made absolute by prefixing the base; signed upload URL `POST /object/upload/sign/{bucket}/{path}` → `{"url": "/object/upload/sign/…?token=…", "token": "…"}` (the browser then `PUT`s to that URL with `Authorization: Bearer {token}`; the storage API fixes the token's validity, this module does not); remove `DELETE /object/{bucket}` with `{"prefixes": [paths]}`. Headers on every call: `apikey` (the project key) and `authorization: Bearer …`.
- **Default (confirm at gate):** who the bearer is. `createSupabaseBlobStore({ url, apiKey, accessToken? })`: with a user's `accessToken` the storage RLS of 0037a applies to every call (a route handler acting for the signed-in user); without it the `apiKey` is the bearer, which is the service role key for server code and the worker (after their own org check, as M12 §4.4 says server actions do). One factory, no second class.
- **Default (confirm at gate):** path validation lives in the store, not only in the helpers: every method calls `assertBlobPath()` before any request, so a caller cannot reach outside `org/{lowercase uuid}/{files|eml|exports|filings}/…`. Segments allow `A-Za-z0-9._-` (1–255 chars), never `.` or `..`; a `files` path is exactly one lowercase 64-hex sha. `orgIdOfPath()` is the same rule as `app.storage_org_id()` plus the kind and segment checks (the SQL side only needs the prefix).
- `BlobStoreError` codes: `invalid_path`, `invalid_ttl` (before any request), `not_found` (404), `forbidden` (401, 403), `upstream` (any other status, a network error, or a malformed sign response). `delete([])` makes no request; missing objects are not an error (the storage API answers 200 with an empty list).
- `tsconfig.base.json` has `lib: ["ES2023"]` and `types: ["node"]`: `fetch`, `Response`, `RequestInit` are the Node globals; `BodyInit` is not a name there (the brief writer hit that), so the body type is `RequestInit['body']`.
- The exports go through `packages/platform/src/index.ts` (`export * from './blob-store/index'`); `pnpm depcruise` stays clean (no import outside the package).

Anchors (`task/0037-storage` after 0037a):

`packages/platform/src/index.ts` (step 2), the 4-line file:

```ts
export const packageName = '@shoebox/platform' as const;
export * from './logger/index';
export * from './webhooks/index';
```

All code below was run by the brief writer on `origin/phase/0` plus PR #66 merged: `tsc` clean for platform, `biome ci` clean, `pnpm --filter @shoebox/platform test` 38 passed (4 files; this file 9), `pnpm depcruise` clean, `check:tenant-sql` OK, `pii_guard` OK.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/platform/src/blob-store/blob-store.ts` | create | interface, paths, constants, error |
| `packages/platform/src/blob-store/supabase-blob-store.ts` | create | fetch implementation |
| `packages/platform/src/blob-store/index.ts` | create | barrel |
| `packages/platform/src/index.ts` | edit | one export line |
| `packages/platform/test/blob-store.test.ts` | create | 9 tests |

No other file may change.

## 4. Steps

Line map (read only the range of the step you are on):
- Step 1 code: lines 63–196
- Step 2 code: lines 206–342 (store) and 348–366 (barrel)
- Step 3 code: lines 376–568

Setup: you are on `task/0037-storage` after 0037a's commits (`git log --oneline -1` shows `0037a step 5`; if not, STOP). `pnpm install` is done.

Rules for every step: write each new file with **one Write call**, contents exactly as given (they are Biome-formatted; do not reformat). Do not re-read a file you just wrote. Do not explore other files. After the step's command shows the expected result, commit: `git add -A && git commit -qm "0037b step k" && git log --oneline -1`. All commands run from the repo root.

### Step 1: create `packages/platform/src/blob-store/blob-store.ts`

```ts
/**
 * BlobStore (ADR-004): the one interface app code uses for object storage. The layout is
 * `org/{org_id}/files/{sha256}` (content-addressed, dedup within the tenant), `org/{org_id}/eml/…`,
 * `org/{org_id}/exports/…`, `org/{org_id}/filings/…`; storage RLS (migration 0008) reads the org
 * id out of that prefix. Paths are validated here so no caller can write outside `org/{uuid}/`.
 * Signed URLs expire after 300 s by default (M12 §4.5 V4.2). Error messages never carry a path.
 */

/** The one bucket (ADR-004, migration 0008). */
export const BLOB_BUCKET = 'org-files' as const;
/** Default validity of a download URL (M12 §4.5 V4.2: signed storage URLs expire in 5 min). */
export const SIGNED_URL_TTL_SECONDS = 300 as const;
/** Longest validity a caller may ask for: the export download link of M12 §4.6 (7 days). */
export const SIGNED_URL_MAX_TTL_SECONDS = 604_800 as const;

export type BlobKind = 'files' | 'eml' | 'exports' | 'filings';

export const BLOB_KINDS: readonly BlobKind[] = ['files', 'eml', 'exports', 'filings'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
/** One path segment after the kind: letters, digits, `.`, `_`, `-`; never empty, `.` or `..`. */
const SEGMENT_RE = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,255}$/;

export type BlobStoreErrorCode =
  | 'invalid_path'
  | 'invalid_ttl'
  | 'not_found'
  | 'forbidden'
  | 'upstream';

/** Thrown by every BlobStore method; `message` names the operation and status, never the object. */
export class BlobStoreError extends Error {
  readonly code: BlobStoreErrorCode;
  readonly status: number;

  constructor(op: string, code: BlobStoreErrorCode, status = 0) {
    super(`blob-store: ${op} failed (${code}${status > 0 ? ` ${status}` : ''})`);
    this.name = 'BlobStoreError';
    this.code = code;
    this.status = status;
  }
}

function assertOrgId(orgId: string): void {
  if (!UUID_RE.test(orgId)) {
    throw new BlobStoreError('path', 'invalid_path');
  }
}

/** `org/{org_id}/` — the prefix storage RLS keys on. */
export function orgPrefix(orgId: string): string {
  assertOrgId(orgId);
  return `org/${orgId}/`;
}

/** `org/{org_id}/files/{sha256}`: content-addressed source files (ADR-004, 05 `source_files`). */
export function filePath(orgId: string, sha256: string): string {
  assertOrgId(orgId);
  if (!SHA256_RE.test(sha256)) {
    throw new BlobStoreError('path', 'invalid_path');
  }
  return `org/${orgId}/files/${sha256}`;
}

/** `org/{org_id}/eml/{message_id}.eml`: raw inbound mail, deleted after 90 days (ADR-004). */
export function emlPath(orgId: string, messageId: string): string {
  return blobPath(orgId, 'eml', `${messageId}.eml`);
}

/** `org/{org_id}/{kind}/{segments…}` with every segment validated. */
export function blobPath(orgId: string, kind: BlobKind, ...segments: readonly string[]): string {
  assertOrgId(orgId);
  if (!BLOB_KINDS.includes(kind) || segments.length === 0) {
    throw new BlobStoreError('path', 'invalid_path');
  }
  for (const segment of segments) {
    if (!SEGMENT_RE.test(segment)) {
      throw new BlobStoreError('path', 'invalid_path');
    }
  }
  return `org/${orgId}/${kind}/${segments.join('/')}`;
}

/** The org id of a valid path, or null (the TypeScript twin of `app.storage_org_id()`). */
export function orgIdOfPath(path: string): string | null {
  const parts = path.split('/');
  const [root, orgId, kind, ...segments] = parts;
  if (root !== 'org' || orgId === undefined || !UUID_RE.test(orgId)) {
    return null;
  }
  if (kind === undefined || !BLOB_KINDS.includes(kind as BlobKind) || segments.length === 0) {
    return null;
  }
  if (kind === 'files') {
    return segments.length === 1 && segments[0] !== undefined && SHA256_RE.test(segments[0])
      ? orgId
      : null;
  }
  return segments.every((s) => SEGMENT_RE.test(s)) ? orgId : null;
}

/** Throws `invalid_path` unless `path` is one this module would build. */
export function assertBlobPath(path: string): void {
  if (orgIdOfPath(path) === null) {
    throw new BlobStoreError('path', 'invalid_path');
  }
}

/** Throws `invalid_ttl` unless 1 ≤ ttl ≤ SIGNED_URL_MAX_TTL_SECONDS and ttl is an integer. */
export function assertTtl(ttlSeconds: number): void {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > SIGNED_URL_MAX_TTL_SECONDS) {
    throw new BlobStoreError('signedUrl', 'invalid_ttl');
  }
}

/** What a browser needs to PUT one object without a session: the URL and its one-time token. */
export interface PresignedPut {
  url: string;
  token: string;
}

export interface BlobStore {
  /** Writes `body` at `path` (no overwrite: content-addressed paths never change). */
  put(path: string, body: Uint8Array, contentType: string): Promise<void>;
  /** Reads the object; `not_found` when it does not exist. */
  get(path: string): Promise<Uint8Array>;
  /** A one-time upload URL for the browser (M12 §4.5: files go via presigned PUT). */
  presignPut(path: string): Promise<PresignedPut>;
  /** A download URL valid `ttlSeconds` (default 300, at most 7 days). */
  signedUrl(path: string, ttlSeconds?: number): Promise<string>;
  /** Removes the objects; missing ones are not an error. */
  delete(paths: readonly string[]): Promise<void>;
}
```

Command: `pnpm exec biome ci packages/platform/src/blob-store 2>&1 | tail -3` → no errors. Commit.

### Step 2: create `packages/platform/src/blob-store/supabase-blob-store.ts` and `index.ts`, edit `src/index.ts`

(a) `supabase-blob-store.ts`:

```ts
import {
  assertBlobPath,
  assertTtl,
  BLOB_BUCKET,
  type BlobStore,
  BlobStoreError,
  type BlobStoreErrorCode,
  type PresignedPut,
  SIGNED_URL_TTL_SECONDS,
} from './blob-store';

/**
 * BlobStore over the Supabase Storage HTTP API (ADR-004), with plain `fetch`: no SDK. The bearer
 * is either a user's access token (storage RLS of migration 0008 then applies to every call) or
 * the service role key (server code and the worker, after their own org check). Nothing here logs;
 * errors carry the operation and the HTTP status only.
 */
export interface SupabaseBlobStoreOptions {
  /** Project URL, e.g. `https://xyz.supabase.co` (EU project), without a trailing slash. */
  url: string;
  /** The anon key when `accessToken` is given, else the service role key. Sent as `apikey`. */
  apiKey: string;
  /** A signed-in user's access token: the bearer, so storage RLS applies. */
  accessToken?: string;
  /** Default `org-files`. */
  bucket?: string;
  /** Default `globalThis.fetch`; tests inject one. */
  fetch?: typeof fetch;
}

interface SignResponse {
  signedURL?: string;
}

interface SignUploadResponse {
  url?: string;
  token?: string;
}

function codeOf(status: number): BlobStoreErrorCode {
  if (status === 404) {
    return 'not_found';
  }
  if (status === 401 || status === 403) {
    return 'forbidden';
  }
  return 'upstream';
}

export function createSupabaseBlobStore(options: SupabaseBlobStoreOptions): BlobStore {
  const base = `${options.url.replace(/\/+$/, '')}/storage/v1`;
  const bucket = options.bucket ?? BLOB_BUCKET;
  const doFetch = options.fetch ?? globalThis.fetch;
  const bearer = options.accessToken ?? options.apiKey;
  const authHeaders: Record<string, string> = {
    apikey: options.apiKey,
    authorization: `Bearer ${bearer}`,
  };

  async function call(
    op: string,
    method: string,
    pathname: string,
    init: { body?: RequestInit['body']; headers?: Record<string, string> } = {},
  ): Promise<Response> {
    let response: Response;
    try {
      response = await doFetch(`${base}${pathname}`, {
        method,
        headers: { ...authHeaders, ...init.headers },
        ...(init.body === undefined ? {} : { body: init.body }),
      });
    } catch {
      throw new BlobStoreError(op, 'upstream');
    }
    if (!response.ok) {
      throw new BlobStoreError(op, codeOf(response.status), response.status);
    }
    return response;
  }

  return {
    async put(path, body, contentType) {
      assertBlobPath(path);
      await call('put', 'POST', `/object/${bucket}/${path}`, {
        body,
        headers: { 'content-type': contentType, 'x-upsert': 'false' },
      });
    },

    async get(path) {
      assertBlobPath(path);
      const response = await call('get', 'GET', `/object/${bucket}/${path}`);
      return new Uint8Array(await response.arrayBuffer());
    },

    async presignPut(path): Promise<PresignedPut> {
      assertBlobPath(path);
      const response = await call('presignPut', 'POST', `/object/upload/sign/${bucket}/${path}`, {
        body: '{}',
        headers: { 'content-type': 'application/json' },
      });
      const data = (await response.json()) as SignUploadResponse;
      if (typeof data.url !== 'string' || typeof data.token !== 'string') {
        throw new BlobStoreError('presignPut', 'upstream', response.status);
      }
      return { url: `${base}${data.url}`, token: data.token };
    },

    async signedUrl(path, ttlSeconds = SIGNED_URL_TTL_SECONDS) {
      assertBlobPath(path);
      assertTtl(ttlSeconds);
      const response = await call('signedUrl', 'POST', `/object/sign/${bucket}/${path}`, {
        body: JSON.stringify({ expiresIn: ttlSeconds }),
        headers: { 'content-type': 'application/json' },
      });
      const data = (await response.json()) as SignResponse;
      if (typeof data.signedURL !== 'string') {
        throw new BlobStoreError('signedUrl', 'upstream', response.status);
      }
      return `${base}${data.signedURL}`;
    },

    async delete(paths) {
      for (const path of paths) {
        assertBlobPath(path);
      }
      if (paths.length === 0) {
        return;
      }
      await call('delete', 'DELETE', `/object/${bucket}`, {
        body: JSON.stringify({ prefixes: paths }),
        headers: { 'content-type': 'application/json' },
      });
    },
  };
}
```

(b) `packages/platform/src/blob-store/index.ts`:

```ts
export {
  assertBlobPath,
  assertTtl,
  BLOB_BUCKET,
  BLOB_KINDS,
  type BlobKind,
  type BlobStore,
  BlobStoreError,
  type BlobStoreErrorCode,
  blobPath,
  emlPath,
  filePath,
  orgIdOfPath,
  orgPrefix,
  type PresignedPut,
  SIGNED_URL_MAX_TTL_SECONDS,
  SIGNED_URL_TTL_SECONDS,
} from './blob-store';
export { createSupabaseBlobStore, type SupabaseBlobStoreOptions } from './supabase-blob-store';
```

(c) `packages/platform/src/index.ts`: insert the line `export * from './blob-store/index';` before `export * from './logger/index';` (the file is then 4 lines; the exports stay in alphabetical order).

Command: `pnpm --filter @shoebox/platform typecheck 2>&1 | tail -3` → no errors; `pnpm exec biome ci packages/platform 2>&1 | tail -3` → no errors. Commit.

### Step 3: create `packages/platform/test/blob-store.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import {
  BLOB_BUCKET,
  BlobStoreError,
  blobPath,
  createSupabaseBlobStore,
  emlPath,
  filePath,
  orgIdOfPath,
  orgPrefix,
  SIGNED_URL_TTL_SECONDS,
} from '../src/index';

// P0-DB-10 acceptance: the content-addressed path helper `org/{org}/files/{sha256}` and a signed
// URL TTL of 300 s; plus the path validation storage RLS (0008) relies on and the HTTP shape of
// each BlobStore call against the Supabase Storage API (fake fetch, no network). Placeholder ids.
const ORG = 'aaaaaaaa-0000-4000-8000-00000000000a';
const OTHER = 'bbbbbbbb-0000-4000-8000-00000000000b';
const SHA = 'a'.repeat(64);
const PATH = `org/${ORG}/files/${SHA}`;
const URL_BASE = 'https://example.supabase.co';
const API_KEY = 'anon-key-placeholder';
const TOKEN = 'user-access-token-placeholder';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

/** A fetch that records every call and answers with `status` and `payload`. */
function fakeFetch(status: number, payload: unknown = {}): { calls: Call[]; fetch: typeof fetch } {
  const calls: Call[] = [];
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = init?.body;
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: { ...(init?.headers as Record<string, string>) },
      body: typeof body === 'string' ? body : body === undefined ? undefined : '<bytes>',
    });
    const text = payload instanceof Uint8Array ? payload : JSON.stringify(payload);
    return new Response(text, { status });
  };
  return { calls, fetch: impl as typeof fetch };
}

function store(status: number, payload?: unknown, accessToken?: string) {
  const f = fakeFetch(status, payload);
  const s = createSupabaseBlobStore({
    url: URL_BASE,
    apiKey: API_KEY,
    fetch: f.fetch,
    ...(accessToken === undefined ? {} : { accessToken }),
  });
  return { s, calls: f.calls };
}

async function codeOf(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof BlobStoreError ? e.code : 'other';
  }
}

describe('blob paths (ADR-004 layout)', () => {
  it('filePath builds org/{org}/files/{sha256}', () => {
    expect(filePath(ORG, SHA)).toBe(PATH);
    expect(orgPrefix(ORG)).toBe(`org/${ORG}/`);
    expect(emlPath(ORG, 'msg-1')).toBe(`org/${ORG}/eml/msg-1.eml`);
    expect(blobPath(ORG, 'exports', '2026', 'export.zip')).toBe(
      `org/${ORG}/exports/2026/export.zip`,
    );
  });

  it('rejects anything that is not a lowercase uuid org and a lowercase 64-hex sha', () => {
    const bad = [
      () => filePath(ORG.toUpperCase(), SHA),
      () => filePath('not-a-uuid', SHA),
      () => filePath(ORG, SHA.toUpperCase()),
      () => filePath(ORG, SHA.slice(1)),
      () => filePath(ORG, `${SHA}/x`),
      () => emlPath(ORG, '../x'),
      () => emlPath(ORG, 'a/b'),
      () => blobPath(ORG, 'exports', '..'),
      () => blobPath(ORG, 'exports'),
    ];
    for (const fn of bad) {
      expect(fn).toThrow(BlobStoreError);
    }
  });

  it('orgIdOfPath mirrors app.storage_org_id(): the org of a valid path, else null', () => {
    expect(orgIdOfPath(PATH)).toBe(ORG);
    expect(orgIdOfPath(`org/${OTHER}/eml/m.eml`)).toBe(OTHER);
    expect(orgIdOfPath(`files/${SHA}`)).toBeNull();
    expect(orgIdOfPath(`org/not-a-uuid/files/${SHA}`)).toBeNull();
    expect(orgIdOfPath(`org/${ORG}/other/${SHA}`)).toBeNull();
    expect(orgIdOfPath(`org/${ORG}/files/${SHA}/extra`)).toBeNull();
    expect(orgIdOfPath(`org/${ORG}/exports/../${SHA}`)).toBeNull();
  });
});

describe('createSupabaseBlobStore (fake fetch)', () => {
  it('signedUrl asks for 300 s by default and returns the storage origin URL', async () => {
    const { s, calls } = store(200, { signedURL: `/object/sign/${BLOB_BUCKET}/${PATH}?token=t1` });
    const url = await s.signedUrl(PATH);
    expect(SIGNED_URL_TTL_SECONDS).toBe(300);
    expect(url).toBe(`${URL_BASE}/storage/v1/object/sign/${BLOB_BUCKET}/${PATH}?token=t1`);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe(`${URL_BASE}/storage/v1/object/sign/${BLOB_BUCKET}/${PATH}`);
    expect(JSON.parse(calls[0]?.body ?? '')).toEqual({ expiresIn: 300 });
    expect(calls[0]?.headers.apikey).toBe(API_KEY);
    expect(calls[0]?.headers.authorization).toBe(`Bearer ${API_KEY}`);
  });

  it('signedUrl accepts an explicit TTL up to 7 days and rejects the rest', async () => {
    const { s, calls } = store(200, { signedURL: '/x' });
    await s.signedUrl(PATH, 604_800);
    expect(JSON.parse(calls[0]?.body ?? '')).toEqual({ expiresIn: 604_800 });
    expect(await codeOf(s.signedUrl(PATH, 604_801))).toBe('invalid_ttl');
    expect(await codeOf(s.signedUrl(PATH, 0))).toBe('invalid_ttl');
    expect(await codeOf(s.signedUrl(PATH, 1.5))).toBe('invalid_ttl');
    expect(calls).toHaveLength(1);
  });

  it('a user access token is the bearer (storage RLS applies), the apikey header stays', async () => {
    const { s, calls } = store(200, { signedURL: '/x' }, TOKEN);
    await s.signedUrl(PATH);
    expect(calls[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(calls[0]?.headers.apikey).toBe(API_KEY);
  });

  it('put POSTs the bytes without upsert; get returns them; presignPut returns url and token', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const put = store(200, {});
    await put.s.put(PATH, bytes, 'application/pdf');
    expect(put.calls[0]?.method).toBe('POST');
    expect(put.calls[0]?.url).toBe(`${URL_BASE}/storage/v1/object/${BLOB_BUCKET}/${PATH}`);
    expect(put.calls[0]?.headers['content-type']).toBe('application/pdf');
    expect(put.calls[0]?.headers['x-upsert']).toBe('false');
    expect(put.calls[0]?.body).toBe('<bytes>');

    const get = store(200, bytes);
    expect(Array.from(await get.s.get(PATH))).toEqual([1, 2, 3]);
    expect(get.calls[0]?.method).toBe('GET');

    const sign = store(200, {
      url: `/object/upload/sign/${BLOB_BUCKET}/${PATH}?token=u1`,
      token: 'u1',
    });
    expect(await sign.s.presignPut(PATH)).toEqual({
      url: `${URL_BASE}/storage/v1/object/upload/sign/${BLOB_BUCKET}/${PATH}?token=u1`,
      token: 'u1',
    });
    expect(sign.calls[0]?.method).toBe('POST');
  });

  it('delete sends the paths as prefixes in one DELETE and skips an empty list', async () => {
    const { s, calls } = store(200, []);
    await s.delete([]);
    expect(calls).toHaveLength(0);
    await s.delete([PATH, `org/${ORG}/eml/m.eml`]);
    expect(calls[0]?.method).toBe('DELETE');
    expect(calls[0]?.url).toBe(`${URL_BASE}/storage/v1/object/${BLOB_BUCKET}`);
    expect(JSON.parse(calls[0]?.body ?? '')).toEqual({ prefixes: [PATH, `org/${ORG}/eml/m.eml`] });
  });

  it('rejects an invalid path before any request; maps 404 and 403; messages name no object', async () => {
    const { s, calls } = store(200, {});
    expect(await codeOf(s.get(`files/${SHA}`))).toBe('invalid_path');
    expect(await codeOf(s.put(`org/${ORG}/files/..`, new Uint8Array(), 'text/plain'))).toBe(
      'invalid_path',
    );
    expect(await codeOf(s.delete([PATH, 'org/x']))).toBe('invalid_path');
    expect(calls).toHaveLength(0);
    expect(await codeOf(store(404).s.get(PATH))).toBe('not_found');
    expect(await codeOf(store(403).s.signedUrl(PATH))).toBe('forbidden');
    expect(await codeOf(store(500).s.put(PATH, new Uint8Array(), 'text/plain'))).toBe('upstream');
    expect(await codeOf(store(200, {}).s.signedUrl(PATH))).toBe('upstream');
    try {
      await store(404).s.get(PATH);
    } catch (e) {
      expect(e).toBeInstanceOf(BlobStoreError);
      expect((e as Error).message).toBe('blob-store: get failed (not_found 404)');
      expect((e as Error).message).not.toContain(SHA);
    }
  });
});
```

Command: `pnpm exec biome ci packages/platform 2>&1 | tail -3` → no errors; `pnpm --filter @shoebox/platform typecheck 2>&1 | tail -3` → no errors; `pnpm --filter @shoebox/platform test 2>&1 | tail -6` → `Test Files  4 passed (4)` and `Tests  38 passed (38)`. Commit.

### Step 4: repo guards

Command: `pnpm depcruise 2>&1 | tail -2` → `no dependency violations found`; `pnpm check:tenant-sql 2>&1 | tail -1` → `no Drizzle call on a tenant table outside withTenant()`; `python3 scripts/pii_guard.py --all packages/platform/src/blob-store/blob-store.ts packages/platform/src/blob-store/supabase-blob-store.ts packages/platform/test/blob-store.test.ts 2>&1 | tail -1` → `pii_guard: OK`; `python3 scripts/context_lint.py 2>&1 | tail -3` → `context lint: OK`. Nothing to commit. Write the report (§9), push the branch (`git push -u origin task/0037-storage 2>&1 | tail -3`) and open one PR for 0037a+b against `phase/0` titled `P0-DB-10: storage bucket, policies and BlobStore (0037a/b)` with the two reports linked.

## 5. Do not touch

`packages/platform/package.json` (no dependency), `packages/platform/src/logger/**`, `packages/platform/src/webhooks/**`, `packages/platform/test/logger.test.ts`, `smoke.test.ts`, `webhooks.test.ts`, `packages/db/**` (0037a is done), `apps/**` (no caller is wired here: that is P1-ING-01), `supabase/config.toml`, `.env*`, `scripts/**`, `.github/**`, `docs/v3/**`. Hard rules 4, 7, 8. Never put a real project URL or key anywhere; the tests use `example.supabase.co` and `*-placeholder`.

## 6. Commands

```
pnpm --filter @shoebox/platform test 2>&1 | tail -30                                        # 38 passed (4 files)
pnpm --filter @shoebox/platform exec vitest run test/blob-store.test.ts 2>&1 | tail -6     # 9 passed
pnpm --filter @shoebox/platform typecheck 2>&1 | tail -30                                   # exit 0
pnpm exec biome ci packages/platform 2>&1 | tail -30                                        # No fixes applied, no errors
pnpm depcruise 2>&1 | tail -3                                                               # no dependency violations found
pnpm check:tenant-sql 2>&1 | tail -3                                                        # no Drizzle call on a tenant table outside withTenant()
python3 scripts/pii_guard.py --all packages/platform/src/blob-store/*.ts packages/platform/test/blob-store.test.ts 2>&1 | tail -3   # pii_guard: OK
python3 scripts/context_lint.py 2>&1 | tail -30                                             # context lint: OK
```

## 7. Acceptance

- [ ] `packages/platform/test/blob-store.test.ts`: 9 passed; it pins `filePath(org, sha)` → `org/{org}/files/{sha256}` and `signedUrl()` sending `{"expiresIn": 300}` by default (`SIGNED_URL_TTL_SECONDS === 300`).
- [ ] `grep -c "assertBlobPath(path)" packages/platform/src/blob-store/supabase-blob-store.ts` → `5` (every method validates before any request); `grep -c "x-upsert" packages/platform/src/blob-store/supabase-blob-store.ts` → `1`.
- [ ] `grep -n "supabase" packages/platform/package.json` → no output (no SDK added); `git diff --stat origin/phase/0 -- packages/platform/package.json pnpm-lock.yaml` → empty.
- [ ] `grep -c "blob-store" packages/platform/src/index.ts` → `1`; `pnpm --filter @shoebox/platform typecheck` exit 0; `pnpm depcruise` clean.
- [ ] No test or source line contains a real Supabase host or key (`grep -rn "supabase.co" packages/platform` → only `example.supabase.co`).

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found;
- a test fails twice, or a test the brief wrote seems wrong;
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a new dependency seems needed;
- a file outside §3 needs a change;
- §5 would be touched;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy (hand that to the owner with the exact command).

## 9. Report

Write `docs/tasks/0037b-report.md` (600 tokens at most) and set `Status: review`. The report has:

1. The files changed (`git diff --stat origin/phase/0`).
2. Each command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations, and `[verify]` findings with their source.
5. Questions.
6. Owner steps left.

## Risk list (for the reviewer)

`blob-store.ts`: the three regexes (lowercase uuid, lowercase 64-hex sha, segment `A-Za-z0-9._-` without `.`/`..`), `orgIdOfPath()` agreeing with `app.storage_org_id()` on the prefix (both lowercase-only) and stricter after it, `SIGNED_URL_TTL_SECONDS = 300` as the default and `604_800` as the cap, error messages without the path. `supabase-blob-store.ts`: the five endpoints and verbs (`POST /object/{b}/{p}` with `x-upsert: false`, `GET /object/{b}/{p}`, `POST /object/sign/{b}/{p}` with `expiresIn`, `POST /object/upload/sign/{b}/{p}`, `DELETE /object/{b}` with `prefixes`), the `apikey` header on every call and the bearer choice (`accessToken ?? apiKey`), `assertBlobPath()` before every request, `delete([])` making no call, 404 → `not_found`, 401/403 → `forbidden`, the sign responses checked for a string before use. The endpoints follow `@supabase/storage-js` 2.x; the first real call against the EU project (P1-ING-01) is the integration check, this brief has none (no network in tests).

## Owner steps

None now. When P1-ING-01 wires the store: `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` already exist in `.env.example`; no new secret.
