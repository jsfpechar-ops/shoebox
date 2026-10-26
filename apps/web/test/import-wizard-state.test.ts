import { describe, expect, it } from 'vitest';
import {
  canUndo,
  isRunning,
  missingRequired,
  REQUIRED_TARGETS,
  setTarget,
  skippedTotal,
  TARGET_ORDER,
} from '../src/imports/wizard-state';

describe('import wizard state', () => {
  it('lists twelve targets in the M11 order', () => {
    expect(TARGET_ORDER).toHaveLength(12);
    expect(TARGET_ORDER[0]).toBe('issue_date');
    expect(REQUIRED_TARGETS).toEqual(['issue_date', 'total_gross']);
  });

  it('setTarget sets and removes a column', () => {
    expect(setTarget({}, 'issue_date', 2)).toEqual({ issue_date: 2 });
    expect(setTarget({ issue_date: 2 }, 'issue_date', null)).toEqual({});
  });

  it('setTarget moves a column between targets', () => {
    const moved = setTarget({ issue_date: 1, total_gross: 2 }, 'due_date', 1);
    expect(moved).toEqual({ total_gross: 2, due_date: 1 });
  });

  it('skippedTotal sums reasons and duplicates', () => {
    expect(
      skippedTotal({ valid: 5, skipped: { bad_date: 2, missing_total: 1 }, duplicateInFile: 3 }),
    ).toBe(6);
    expect(skippedTotal({ valid: 0, skipped: {}, duplicateInFile: 0 })).toBe(0);
  });

  it('missingRequired names the unmapped required targets', () => {
    expect(missingRequired({})).toEqual(['issue_date', 'total_gross']);
    expect(missingRequired({ issue_date: 0 })).toEqual(['total_gross']);
    expect(missingRequired({ issue_date: 0, total_gross: 0 })).toEqual([]);
  });

  it('isRunning is true only while importing', () => {
    expect(isRunning('importing')).toBe(true);
    expect(isRunning('done')).toBe(false);
  });

  it('canUndo needs a done import younger than 30 days', () => {
    const now = new Date('2026-10-26T12:00:00Z');
    expect(canUndo('done', '2026-10-01T00:00:00Z', now)).toBe(true);
    expect(canUndo('done', '2026-09-01T00:00:00Z', now)).toBe(false);
    expect(canUndo('failed', '2026-10-25T00:00:00Z', now)).toBe(false);
    expect(canUndo('undone', '2026-10-25T00:00:00Z', now)).toBe(false);
  });
});
