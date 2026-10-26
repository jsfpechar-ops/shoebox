export interface MailPart {
  readonly filename: string | null;
  readonly mimeType: string;
  readonly contentId: string | null;
  readonly content: Uint8Array;
}

export interface Candidate {
  readonly filename: string;
  readonly mimeType: string;
  readonly content: Uint8Array;
}

const SKIP_TYPES = new Set([
  'text/calendar',
  'text/vcard',
  'text/x-vcard',
  'application/pkcs7-signature',
  'application/pgp-signature',
]);
const UNSUPPORTED_TYPES = new Set(['application/ms-tnef', 'application/pkcs7-mime']);

const EXT_TYPES = new Map<string, string>([
  ['isdoc', 'application/xml'],
  ['xml', 'application/xml'],
  ['isdocx', 'application/x-isdocx'],
  ['pdf', 'application/pdf'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['png', 'image/png'],
  ['webp', 'image/webp'],
]);
const ALLOWED_TYPES = new Set(EXT_TYPES.values());
const TYPE_EXT = new Map<string, string>([
  ['application/xml', 'xml'],
  ['application/x-isdocx', 'isdocx'],
  ['application/pdf', 'pdf'],
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

const MIN_IMAGE_BYTES = 15_360;
const MAX_BYTES = 20 * 1024 * 1024;

function extOf(name: string | null): string | null {
  if (!name) return null;
  const i = name.lastIndexOf('.');
  return i < 0 ? null : name.slice(i + 1).toLowerCase();
}

/** M01 §4.5.1 triage, first match wins; a candidate without a filename gets `attachment-<index>.<ext>`. */
export function triageAttachments(parts: readonly MailPart[], html: string | null): Candidate[] {
  const cids = new Set<string>();
  if (html !== null) for (const m of html.matchAll(/cid:([^"'\s>)]+)/gi)) cids.add(m[1] ?? '');

  const out: Candidate[] = [];
  parts.forEach((part, index) => {
    const type = part.mimeType.toLowerCase();
    const name = part.filename ? part.filename : null;
    const lowerName = (name ?? '').toLowerCase();
    if (SKIP_TYPES.has(type) || lowerName === 'smime.p7s') return;
    if (UNSUPPORTED_TYPES.has(type) || lowerName === 'winmail.dat') return;

    const ext = extOf(name);
    const resolved =
      (ext !== null ? EXT_TYPES.get(ext) : undefined) ??
      (ALLOWED_TYPES.has(type) ? type : undefined);
    if (resolved === undefined) return;
    const isImage = resolved.startsWith('image/');
    const cid = part.contentId?.replace(/^<|>$/g, '') ?? null;
    if (isImage && cid !== null && cids.has(cid)) return;
    if (isImage && part.content.length < MIN_IMAGE_BYTES) return;
    if (part.content.length > MAX_BYTES) return;

    const filename = name ?? `attachment-${index + 1}.${TYPE_EXT.get(resolved) ?? 'bin'}`;
    out.push({ filename, mimeType: resolved, content: part.content });
  });
  return out;
}

/** ADR-005: spf=fail and dkim=fail in the Authentication-Results headers is a spoof; any such header is a pass. */
export function spamVerdictOf(
  headers: readonly { key: string; value: string }[],
): 'pass' | 'spoof_fail' | 'unknown' {
  const auth = headers.filter((h) => {
    const key = h.key.toLowerCase();
    return key === 'authentication-results' || key === 'arc-authentication-results';
  });
  if (auth.length === 0) return 'unknown';
  const spfFail = auth.some((h) => /\bspf=fail\b/i.test(h.value));
  const dkimFail = auth.some((h) => /\bdkim=fail\b/i.test(h.value));
  return spfFail && dkimFail ? 'spoof_fail' : 'pass';
}
