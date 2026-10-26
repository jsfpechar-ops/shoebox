import type { CzRules, FlatRate, Money } from '@shoebox/domain';
import { intAttr, textAttr, type VetaNode, writePisemnost } from './xml';

export interface DpfHeader {
  readonly fuCode: string | null;
  readonly ufoCode: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly title: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly nace: string | null;
  readonly address: {
    readonly city: string | null;
    readonly street: string | null;
    readonly number: string | null;
    readonly zip: string | null;
    readonly country: string | null;
  } | null;
}

export interface Dpfdp7PartialInput {
  readonly year: number;
  readonly header: DpfHeader;
  readonly income: Money;
  readonly flat: Money;
  readonly rate: FlatRate;
  readonly appVersion: string;
}

interface Dpfdp7Entry {
  readonly verze_pis: string;
  readonly tax_years?: readonly number[] | undefined;
}

const RC_FORMAT = /^\d{6}\/?\d{3,4}$/;
const RC_ANY = /\d{6}\/?\d{3,4}/g;

// Digits only: 9 digits (pre-1954) carry no checksum; 10 digits must be divisible by 11,
// or give remainder 10 with a last digit 0 (pre-1986 exception) [verify].
export function validateRodneCislo(
  input: string,
): { readonly normalized: string; readonly checksumOk: boolean } | { readonly error: 'format' } {
  if (!RC_FORMAT.test(input)) return { error: 'format' };
  const normalized = input.replace('/', '');
  if (normalized.length === 9) return { normalized, checksumOk: true };
  const mod = Number.parseInt(normalized, 10) % 11;
  const checksumOk = mod === 0 || (mod === 10 && normalized.endsWith('0'));
  return { normalized, checksumOk };
}

export function redactRodneCislo(text: string): string {
  return text.replace(RC_ANY, '***');
}

// The DPFDP7 entry of epo.forms, read at the start of the tax year.
function dpfdp7Entry(rules: CzRules, year: number): Dpfdp7Entry {
  const forms = rules.at(`${year}-01-01`).get('epo.forms') as Record<
    string,
    Partial<Dpfdp7Entry> | undefined
  >;
  const entry = forms.DPFDP7;
  if (!entry || typeof entry.verze_pis !== 'string') {
    throw new Error('dpfdp7: epo.forms.DPFDP7 missing');
  }
  return { verze_pis: entry.verze_pis, tax_years: entry.tax_years };
}

// Pure: builds the XML string, never logs. income and flat must be whole Kč (intAttr throws).
export function serializeDpfdp7Partial(
  input: Dpfdp7PartialInput,
  rodneCislo: string,
  rules: CzRules,
): string {
  const rc = validateRodneCislo(rodneCislo);
  if ('error' in rc) throw new Error('dpfdp7: invalid rodné číslo');
  const h = input.header;
  const addr = h.address;
  const vety: VetaNode[] = [
    {
      name: 'VetaD',
      attrs: [
        ['dokument', 'DP7'],
        ['k_uladis', 'DPF'],
        ['rok', String(input.year)],
        ['dap_typ', 'B'],
        ['pln_moc', 'N'],
        ['audit', 'N'],
        ['c_ufo_cil', textAttr(h.fuCode)],
      ],
    },
    {
      name: 'VetaP',
      attrs: [
        ['c_pracufo', textAttr(h.ufoCode)],
        ['rod_c', rc.normalized],
        ['jmeno', textAttr(h.firstName)],
        ['prijmeni', textAttr(h.lastName)],
        ['titul', textAttr(h.title)],
        ['email', textAttr(h.email)],
        ['c_telef', textAttr(h.phone)],
        ['naz_obce', textAttr(addr?.city)],
        ['ulice', textAttr(addr?.street)],
        ['c_pop', textAttr(addr?.number)],
        ['psc', textAttr(addr?.zip)],
        ['stat', textAttr(addr?.country)],
      ],
    },
    {
      name: 'VetaT',
      attrs: [
        ['c_nace', textAttr(h.nace)],
        ['kc_prij7', intAttr(input.income)],
        ['kc_vyd7', intAttr(input.flat)],
        ['pr_sazba', String(input.rate)],
        ['vyd7proc', 'A'],
      ],
    },
  ];
  return writePisemnost({
    form: 'DPFDP7',
    verzePis: dpfdp7Entry(rules, input.year).verze_pis,
    appVersion: input.appVersion,
    vety,
  });
}

// Available only for years whose XSD is vendored (epo.forms.DPFDP7.tax_years).
export function isPartialXmlAvailable(year: number, rules: CzRules): boolean {
  return dpfdp7Entry(rules, year).tax_years?.includes(year) ?? false;
}

export function dpfdp7FileName(year: number): string {
  return `DPFDP7-${year}-castecne.xml`;
}
