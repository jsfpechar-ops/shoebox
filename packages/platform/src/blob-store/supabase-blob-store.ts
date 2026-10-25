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
        body: body as Uint8Array<ArrayBuffer>,
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
