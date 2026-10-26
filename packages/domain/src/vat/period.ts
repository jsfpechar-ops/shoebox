// VAT period and due-date helpers (M05 §4.12). Pure: the date and the rules in, the date out.
// `vat.deadline_day` and the holiday list come from `rules/cz`; nothing is typed here.

import { type LegalDate, parseLegalDate } from '../dates/index';
import { shiftDate } from '../overview/deadlines';
import type { createCzRules } from '../rules/index';

export type CzRules = ReturnType<typeof createCzRules>;

function partsOf(date: LegalDate): { y: number; m: number } {
  return { y: Number.parseInt(date.slice(0, 4), 10), m: Number.parseInt(date.slice(5, 7), 10) };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** First day of the month after `date`'s month. */
export function monthAfter(date: LegalDate): LegalDate {
  const { y, m } = partsOf(date);
  return m === 12 ? parseLegalDate(`${y + 1}-01-01`) : parseLegalDate(`${y}-${pad2(m + 1)}-01`);
}

/** Last day of the month/quarter that starts at `start`. */
export function periodEndOf(start: LegalDate, kind: 'month' | 'quarter'): LegalDate {
  const { y, m } = partsOf(start);
  const months = kind === 'month' ? 1 : 3;
  const idx = y * 12 + (m - 1) + months - 1;
  const ey = Math.floor(idx / 12);
  const em = (idx % 12) + 1;
  const last = new Date(Date.UTC(ey, em, 0)).getUTCDate();
  return parseLegalDate(`${ey}-${pad2(em)}-${pad2(last)}`);
}

/** { legal: day `vat.deadline_day` of the month after periodEnd, due: shifted to the next CZ working day }. Rules resolved at `periodEnd`. */
export function vatDueDate(
  periodEnd: LegalDate,
  rules: CzRules,
): { legal: LegalDate; due: LegalDate } {
  const day = rules.at(periodEnd).get('vat.deadline_day');
  const { y, m } = partsOf(monthAfter(periodEnd));
  const legal = parseLegalDate(`${y}-${pad2(m)}-${pad2(day)}`);
  return { legal, due: shiftDate(legal, 'next_working_day', rules) };
}
