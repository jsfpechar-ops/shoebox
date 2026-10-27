import type { FixKind } from './correction';

export type TextItem = { str: string; page: number; x: number; y: number; w: number; h: number };
export type Match = { page: number; rect: { x: number; y: number; w: number; h: number } };

const MAX_RUN = 6;
const DATE_CZ = /(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/;
const DATE_ISO = /(\d{4})-(\d{2})-(\d{2})/;

/** One comparable form per kind; '' when nothing usable. Never logs. */
export function normaliseForMatch(kind: FixKind, raw: string): string {
  const s = raw.replace(/[\s  ]+/g, '');
  if (kind === 'money') {
    let m = s.replace(/(kč|czk)$/i, '');
    if (/[^\d,.-]/.test(m)) return '';
    const lastComma = m.lastIndexOf(',');
    const lastDot = m.lastIndexOf('.');
    const dec = Math.max(lastComma, lastDot);
    if (dec !== -1) {
      const tail = m.slice(dec + 1);
      const both = lastComma !== -1 && lastDot !== -1;
      const decimal = both || tail.length !== 3 || m.indexOf(m[dec] ?? '') !== dec;
      m = decimal ? `${m.slice(0, dec).replace(/[,.]/g, '')}.${tail}` : m.replace(/[,.]/g, '');
    }
    if (!/^-?\d+(\.\d+)?$/.test(m)) return '';
    return m.includes('.') ? m.replace(/\.?0+$/, '').replace(/\.$/, '') : m;
  }
  if (kind === 'date') {
    const cz = DATE_CZ.exec(raw);
    if (cz) return `${cz[3]}-${(cz[2] ?? '').padStart(2, '0')}-${(cz[1] ?? '').padStart(2, '0')}`;
    const iso = DATE_ISO.exec(raw);
    return iso ? iso[0] : '';
  }
  return s.toLowerCase();
}

function sameLine(a: TextItem, b: TextItem): boolean {
  return a.page === b.page && Math.abs(a.y - b.y) <= Math.max(a.h, b.h) / 2;
}

/** First run of adjacent same-line items (or words inside one item) whose normalised text equals the value. */
export function findMatch(items: TextItem[], kind: FixKind, value: string): Match | null {
  const want = normaliseForMatch(kind, value);
  if (want === '') return null;
  for (let i = 0; i < items.length; i++) {
    const first = items[i];
    if (!first) continue;
    let joined = '';
    let x1 = first.x;
    let y1 = first.y;
    let x2 = first.x + first.w;
    let y2 = first.y + first.h;
    let prev = first;
    for (let j = i; j < Math.min(items.length, i + MAX_RUN); j++) {
      const it = items[j];
      if (!it || (j > i && !sameLine(prev, it))) break;
      joined += it.str;
      x1 = Math.min(x1, it.x);
      y1 = Math.min(y1, it.y);
      x2 = Math.max(x2, it.x + it.w);
      y2 = Math.max(y2, it.y + it.h);
      prev = it;
      if (normaliseForMatch(kind, joined) === want) {
        return { page: first.page, rect: { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } };
      }
    }
  }
  return wordMatch(items, kind, want);
}

function wordMatch(items: TextItem[], kind: FixKind, want: string): Match | null {
  for (const it of items) {
    const words = [...it.str.matchAll(/\S+/g)];
    if (words.length < 2 || it.str.length === 0) continue;
    for (let a = 0; a < words.length; a++) {
      let joined = '';
      for (let b = a; b < Math.min(words.length, a + MAX_RUN); b++) {
        const w0 = words[a];
        const w1 = words[b];
        if (!w0 || !w1) break;
        joined = it.str.slice(w0.index, (w1.index ?? 0) + w1[0].length);
        if (normaliseForMatch(kind, joined) === want) {
          const per = it.w / it.str.length;
          const start = w0.index ?? 0;
          return {
            page: it.page,
            rect: { x: it.x + start * per, y: it.y, w: joined.length * per, h: it.h },
          };
        }
      }
    }
  }
  return null;
}
