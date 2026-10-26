import { czAccountValid, czDicValid, ibanValid, icoChecksumValid } from '@shoebox/validation';

export interface CzAccount {
  readonly prefix: string | null;
  readonly number: string;
  readonly bankCode: string;
}

export interface TextIdentifiers {
  readonly icos: readonly string[];
  readonly dics: readonly string[];
  readonly ibans: readonly string[];
  readonly accounts: readonly CzAccount[];
  readonly variableSymbols: readonly string[];
  readonly supplierIco: string | null;
  readonly supplierDic: string | null;
}

/** Lowercase, diacritics removed. Used for every regex except IBAN. */
export function foldText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

const ICO_PATTERN = /\bico?\b\s*[:.]?\s*(\d(?:\s?\d){5,7})(?!\d)/g;
const ICO_BOOKING_WORDS = /ubytovani|objednav|zakaznick|klient|pod cislem|registr|cislo uctu/;
const DIC_PATTERN =
  /\b(?:dic|vat(?:\s?(?:id|no\.?|number))?|ic dph|tax id|ust-?id(?:nr)?|btw)\b\s*[:.]?\s*([a-z]{2}\s?[0-9a-z]{2,13})/g;
const VARIABLE_SYMBOL_PATTERN =
  /\b(?:vs|var\.?\s*symbol|variabilni\s+symbol)\b\s*[:.]?\s*(\d{1,10})\b/g;
const ACCOUNT_PATTERN = /(?<![\d-])(?:(\d{1,6})-)?(\d{2,10})\s?\/\s?(\d{4})(?!\d)/g;
const IBAN_PATTERN = /\b([A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?)\b/g;

function stripSpaces(value: string): string {
  return value.replace(/\s/g, '');
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function isValidForeignVat(value: string): boolean {
  return /^[A-Z]{2}[0-9A-Z]{2,13}$/.test(value) && (value.match(/\d/g)?.length ?? 0) >= 2;
}

function isValidDic(value: string): boolean {
  return value.startsWith('CZ') ? czDicValid(value) : isValidForeignVat(value);
}

function pickSupplier(values: readonly string[], own: string | null): string | null {
  const others = values.filter((value) => value !== own);
  return others.length === 1 ? (others[0] ?? null) : null;
}

export function findIdentifiers(
  text: string,
  org: { readonly ico: string | null; readonly dic: string | null },
): TextIdentifiers {
  const folded = foldText(text);
  const ownIco = org.ico ? stripSpaces(org.ico).padStart(8, '0') : null;
  const ownDic = org.dic ? stripSpaces(org.dic).toUpperCase() : null;

  const icos: string[] = [];
  for (const match of folded.matchAll(ICO_PATTERN)) {
    const start = match.index ?? 0;
    const before = folded.slice(Math.max(0, start - 25), start);
    if (ICO_BOOKING_WORDS.test(before)) continue;
    const ico = stripSpaces(match[1] ?? '').padStart(8, '0');
    if (icoChecksumValid(ico)) icos.push(ico);
  }

  const dics: string[] = [];
  for (const match of folded.matchAll(DIC_PATTERN)) {
    const dic = stripSpaces(match[1] ?? '').toUpperCase();
    if (isValidDic(dic)) dics.push(dic);
  }

  const accounts: CzAccount[] = [];
  const seenAccounts = new Set<string>();
  for (const match of folded.matchAll(ACCOUNT_PATTERN)) {
    const prefix = match[1] ?? null;
    const number = match[2] ?? '';
    const bankCode = match[3] ?? '';
    const key = `${prefix}|${number}|${bankCode}`;
    if (seenAccounts.has(key) || !czAccountValid(prefix, number, bankCode)) continue;
    seenAccounts.add(key);
    accounts.push({ prefix, number, bankCode });
  }

  const ibans: string[] = [];
  for (const match of text.toUpperCase().matchAll(IBAN_PATTERN)) {
    const iban = stripSpaces(match[1] ?? '');
    if (ibanValid(iban)) ibans.push(iban);
  }

  const variableSymbols: string[] = [];
  for (const match of folded.matchAll(VARIABLE_SYMBOL_PATTERN)) {
    if (match[1]) variableSymbols.push(match[1]);
  }

  const distinctIcos = unique(icos);
  const distinctDics = unique(dics);

  return {
    icos: distinctIcos,
    dics: distinctDics,
    ibans: unique(ibans),
    accounts,
    variableSymbols: unique(variableSymbols),
    supplierIco: pickSupplier(distinctIcos, ownIco),
    supplierDic: pickSupplier(distinctDics, ownDic),
  };
}
