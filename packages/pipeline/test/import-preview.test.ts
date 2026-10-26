import { describe, expect, it } from 'vitest';
import {
  buildImportPreview,
  type ImportOptions,
  missingRequiredTargets,
} from '../src/import/preview';

const OPTIONS: ImportOptions = { direction_mode: 'all_expense', header_row: 0 };
const MAPPING = { issue_date: 0, partner_name: 1, total_gross: 2 };

const HEADER = ['Datum', 'Dodavatel', 'Částka'];

describe('buildImportPreview', () => {
  it('counts valid rows and skips the rows parseImportRow rejects', () => {
    const sheet = [
      HEADER,
      ['2026-03-04', 'Alfa', '1234,50'],
      ['2026-03-05', 'Beta', 'x'],
      ['', '', ''],
      ['2026-03-06', 'Gamma', '99'],
    ];
    const preview = buildImportPreview(sheet, 0, MAPPING, OPTIONS);
    expect(preview.counts.valid).toBe(2);
    expect(preview.counts.duplicateInFile).toBe(0);
    expect(preview.counts.skipped).toEqual({ bad_amount: 1 });
    expect(preview.rows.map((r) => r.rowNumber)).toEqual([2, 3, 5]);
  });

  it('counts a repeated document in the file as duplicateInFile, not valid', () => {
    const sheet = [HEADER, ['2026-03-04', 'Alfa', '10'], ['2026-03-04', 'Alfa', '10']];
    const preview = buildImportPreview(sheet, 0, MAPPING, OPTIONS);
    expect(preview.counts.valid).toBe(1);
    expect(preview.counts.duplicateInFile).toBe(1);
  });

  it('starts the data after the header row and limits the preview to 10 rows', () => {
    const sheet: string[][] = [['Title', 'x', 'y'], HEADER];
    for (let i = 0; i < 12; i += 1) sheet.push([`2026-03-${10 + i}`, `P${i}`, '5']);
    const preview = buildImportPreview(sheet, 1, MAPPING, { ...OPTIONS, header_row: 1 });
    expect(preview.counts.valid).toBe(12);
    expect(preview.rows).toHaveLength(10);
    expect(preview.rows[0]?.rowNumber).toBe(3);
  });

  it('reports the required targets that are not mapped', () => {
    expect(missingRequiredTargets({ issue_date: 0 })).toEqual(['total_gross']);
    expect(missingRequiredTargets({ issue_date: 0, total_gross: 2 })).toEqual([]);
  });
});
