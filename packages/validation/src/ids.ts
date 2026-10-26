import { icoChecksumValid } from './proto-checks/checks';

const ACCOUNT_WEIGHTS = [6, 3, 7, 9, 10, 5, 8, 4, 2, 1] as const;

const IBAN_LENGTHS: Readonly<Record<string, number>> = {
  CZ: 24,
  SK: 24,
  DE: 22,
  IE: 22,
  NL: 18,
  AT: 20,
  PL: 28,
  GB: 22,
  FR: 27,
  IT: 27,
  ES: 24,
  BE: 16,
  LU: 20,
  HU: 28,
};

/** Weighted mod-11 check on one account part, right-aligned to 10 digits. */
function accountPartValid(digits: string): boolean {
  const padded = digits.padStart(10, '0');
  let sum = 0;
  for (let i = 0; i < 10; i += 1) {
    sum += Number(padded[i]) * (ACCOUNT_WEIGHTS[i] ?? 0);
  }
  return sum % 11 === 0;
}

/** Czech account `prefix-number/bank`. Prefix is optional (null). */
export function czAccountValid(prefix: string | null, number: string, bankCode: string): boolean {
  if (!/^\d{4}$/.test(bankCode)) return false;
  if (!/^\d{2,10}$/.test(number)) return false;
  if (number.replace(/0/g, '').length < 2) return false;
  if (!accountPartValid(number)) return false;
  if (prefix === null) return true;
  if (!/^\d{1,6}$/.test(prefix)) return false;
  return accountPartValid(prefix);
}

/** Converts an IBAN to its numeric form (letters A=10 .. Z=35) and reduces mod 97. */
function mod97(numeric: string): number {
  let remainder = 0;
  for (const ch of numeric) {
    const value = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of value) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder;
}

/** IBAN with spaces removed and case ignored; length table for known countries, mod 97 check. */
export function ibanValid(iban: string): boolean {
  const normalized = iban.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(normalized)) return false;
  const country = normalized.slice(0, 2);
  const expected = IBAN_LENGTHS[country];
  if (expected !== undefined) {
    if (normalized.length !== expected) return false;
  } else if (normalized.length < 15 || normalized.length > 34) {
    return false;
  }
  const rearranged = normalized.slice(4) + normalized.slice(0, 4);
  return mod97(rearranged) === 1;
}

/** CZ IBAN built from a valid account; null when the account is not valid. */
export function czAccountToIban(
  prefix: string | null,
  number: string,
  bankCode: string,
): string | null {
  if (!czAccountValid(prefix, number, bankCode)) return null;
  const bban = `${bankCode}${(prefix ?? '').padStart(6, '0')}${number.padStart(10, '0')}`;
  const check = String(98 - mod97(`${bban}CZ00`)).padStart(2, '0');
  return `CZ${check}${bban}`;
}

/** DIČ like `CZ25596641`. Spaces are removed and the input uppercased first. */
export function czDicValid(dic: string): boolean {
  const normalized = dic.replace(/\s/g, '').toUpperCase();
  if (!normalized.startsWith('CZ')) return false;
  const rest = normalized.slice(2);
  if (/^\d{8}$/.test(rest)) return icoChecksumValid(rest);
  if (/^\d{9}$/.test(rest)) return true;
  if (/^\d{10}$/.test(rest)) {
    if (rest.startsWith('699')) return true;
    const remainder = Number(rest) % 11;
    return remainder === 0 || (remainder === 10 && rest[9] === '0');
  }
  return false;
}

/** Valid IČOs one digit change or one adjacent swap away, sorted, never the input itself. Input must be 8 digits, else []. */
export function icoRepairCandidates(ico: string): string[] {
  if (!/^\d{8}$/.test(ico)) return [];
  const found = new Set<string>();
  const consider = (candidate: string): void => {
    if (candidate !== ico && icoChecksumValid(candidate)) found.add(candidate);
  };
  for (let i = 0; i < 8; i += 1) {
    for (let d = 0; d <= 9; d += 1) {
      consider(`${ico.slice(0, i)}${d}${ico.slice(i + 1)}`);
    }
  }
  for (let i = 0; i < 7; i += 1) {
    const swapped = `${ico.slice(0, i)}${ico[i + 1]}${ico[i]}${ico.slice(i + 2)}`;
    consider(swapped);
  }
  return [...found].sort();
}
