import { type EpoHeader, formaCode, type ShvComputation, type ShvRow } from '@shoebox/domain';
import { vetaPOf } from './kh';
import { dateAttr, intAttr, type VetaNode, writePisemnost } from './xml';

export interface ShvSerializeOptions {
  readonly verzePis: string;
}

function vetaR(r: ShvRow): VetaNode {
  return {
    name: 'VetaR',
    attrs: [
      ['c_rad', String(r.cRad)],
      ['por_c_stran', String(r.porCStran)],
      ['k_stat', r.kStat],
      ['c_vat', r.cVat],
      ['k_pln_eu', String(r.kPlnEu)],
      ['pln_pocet', String(r.plnPocet)],
      ['pln_hodnota', intAttr(r.plnHodnota)],
    ],
  };
}

export function serializeShv(c: ShvComputation, h: EpoHeader, opts: ShvSerializeOptions): string {
  if (h.form !== 'DPHSHV') throw new Error('shv: header form mismatch');
  const forma = formaCode(h.form, h.kind);
  if (forma === null) throw new Error(`shv: no form code for ${h.kind}`);

  const vety: VetaNode[] = [
    {
      name: 'VetaD',
      attrs: [
        ['dokument', 'SHV'],
        ['k_uladis', 'DPH'],
        ['shvies_forma', forma],
        ['rok', String(h.period.year)],
        ['mesic', h.period.month === undefined ? null : String(h.period.month)],
        ['d_poddp', dateAttr(h.preparedOn)],
      ],
    },
    vetaPOf(h),
    ...c.rows.map(vetaR),
  ];

  return writePisemnost({ form: h.form, verzePis: opts.verzePis, appVersion: h.appVersion, vety });
}
