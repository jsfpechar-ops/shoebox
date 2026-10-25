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
