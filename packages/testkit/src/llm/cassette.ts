import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { LlmClient, LlmMode, LlmRequest, LlmResponse } from '@shoebox/extraction';

/** M12 §4.10 Runner step 3 and §8 edge case 11: replay fails loudly with this text. */
export const MISSING_CASSETTE_MESSAGE = 'missing cassette, run `pnpm eval --record`';

export class MissingCassetteError extends Error {
  readonly path: string;

  constructor(path: string) {
    super(`${MISSING_CASSETTE_MESSAGE} (${path})`);
    this.name = 'MissingCassetteError';
    this.path = path;
  }
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) out[key] = sortKeys(item);
    }
    return out;
  }
  return value;
}

/** JSON with object keys sorted at every depth; array order kept; undefined object values dropped. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

/** SHA-256 hex of the canonical request: independent of object key order. */
export function requestHash(request: LlmRequest): string {
  return createHash('sha256').update(canonicalJson(request)).digest('hex');
}

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._@-]*$/;

/** `{model}/{prompt_version}/{sha256(request)}.json`, relative to the cassette root. */
export function cassettePath(request: LlmRequest): string {
  for (const segment of [request.model, request.promptVersion]) {
    if (!SEGMENT.test(segment)) {
      throw new Error(`invalid cassette path segment: ${segment}`);
    }
  }
  return `${request.model}/${request.promptVersion}/${requestHash(request)}.json`;
}

/** What a cassette file holds. Never the request itself (hard rule 4): only its hash. */
export interface CassetteFile {
  version: 1;
  model: string;
  prompt_version: string;
  request_sha256: string;
  response: LlmResponse;
}

export interface CassetteStore {
  /** The file body, or null when the cassette does not exist. */
  read(path: string): Promise<string | null>;
  write(path: string, body: string): Promise<void>;
}

export interface MemoryCassetteStore extends CassetteStore {
  readonly files: Map<string, string>;
}

export function memoryCassetteStore(initial: Record<string, string> = {}): MemoryCassetteStore {
  const files = new Map<string, string>(Object.entries(initial));
  return {
    files,
    read: (path) => Promise.resolve(files.get(path) ?? null),
    write: (path, body) => {
      files.set(path, body);
      return Promise.resolve();
    },
  };
}

/** Cassettes on disk under `root`, e.g. `testdata/golden-v1/cassettes`. */
export function fsCassetteStore(root: string): CassetteStore {
  return {
    async read(path) {
      try {
        return await readFile(join(root, path), 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    async write(path, body) {
      const full = join(root, path);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, body, 'utf8');
    },
  };
}

function parseCassette(body: string, path: string): CassetteFile {
  const parsed: unknown = JSON.parse(body);
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    (parsed as { version?: unknown }).version !== 1 ||
    typeof (parsed as { response?: unknown }).response !== 'object'
  ) {
    throw new Error(`invalid cassette file: ${path}`);
  }
  return parsed as CassetteFile;
}

export interface CassetteClientOptions {
  mode: LlmMode;
  store: CassetteStore;
  /** The real client. Required for 'record' and 'live'; never called in 'replay'. */
  live?: LlmClient;
}

/** An `LlmClient` that replays, records or passes through, keyed by `cassettePath(request)`. */
export function createCassetteClient(options: CassetteClientOptions): LlmClient {
  const { mode, store, live } = options;
  if (mode !== 'replay' && live === undefined) {
    throw new Error(`cassette client in ${mode} mode needs a live LlmClient`);
  }
  return {
    async complete(request: LlmRequest): Promise<LlmResponse> {
      const path = cassettePath(request);
      if (mode === 'replay') {
        const body = await store.read(path);
        if (body === null) throw new MissingCassetteError(path);
        return parseCassette(body, path).response;
      }
      if (live === undefined) {
        throw new Error(`cassette client in ${mode} mode needs a live LlmClient`);
      }
      const response = await live.complete(request);
      if (mode === 'record') {
        const file: CassetteFile = {
          version: 1,
          model: request.model,
          prompt_version: request.promptVersion,
          request_sha256: requestHash(request),
          response,
        };
        await store.write(path, `${JSON.stringify(file, null, 2)}\n`);
      }
      return response;
    },
  };
}
