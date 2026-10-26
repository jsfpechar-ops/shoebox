import { createHash, randomUUID } from 'node:crypto';
import type { finishInboundEmail, insertEmailAttachment, loadInboundEmail } from '@shoebox/db';
import { BlobStoreError, filePath } from '@shoebox/platform';
import PostalMime from 'postal-mime';
import type { TenantHandler } from '../registry';
import { isBulkMail, spamVerdictOf, triageAttachments } from './triage';

export interface EmailReceivedDeps {
  readonly blobs: {
    get(path: string): Promise<Uint8Array>;
    put(path: string, body: Uint8Array, contentType: string): Promise<void>;
  };
  readonly store: {
    load: typeof loadInboundEmail;
    finish: typeof finishInboundEmail;
    insertAttachment: typeof insertEmailAttachment;
  };
  readonly enqueueSplit: (orgId: string, batchId: string) => Promise<void>;
}

/** email.received: turns a received mail's real attachments into documents read like uploads. */
export function createEmailReceivedHandler(
  deps: EmailReceivedDeps,
): TenantHandler<{ orgId: string; inboundEmailId: string }> {
  return async (payload, ctx) => {
    const mail = await deps.store.load(ctx.tx, payload.inboundEmailId);
    if (mail === null || mail.processedAt !== null) return;

    const bytes = await deps.blobs.get(mail.emlPath);
    const email = await PostalMime.parse(bytes);
    const headers = email.headers.map((h) => ({ key: h.key, value: h.value }));
    const verdict = spamVerdictOf(headers);

    if (mail.purpose === 'bank_notice' || verdict === 'spoof_fail') {
      await deps.store.finish(ctx.tx, mail.id, { spamVerdict: verdict, bodyText: null });
      return;
    }

    const parts = email.attachments
      .filter((a) => a.content !== null)
      .map((a) => ({
        filename: a.filename ?? null,
        mimeType: a.mimeType,
        contentId: a.contentId ?? null,
        content: new Uint8Array(a.content as ArrayBuffer),
      }));
    const candidates = triageAttachments(parts, email.html ?? null, { bulk: isBulkMail(headers) });

    const batchId = randomUUID();
    let anyNew = false;
    for (const candidate of candidates) {
      const sha256 = createHash('sha256').update(candidate.content).digest('hex');
      const storagePath = filePath(payload.orgId, sha256);
      try {
        await deps.blobs.put(storagePath, candidate.content, candidate.mimeType);
      } catch (error) {
        const exists =
          error instanceof BlobStoreError && (error.status === 409 || error.status === 400);
        if (!exists) throw error;
      }
      const row = await deps.store.insertAttachment(ctx.tx, {
        orgId: payload.orgId,
        inboundEmailId: mail.id,
        sha256,
        storagePath,
        mimeType: candidate.mimeType,
        byteSize: candidate.content.length,
        originalFilename: candidate.filename,
        batchId,
      });
      if (row.documentId !== null) anyNew = true;
    }
    if (anyNew) await deps.enqueueSplit(payload.orgId, batchId);

    await deps.store.finish(ctx.tx, mail.id, {
      spamVerdict: verdict,
      bodyText: email.text ?? null,
    });
  };
}
