import { describe, expect, it } from 'vitest';
import { checkTrashMove, trashDaysLeft } from '../src/documents/trash';

describe('checkTrashMove', () => {
  it('a live, not finalized document can go to the trash', () => {
    expect(checkTrashMove({ finalizedAt: null, deletedAt: null }, 'trash')).toEqual({ ok: true });
  });
  it('a finalized document never goes to the trash', () => {
    expect(
      checkTrashMove({ finalizedAt: '2026-10-01T00:00:00Z', deletedAt: null }, 'trash'),
    ).toEqual({
      ok: false,
      error: 'trash.error.finalized',
    });
  });
  it('only a trashed document can be restored, and not trashed twice', () => {
    expect(
      checkTrashMove({ finalizedAt: null, deletedAt: '2026-10-20T00:00:00Z' }, 'restore'),
    ).toEqual({ ok: true });
    expect(checkTrashMove({ finalizedAt: null, deletedAt: null }, 'restore').ok).toBe(false);
    expect(
      checkTrashMove({ finalizedAt: null, deletedAt: '2026-10-20T00:00:00Z' }, 'trash').ok,
    ).toBe(false);
  });
});

describe('trashDaysLeft', () => {
  it('counts down from 30 days and stops at 0', () => {
    const deleted = '2026-10-01T00:00:00Z';
    expect(trashDaysLeft(deleted, Date.parse('2026-10-01T00:00:00Z'))).toBe(30);
    expect(trashDaysLeft(deleted, Date.parse('2026-10-21T12:00:00Z'))).toBe(10);
    expect(trashDaysLeft(deleted, Date.parse('2026-12-01T00:00:00Z'))).toBe(0);
  });
});
