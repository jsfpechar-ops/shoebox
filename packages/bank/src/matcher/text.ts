import { parseSymbol } from '../normalize';

const LEGAL_FORMS = new Set(['SRO', 'AS', 'BV', 'LTD', 'LIMITED', 'INC', 'GMBH', 'SE', 'SPOL', 'VOS', 'KS', 'PLC', 'LLC', 'SA', 'AG']);
const CITIES = new Set([
  'PRAHA', 'BRNO', 'OSTRAVA', 'PLZEN', 'LIBEREC', 'OLOMOUC', 'PARDUBICE', 'ZLIN', 'JIHLAVA', 'KLADNO', 'TEPLICE', 'OPAVA',
  'HAVIROV',
]);
const TLD_SUFFIXES = ['.COM', '.CZ', '.SK', '.EU', '.DE', '.NET', '.ORG'];

/** NFD, strip combining marks, uppercase, trim. */
export function foldText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
}

/** M07 §4.6.2 merchant normalisation. */
export function normMerchant(s: string): string {
  let t = foldText(s);
  t = t.replace(/^(PAYPAL|SUMUP|SQ|GOOGLE)\s*\*\s*/, '');
  t = t.replace(/APPLE\.COM\/BILL/g, 'APPLE').replace(/AMZN MKTP/g, 'AMAZON');
  const tokens: string[] = [];
  for (let tok of t.replace(/[^A-Z0-9.]/g, ' ').split(/\s+/)) {
    if (tok.startsWith('WWW.')) tok = tok.slice(4);
    for (const suffix of TLD_SUFFIXES) {
      if (tok.endsWith(suffix)) {
        tok = tok.slice(0, -suffix.length);
        break;
      }
    }
    tok = tok.replace(/\./g, '');
    if (tok === '' || /^\d+$/.test(tok) || tok.length === 2 || tok === 'WWW') continue;
    if (LEGAL_FORMS.has(tok) || CITIES.has(tok)) continue;
    tokens.push(tok);
  }
  return tokens.join(' ');
}

export function normName(s: string): string {
  return normMerchant(s);
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = cur;
  }
  return prev[b.length] ?? 0;
}

function similarity(x: string, y: string): number {
  const m = Math.max(x.length, y.length);
  return m === 0 ? 1 : 1 - levenshtein(x, y) / m;
}

/** Token-set similarity, 0..1 (M07 §4.6.3 name feature). */
export function tokenSetRatio(a: string, b: string): number {
  const ta = [...new Set(a.split(/\s+/).filter(Boolean))];
  const tb = [...new Set(b.split(/\s+/).filter(Boolean))];
  if (ta.length === 0 || tb.length === 0) return 0;
  const sb = new Set(tb);
  const sa = new Set(ta);
  const inter = ta.filter((x) => sb.has(x)).sort();
  const restA = ta.filter((x) => !sb.has(x)).sort();
  const restB = tb.filter((x) => !sa.has(x)).sort();
  const t0 = inter.join(' ');
  const t1 = [t0, ...restA].filter(Boolean).join(' ');
  const t2 = [t0, ...restB].filter(Boolean).join(' ');
  return Math.max(similarity(t0, t1), similarity(t0, t2), similarity(t1, t2));
}

/** Document keys: VS, digits of the document number (1–10 long), last 10 digits of it. */
export function docKeys(d: { documentNumber?: string; variableSymbol?: string }): string[] {
  const keys = new Set<string>();
  const vs = parseSymbol(d.variableSymbol);
  if (vs) keys.add(vs);
  if (d.documentNumber !== undefined) {
    const digits = d.documentNumber.replace(/\D/g, '');
    if (digits.length >= 1 && digits.length <= 10) {
      const k = parseSymbol(digits);
      if (k) keys.add(k);
    }
    if (digits.length > 0) {
      const k = parseSymbol(digits.slice(-10));
      if (k) keys.add(k);
    }
  }
  return [...keys].sort();
}

export function messageHasDocKey(message: string | undefined, d: { documentNumber?: string; variableSymbol?: string }): boolean {
  if (!message) return false;
  const folded = foldText(message);
  const keys = new Set(docKeys(d));
  for (const token of folded.split(/[^A-Z0-9]+/)) {
    if (token === '') continue;
    const value = /^\d+$/.test(token) ? parseSymbol(token) : token;
    if (value !== null && keys.has(value)) return true;
  }
  const number = d.documentNumber === undefined ? '' : foldText(d.documentNumber);
  if (number === '') return false;
  let from = 0;
  for (;;) {
    const at = folded.indexOf(number, from);
    if (at < 0) return false;
    const before = at === 0 ? '' : folded.charAt(at - 1);
    const after = folded.charAt(at + number.length);
    const boundaryBefore = before === '' || !/[A-Z0-9]/.test(before);
    const boundaryAfter = after === '' || !/[A-Z0-9]/.test(after);
    if (boundaryBefore && boundaryAfter) return true;
    from = at + 1;
  }
}
