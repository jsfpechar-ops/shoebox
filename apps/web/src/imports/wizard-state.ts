// Pure helpers of the spreadsheet import wizard (brief 0417, M11 §5).
import type { ImportMapping, ImportPreview } from '@shoebox/pipeline';

// Copied from IMPORT_TARGETS in packages/pipeline/src/import/mapping.ts, in the M11 order: that
// module pulls node:crypto, which must stay out of the client bundle.
export const TARGET_ORDER = [
  'issue_date',
  'partner_name',
  'partner_ico',
  'document_number',
  'total_gross',
  'total_vat',
  'total_net',
  'paid',
  'currency',
  'variable_symbol',
  'due_date',
  'description',
] as const;
export type WizardTarget = (typeof TARGET_ORDER)[number];

export const REQUIRED_TARGETS: readonly WizardTarget[] = ['issue_date', 'total_gross'];

export type WizardImportState = 'parsed' | 'importing' | 'done' | 'failed' | 'undone';

const UNDO_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Chooses `column` for `target` (null removes it); a column serves one target only. */
export function setTarget(
  mapping: ImportMapping,
  target: WizardTarget,
  column: number | null,
): ImportMapping {
  const next: Partial<Record<WizardTarget, number>> = {};
  for (const [key, value] of Object.entries(mapping) as [WizardTarget, number][]) {
    if (key === target) continue;
    if (column !== null && value === column) continue;
    next[key] = value;
  }
  if (column !== null) next[target] = column;
  return next;
}

export function skippedTotal(counts: ImportPreview['counts']): number {
  let total = counts.duplicateInFile;
  for (const n of Object.values(counts.skipped)) total += n ?? 0;
  return total;
}

export function missingRequired(mapping: ImportMapping): string[] {
  return REQUIRED_TARGETS.filter((target) => mapping[target] === undefined);
}

export function isRunning(state: WizardImportState): boolean {
  return state === 'importing';
}

export function canUndo(state: WizardImportState, createdAt: string | Date, now: Date): boolean {
  if (state !== 'done') return false;
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return false;
  return now.getTime() - created < UNDO_WINDOW_MS;
}
