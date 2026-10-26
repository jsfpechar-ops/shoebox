import type { MessageKey } from '@shoebox/i18n';

export type TrashMove = 'trash' | 'restore';
export type TrashCheck = { ok: true } | { ok: false; error: MessageKey };

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_DAYS = 30;

/** Can this document make the move? Finalized documents never go to the trash. */
export function checkTrashMove(
  doc: { finalizedAt: string | null; deletedAt: string | null },
  move: TrashMove,
): TrashCheck {
  if (move === 'trash') {
    if (doc.finalizedAt !== null) return { ok: false, error: 'trash.error.finalized' };
    if (doc.deletedAt !== null) return { ok: false, error: 'trash.error.save' };
    return { ok: true };
  }
  if (doc.deletedAt === null) return { ok: false, error: 'trash.error.save' };
  return { ok: true };
}

/** Days left before the purge (30 days after deletedAt), never below 0. */
export function trashDaysLeft(deletedAt: string, nowMs: number): number {
  const purgeAt = Date.parse(deletedAt) + RETENTION_DAYS * DAY_MS;
  return Math.max(0, Math.ceil((purgeAt - nowMs) / DAY_MS));
}
