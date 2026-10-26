import { createHash } from 'node:crypto';
import type { InboundEmailInsert } from '@shoebox/db';
import { emlPath, verifyWebhook } from '@shoebox/platform';

export const INBOUND_MAX_BYTES = 25 * 1024 * 1024;

export interface InboundAddress {
  readonly slug: string;
  readonly secret: string;
  readonly purpose: 'documents' | 'bank_notice';
}

const SLUG_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const LOCAL_RE = /^(.+)-([0-9a-z]{8})$/;
const HEADER_SCAN_BYTES = 64 * 1024;
const MESSAGE_ID_MAX = 500;

const sha256Hex = (input: string | Uint8Array): string =>
  createHash('sha256').update(input).digest('hex');

/** `{slug}-{secret}[+tag]@domain`, compared lower-case; the domain is ignored. */
export function parseInboundAddress(to: string): InboundAddress | null {
  const at = to.indexOf('@');
  if (at < 0) return null;
  const local = to.slice(0, at).toLowerCase();
  const plus = local.indexOf('+');
  const base = plus < 0 ? local : local.slice(0, plus);
  const tag = plus < 0 ? null : local.slice(plus + 1);
  const match = LOCAL_RE.exec(base);
  if (!match) return null;
  const slug = match[1] ?? '';
  const secret = match[2] ?? '';
  if (!SLUG_RE.test(slug)) return null;
  return { slug, secret, purpose: tag === 'banka' ? 'bank_notice' : 'documents' };
}

/** First `Message-ID` of the header block (folded lines joined), or null. */
export function messageIdOf(raw: Uint8Array): string | null {
  const text = new TextDecoder('latin1').decode(raw.subarray(0, HEADER_SCAN_BYTES));
  const headerBlock = text.split(/\r?\n\r?\n/)[0] ?? '';
  const lines: string[] = [];
  for (const line of headerBlock.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && lines.length > 0) {
      lines[lines.length - 1] = `${lines[lines.length - 1]} ${line.trim()}`;
    } else {
      lines.push(line);
    }
  }
  const found = lines.find((line) => /^message-id:/i.test(line));
  if (!found) return null;
  const value = found.slice('message-id:'.length).trim().slice(0, MESSAGE_ID_MAX);
  return value.length > 0 ? value : null;
}

export interface InboundDeps {
  readonly secret: string;
  findOrg(slug: string, secret: string, now: Date): Promise<string | null>;
  putEml(path: string, body: Uint8Array): Promise<void>;
  insertEmail(row: InboundEmailInsert): Promise<string | null>;
  enqueue(orgId: string, inboundEmailId: string): Promise<void>;
  now(): Date;
}

export interface InboundRequest {
  readonly to: string;
  readonly from: string | null;
  readonly signature: string | null;
  readonly body: Uint8Array;
}

export interface InboundResult {
  readonly status: number;
  readonly body: Record<string, string>;
}

/** Signed webhook from the mail worker: verify, find the firm, store, record, queue. */
export async function handleInboundEmail(
  deps: InboundDeps,
  req: InboundRequest,
): Promise<InboundResult> {
  if (req.body.byteLength > INBOUND_MAX_BYTES) {
    return { status: 413, body: { error: 'too_large' } };
  }
  if (deps.secret.length === 0) {
    return { status: 401, body: { error: 'unauthorized' } };
  }
  const verdict = verifyWebhook(
    [deps.secret],
    req.signature,
    `${req.to}\n${sha256Hex(req.body)}`,
  );
  if (!verdict.ok) {
    return { status: 401, body: { error: 'unauthorized' } };
  }
  const address = parseInboundAddress(req.to);
  if (!address) {
    return { status: 404, body: { decision: 'unknown_recipient' } };
  }
  const messageId = messageIdOf(req.body) ?? `sha256:${sha256Hex(req.body)}`;
  try {
    const orgId = await deps.findOrg(address.slug, address.secret, deps.now());
    if (!orgId) {
      return { status: 404, body: { decision: 'unknown_recipient' } };
    }
    const path = emlPath(orgId, sha256Hex(messageId));
    await deps.putEml(path, req.body);
    const id = await deps.insertEmail({
      orgId,
      messageId,
      fromAddress: req.from,
      toAddress: req.to,
      subject: null,
      receivedAt: deps.now(),
      purpose: address.purpose,
      emlPath: path,
    });
    if (!id) {
      return { status: 200, body: { decision: 'duplicate' } };
    }
    await deps.enqueue(orgId, id);
    return { status: 202, body: { decision: 'accept' } };
  } catch {
    return { status: 503, body: { error: 'retry' } };
  }
}
