import {
  CZ_DPHDP3_DERIVED_ROWS,
  CZ_DPHDP3_ROW_MAP,
  type Dphdp3Computation,
  type Dphdp3RowMap,
  type EpoHeader,
  formaCode,
  type Money,
} from '@shoebox/domain';
import { type AttrValue, dateAttr, intAttr, textAttr, type VetaNode, writePisemnost } from './xml';

export interface Dphdp3SerializeOptions {
  readonly verzePis: string;
  readonly rowMap?: Dphdp3RowMap;
  readonly derived?: typeof CZ_DPHDP3_DERIVED_ROWS;
  readonly row66?: Money;
}

type VetaName = 'Veta1' | 'Veta2' | 'Veta4' | 'Veta5' | 'Veta6';
const BODY_VETY: readonly VetaName[] = ['Veta1', 'Veta2', 'Veta4', 'Veta5'];

export function vetaOfRow(row: string): 'Veta1' | 'Veta2' | 'Veta4' | 'Veta5' | 'Veta6' {
  const n = Number.parseInt(row, 10);
  if (n >= 1 && n <= 19) return 'Veta1';
  if (n >= 20 && n <= 39) return 'Veta2';
  if (n >= 40 && n <= 49) return 'Veta4';
  if (n >= 50 && n <= 59) return 'Veta5';
  if (n >= 60 && n <= 69) return 'Veta6';
  throw new Error(`dphdp3: row ${row} is outside 1-69`);
}

const nonZero = (m: Money | undefined): boolean => m !== undefined && !m.isZero();
const amt = (m: Money | undefined): AttrValue => (m === undefined ? null : intAttr(m));

// Amounts of one row: source and derived rows from the computation; 62–65 are the return totals, 66 comes from options.
function amountsOf(
  c: Dphdp3Computation,
  row: string,
  row66: Money | undefined,
): { base?: Money; tax?: Money } {
  switch (row) {
    case '62':
      return { tax: c.row62 };
    case '63':
      return { tax: c.row63 };
    case '64':
      return { tax: c.row64 };
    case '65':
      return { tax: c.row65 };
    case '66':
      return row66 === undefined ? {} : { tax: row66 };
    default: {
      const v = c.rows[row];
      return v === undefined ? {} : { base: v.base, tax: v.tax };
    }
  }
}

export function serializeDphdp3(
  c: Dphdp3Computation,
  h: EpoHeader,
  opts: Dphdp3SerializeOptions,
): string {
  if (h.form !== 'DPHDP3') throw new Error('dphdp3: header form mismatch');
  const forma = formaCode(h.form, h.kind);
  if (forma === null) throw new Error(`dphdp3: no form code for ${h.kind}`);
  const rowMap = opts.rowMap ?? CZ_DPHDP3_ROW_MAP;
  const derived = opts.derived ?? CZ_DPHDP3_DERIVED_ROWS;

  // Row -> attrs, in row-map order, then derived rows.
  const specs = new Map<string, readonly string[] | undefined>();
  for (const entry of rowMap) {
    if (!specs.has(entry.row) || specs.get(entry.row) === undefined) {
      specs.set(entry.row, entry.attrs);
    }
  }
  for (const d of derived) specs.set(d.row, d.attrs);

  const vetaAttrs: Record<VetaName, Array<readonly [string, AttrValue]>> = {
    Veta1: [],
    Veta2: [],
    Veta4: [],
    Veta5: [],
    Veta6: [],
  };
  for (const [row, attrs] of specs) {
    const a = amountsOf(c, row, opts.row66);
    const any = nonZero(a.base) || nonZero(a.tax);
    if (attrs === undefined) {
      if (any) throw new Error(`dphdp3: row ${row} has no attrs`);
      continue;
    }
    const target = vetaAttrs[vetaOfRow(row)];
    if (attrs.length === 1) {
      target.push([attrs[0] as string, amt(a.tax)]);
    } else {
      target.push([attrs[0] as string, amt(a.base)], [attrs[1] as string, amt(a.tax)]);
    }
  }
  for (const row of Object.keys(c.rows)) {
    if (specs.has(row)) continue;
    const a = amountsOf(c, row, undefined);
    if (nonZero(a.base) || nonZero(a.tax)) throw new Error(`dphdp3: row ${row} has no attrs`);
  }

  // Nil return: Veta6 is always written, and its tax attribute is "0".
  if (vetaAttrs.Veta6.every(([, v]) => v === null)) {
    vetaAttrs.Veta6 = vetaAttrs.Veta6.map(([name, v]) =>
      name === 'dano_da' ? ([name, '0'] as const) : ([name, v] as const),
    );
  }

  const taxpayer = h.taxpayer;
  const vety: VetaNode[] = [
    {
      name: 'VetaD',
      attrs: [
        ['dokument', 'DP3'],
        ['k_uladis', 'DPH'],
        ['dapdph_forma', forma],
        ['typ_platce', h.status === 'platce' ? 'P' : 'I'],
        ['rok', String(h.period.year)],
        ['mesic', h.period.month === undefined ? null : String(h.period.month)],
        ['ctvrt', h.period.quarter === undefined ? null : String(h.period.quarter)],
        ['trans', c.trans],
        ['c_okec', textAttr(h.naceCode6)],
        ['d_poddp', dateAttr(h.preparedOn)],
        ['d_zjist', h.discoveredOn === undefined ? null : dateAttr(h.discoveredOn)],
      ],
    },
    {
      name: 'VetaP',
      attrs: [
        ['c_ufo', textAttr(taxpayer.fuCode)],
        ['c_pracufo', textAttr(taxpayer.ufoCode)],
        ['dic', textAttr(taxpayer.dicDigits)],
        ['typ_ds', 'F'],
        ['jmeno', textAttr(taxpayer.firstName)],
        ['prijmeni', textAttr(taxpayer.lastName)],
        ['titul', textAttr(taxpayer.title)],
        ['ulice', textAttr(taxpayer.street)],
        ['c_pop', textAttr(taxpayer.houseNumber)],
        ['c_orient', textAttr(taxpayer.orientationNumber)],
        ['naz_obce', textAttr(taxpayer.city)],
        ['psc', textAttr(taxpayer.zip)],
        ['stat', 'ČESKÁ REPUBLIKA'],
        ['email', textAttr(taxpayer.email)],
        ['c_telef', textAttr(taxpayer.phone)],
      ],
    },
  ];
  for (const name of BODY_VETY) {
    const attrs = vetaAttrs[name].filter(([, v]) => v !== null);
    if (attrs.length > 0) vety.push({ name, attrs });
  }
  vety.push({ name: 'Veta6', attrs: vetaAttrs.Veta6 });

  return writePisemnost({ form: h.form, verzePis: opts.verzePis, appVersion: h.appVersion, vety });
}
