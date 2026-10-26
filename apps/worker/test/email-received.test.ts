import type { TenantTx } from '@shoebox/db';
import { describe, expect, it } from 'vitest';
import {
  createEmailReceivedHandler,
  type EmailReceivedDeps,
} from '../src/email-received/handler';
import { type MailPart, spamVerdictOf, triageAttachments } from '../src/email-received/triage';

const ORG = 'eeeeeeee-0000-4000-8000-000000000105';
const MAIL = 'eeeeeeee-0000-4000-8000-0000000001e5';
const big = (n: number) => new Uint8Array(n).fill(1);

const part = (over: Partial<MailPart>): MailPart => ({
  filename: 'faktura.pdf',
  mimeType: 'application/pdf',
  contentId: null,
  content: big(20_000),
  ...over,
});

describe('triageAttachments', () => {
  it('keeps real documents and decides the type by extension first', () => {
    const out = triageAttachments(
      [
        part({}),
        part({ filename: 'scan.JPG', mimeType: 'application/octet-stream' }),
        part({ filename: 'faktura.isdoc', mimeType: 'text/plain' }),
        part({ filename: 'faktura.isdocx', mimeType: 'application/zip' }),
        part({ filename: null, mimeType: 'image/png' }),
      ],
      null,
    );
    expect(out.map((c) => c.mimeType)).toEqual([
      'application/pdf',
      'image/jpeg',
      'application/xml',
      'application/x-isdocx',
      'image/png',
    ]);
    expect(out[4]?.filename).toBe('attachment-5.png');
  });

  it('skips calendar, signatures, winmail, inline and tiny images, unknown types and huge files', () => {
    const out = triageAttachments(
      [
        part({ filename: 'invite.ics', mimeType: 'text/calendar' }),
        part({ filename: 'smime.p7s', mimeType: 'application/octet-stream' }),
        part({ filename: 'winmail.dat', mimeType: 'application/ms-tnef' }),
        part({ filename: 'logo.png', mimeType: 'image/png', contentId: '<logo1>' }),
        part({ filename: 'podpis.jpg', mimeType: 'image/jpeg', content: big(15_000) }),
        part({ filename: 'IMG_1.HEIC', mimeType: 'image/heic' }),
        part({ filename: 'smlouva.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
        part({ filename: 'velky.pdf', content: big(20 * 1024 * 1024 + 1) }),
      ],
      '<p>Dobrý den<img src="cid:logo1"></p>',
    );
    expect(out).toEqual([]);
  });

  it('an image with a content id that the HTML does not use is kept', () => {
    const out = triageAttachments([part({ filename: 'uctenka.jpg', mimeType: 'image/jpeg', contentId: '<x9>' })], '<p>hi</p>');
    expect(out).toHaveLength(1);
  });
});

describe('spamVerdictOf', () => {
  it('spf and dkim both failing is spoof_fail', () => {
    expect(spamVerdictOf([{ key: 'authentication-results', value: 'mx.cloudflare.net; spf=fail smtp.mailfrom=x; dkim=fail header.d=x' }])).toBe('spoof_fail');
  });
  it('one passing is pass; no header is unknown', () => {
    expect(spamVerdictOf([{ key: 'authentication-results', value: 'mx; spf=fail; dkim=pass' }])).toBe('pass');
    expect(spamVerdictOf([{ key: 'ARC-Authentication-Results', value: 'i=1; mx; spf=pass; dkim=none' }])).toBe('pass');
    expect(spamVerdictOf([{ key: 'subject', value: 'spf=fail dkim=fail' }])).toBe('unknown');
  });
});

const EML = new TextEncoder().encode(
  [
    'From: Dodavatel <dodavatel@example.test>',
    'To: firma-ab12cd34@in.example.test',
    'Subject: Faktura',
    'Message-ID: <m1@example.test>',
    'Authentication-Results: mx; spf=pass; dkim=pass',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="b1"',
    '',
    '--b1',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'V příloze faktura.',
    '--b1',
    'Content-Type: application/pdf; name="faktura.pdf"',
    'Content-Disposition: attachment; filename="faktura.pdf"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from('%PDF-1.4 fake'.padEnd(16_000, ' ')).toString('base64'),
    '--b1--',
    '',
  ].join('\r\n'),
);

function fakeDeps(over: Partial<EmailReceivedDeps> = {}) {
  const log = { put: [] as string[], inserted: [] as string[], batches: [] as string[], finished: [] as unknown[], queued: [] as string[] };
  const deps: EmailReceivedDeps = {
    blobs: {
      get: async () => EML,
      put: async (path) => void log.put.push(path),
    },
    store: {
      load: async () => ({ id: MAIL, orgId: ORG, emlPath: `org/${ORG}/eml/x.eml`, purpose: 'documents', processedAt: null }),
      finish: async (_tx, id, result) => void log.finished.push({ id, ...result }),
      insertAttachment: async (_tx, row) => {
        log.inserted.push(row.originalFilename);
        log.batches.push(row.batchId);
        return { sourceFileId: 's1', documentId: 'd1' };
      },
    },
    enqueueSplit: async (_orgId, batchId) => void log.queued.push(batchId),
    ...over,
  };
  return { deps, log };
}

const ctx = { tx: {} as TenantTx, jobId: 'j', attempt: 1, signal: new AbortController().signal };

describe('email.received handler', () => {
  it('turns the PDF attachment into a document and starts reading it', async () => {
    const { deps, log } = fakeDeps();
    await createEmailReceivedHandler(deps)({ orgId: ORG, inboundEmailId: MAIL }, ctx);
    expect(log.inserted).toEqual(['faktura.pdf']);
    expect(log.put).toHaveLength(1);
    expect(log.put[0]).toMatch(new RegExp(`^org/${ORG}/files/[0-9a-f]{64}$`));
    expect(log.batches).toHaveLength(1);
    expect(log.batches[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(log.queued).toEqual(log.batches);
    expect(log.finished).toEqual([{ id: MAIL, spamVerdict: 'pass', bodyText: expect.stringContaining('V příloze faktura.') }]);
  });

  it('a spoofed mail is held back: nothing stored or read', async () => {
    const spoofed = new TextDecoder().decode(EML).replace('spf=pass; dkim=pass', 'spf=fail; dkim=fail');
    const { deps, log } = fakeDeps({ blobs: { get: async () => new TextEncoder().encode(spoofed), put: async () => undefined } });
    await createEmailReceivedHandler(deps)({ orgId: ORG, inboundEmailId: MAIL }, ctx);
    expect(log.inserted).toEqual([]);
    expect(log.queued).toEqual([]);
    expect(log.finished).toEqual([{ id: MAIL, spamVerdict: 'spoof_fail', bodyText: null }]);
  });

  it('an already processed or missing mail is left alone; an exact duplicate file is not read again', async () => {
    const done = fakeDeps({
      store: {
        load: async () => ({ id: MAIL, orgId: ORG, emlPath: 'p', purpose: 'documents', processedAt: new Date() }),
        finish: async () => undefined,
        insertAttachment: async () => ({ sourceFileId: 's', documentId: 'd' }),
      },
    });
    await createEmailReceivedHandler(done.deps)({ orgId: ORG, inboundEmailId: MAIL }, ctx);
    expect(done.log.put).toEqual([]);

    const dup = fakeDeps();
    dup.deps.store.insertAttachment = async () => ({ sourceFileId: 's1', documentId: null });
    await createEmailReceivedHandler(dup.deps)({ orgId: ORG, inboundEmailId: MAIL }, ctx);
    expect(dup.log.queued).toEqual([]);
    expect(dup.log.finished).toHaveLength(1);
  });

  it('a bank notice creates no documents yet', async () => {
    const { deps, log } = fakeDeps();
    deps.store.load = async () => ({ id: MAIL, orgId: ORG, emlPath: 'p', purpose: 'bank_notice', processedAt: null });
    await createEmailReceivedHandler(deps)({ orgId: ORG, inboundEmailId: MAIL }, ctx);
    expect(log.inserted).toEqual([]);
    expect(log.finished).toHaveLength(1);
  });
});
