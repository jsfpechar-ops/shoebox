import {
  type EpoHeader,
  formaCode,
  type KhA2Row,
  type KhA4Row,
  type KhAggregate,
  type KhB2Row,
  type KhComputation,
  type KhVetaC,
  type Money,
} from '@shoebox/domain';
import { type AttrValue, dateAttr, dec2Attr, textAttr, type VetaNode, writePisemnost } from './xml';

export interface KhSerializeOptions {
  readonly verzePis: string;
}

interface KhAmountsLike {
  readonly zaklDane1: Money;
  readonly dan1: Money;
  readonly zaklDane2: Money;
  readonly dan2: Money;
}

// Two-decimal amounts; zero attributes are omitted.
function amountAttrs(a: KhAmountsLike): Array<readonly [string, AttrValue]> {
  return [
    ['zakl_dane1', dec2Attr(a.zaklDane1)],
    ['dan1', dec2Attr(a.dan1)],
    ['zakl_dane2', dec2Attr(a.zaklDane2)],
    ['dan2', dec2Attr(a.dan2)],
  ];
}

const allNull = (attrs: ReadonlyArray<readonly [string, AttrValue]>): boolean =>
  attrs.every(([, v]) => v === null);

// VetaP is shared with DPHSHV (same taxpayer block as DPHDP3, 0338 order).
export function vetaPOf(h: EpoHeader): VetaNode {
  const t = h.taxpayer;
  return {
    name: 'VetaP',
    attrs: [
      ['c_ufo', textAttr(t.fuCode)],
      ['c_pracufo', textAttr(t.ufoCode)],
      ['dic', textAttr(t.dicDigits)],
      ['typ_ds', 'F'],
      ['jmeno', textAttr(t.firstName)],
      ['prijmeni', textAttr(t.lastName)],
      ['titul', textAttr(t.title)],
      ['ulice', textAttr(t.street)],
      ['c_pop', textAttr(t.houseNumber)],
      ['c_orient', textAttr(t.orientationNumber)],
      ['naz_obce', textAttr(t.city)],
      ['psc', textAttr(t.zip)],
      ['stat', 'ČESKÁ REPUBLIKA'],
      ['email', textAttr(t.email)],
      ['c_telef', textAttr(t.phone)],
    ],
  };
}

function vetaA2(r: KhA2Row): VetaNode {
  return {
    name: 'VetaA2',
    attrs: [
      ['c_radku', String(r.cRadku)],
      ['k_stat', r.kStat],
      ['vatid_dod', r.vatidDod],
      ['c_evid_dd', r.cEvidDd],
      ['dppd', dateAttr(r.dppd)],
      ...amountAttrs(r),
    ],
  };
}

function vetaA4(r: KhA4Row): VetaNode {
  return {
    name: 'VetaA4',
    attrs: [
      ['c_radku', String(r.cRadku)],
      ['dic_odb', r.dicOdb],
      ['c_evid_dd', r.cEvidDd],
      ['dppd', dateAttr(r.dppd)],
      ...amountAttrs(r),
      ['kod_rezim_pl', r.kodRezimPl],
      ['zdph_44', r.zdph44],
    ],
  };
}

function vetaB2(r: KhB2Row): VetaNode {
  return {
    name: 'VetaB2',
    attrs: [
      ['c_radku', String(r.cRadku)],
      ['dic_dod', r.dicDod],
      ['c_evid_dd', r.cEvidDd],
      ['dppd', dateAttr(r.dppd)],
      ...amountAttrs(r),
      ['pomer', r.pomer],
      ['zdph_44', r.zdph44],
    ],
  };
}

// VetaA5 / VetaB3: omitted when null or all-zero.
function aggregateVeta(name: 'VetaA5' | 'VetaB3', a: KhAggregate | null): VetaNode | null {
  if (a === null) return null;
  const attrs = amountAttrs(a);
  return allNull(attrs) ? null : { name, attrs };
}

// VetaC: whole-Kč values with two decimals; omitted only when every value is zero.
function vetaC(c: KhVetaC): VetaNode | null {
  const attrs: Array<readonly [string, AttrValue]> = [
    ['obrat23', dec2Attr(c.obrat23)],
    ['obrat5', dec2Attr(c.obrat5)],
    ['pln23', dec2Attr(c.pln23)],
    ['pln5', dec2Attr(c.pln5)],
    ['celk_zd_a2', dec2Attr(c.celkZdA2)],
  ];
  return allNull(attrs) ? null : { name: 'VetaC', attrs };
}

export function serializeKh(c: KhComputation, h: EpoHeader, opts: KhSerializeOptions): string {
  if (h.form !== 'DPHKH1') throw new Error('kh: header form mismatch');
  const forma = formaCode(h.form, h.kind);
  if (forma === null) throw new Error(`kh: no form code for ${h.kind}`);

  const vety: VetaNode[] = [
    {
      name: 'VetaD',
      attrs: [
        ['dokument', 'KH1'],
        ['k_uladis', 'DPH'],
        ['khdph_forma', forma],
        ['rok', String(h.period.year)],
        ['mesic', h.period.month === undefined ? null : String(h.period.month)],
        ['ctvrt', h.period.quarter === undefined ? null : String(h.period.quarter)],
        ['d_poddp', dateAttr(h.preparedOn)],
        [
          'd_zjist',
          h.kind === 'nasledne' && h.discoveredOn !== undefined ? dateAttr(h.discoveredOn) : null,
        ],
      ],
    },
    vetaPOf(h),
    ...c.a2.map(vetaA2),
    ...c.a4.map(vetaA4),
  ];

  const a5 = aggregateVeta('VetaA5', c.a5);
  if (a5 !== null) vety.push(a5);
  vety.push(...c.b2.map(vetaB2));
  const b3 = aggregateVeta('VetaB3', c.b3);
  if (b3 !== null) vety.push(b3);
  const vetaCNode = vetaC(c.c);
  if (vetaCNode !== null) vety.push(vetaCNode);

  return writePisemnost({ form: h.form, verzePis: opts.verzePis, appVersion: h.appVersion, vety });
}
