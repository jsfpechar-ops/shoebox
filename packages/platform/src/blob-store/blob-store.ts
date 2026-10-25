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
