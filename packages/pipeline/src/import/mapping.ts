import { createHash } from 'node:crypto';
import { icoChecksumValid } from '@shoebox/validation';
import { parseDateText } from './sheet';

export const IMPORT_TARGETS = [
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
export type ImportTarget = (typeof IMPORT_TARGETS)[number];
export type ImportMapping = Readonly<Partial<Record<ImportTarget, number>>>; // target → column index

const SYNONYMS: Readonly<Record<ImportTarget, readonly string[]>> = {
  issue_date: ['datum', 'datum vystaveni', 'vystaveno', 'date', 'issue date'],
  partner_name: ['dodavatel', 'odberatel', 'firma', 'partner', 'nazev', 'protistrana', 'supplier'],
  partner_ico: ['ico', 'ic'],
  document_number: [
    'cislo',
    'cislo faktury',
    'c. dokladu',
    'cislo dokladu',
    'doklad',
    'invoice no',
    'faktura',
  ],
  total_gross: ['castka', 'celkem', 's dph', 'castka s dph', 'cena', 'amount', 'total'],
  total_vat: ['dph', 'dan', 'vat'],
  total_net: ['bez dph', 'zaklad', 'castka bez dph'],
  paid: ['zaplaceno', 'uhrazeno', 'datum uhrady', 'paid'],
  currency: ['mena', 'currency'],
  variable_symbol: ['vs', 'variabilni symbol'],
  due_date: ['splatnost', 'datum splatnosti', 'due date'],
  description: ['popis', 'poznamka', 'description', 'note'],
};

export function foldHeader(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function headerSignature(headers: readonly string[]): string {
  return createHash('sha256').update(headers.map(foldHeader).join('\u001f'), 'utf8').digest('hex');
}

function share(values: readonly string[], test: (v: string) => boolean): number {
  if (values.length === 0) return 0;
  return values.filter(test).length / values.length;
}

function columnValues(sample: readonly (readonly string[])[], col: number): string[] {
  return sample.map((r) => (r[col] ?? '').trim()).filter((v) => v !== '');
}

/** Header synonyms first (first synonym wins, a column is used once); value sniff only for issue_date and partner_ico. */
export function suggestMapping(
  headers: readonly string[],
  sample: readonly (readonly string[])[],
): ImportMapping {
  const folded = headers.map(foldHeader);
  const used = new Set<number>();
  const mapping: Partial<Record<ImportTarget, number>> = {};

  for (const target of IMPORT_TARGETS) {
    for (const synonym of SYNONYMS[target]) {
      const index = folded.findIndex((h, i) => h === synonym && !used.has(i));
      if (index !== -1) {
        mapping[target] = index;
        used.add(index);
        break;
      }
    }
  }

  if (mapping.issue_date === undefined) {
    for (let c = 0; c < headers.length; c++) {
      if (used.has(c)) continue;
      const values = columnValues(sample, c);
      if (share(values, (v) => parseDateText(v) !== null) >= 0.8) {
        mapping.issue_date = c;
        used.add(c);
        break;
      }
    }
  }

  if (mapping.partner_ico === undefined) {
    for (let c = 0; c < headers.length; c++) {
      if (used.has(c)) continue;
      const values = columnValues(sample, c);
      if (share(values, (v) => /^\d{8}$/.test(v) && icoChecksumValid(v)) >= 0.8) {
        mapping.partner_ico = c;
        used.add(c);
        break;
      }
    }
  }

  return mapping;
}
