export type EpoForm = 'DPHDP3' | 'DPHKH1' | 'DPHSHV' | 'DPFDP7';

export interface VetaRule {
  readonly name: string;
  readonly min: number;
  readonly max: number | null;
  readonly attrs: readonly string[] | null;
  readonly required: readonly string[];
  readonly oneOf?: readonly string[];
}

const VETA_D_DPHDP3 = [
  'dokument',
  'k_uladis',
  'dapdph_forma',
  'typ_platce',
  'rok',
  'mesic',
  'ctvrt',
  'trans',
  'c_okec',
  'd_poddp',
  'd_zjist',
  'kod_zo',
  'zdobd_od',
  'zdobd_do',
  'd_por_dod',
];
const VETA_P_BASE = [
  'c_ufo',
  'c_pracufo',
  'dic',
  'typ_ds',
  'jmeno',
  'prijmeni',
  'titul',
  'ulice',
  'c_pop',
  'c_orient',
  'naz_obce',
  'psc',
  'stat',
  'email',
  'c_telef',
];

export const FORM_RULES: Readonly<Record<EpoForm, readonly VetaRule[]>> = {
  DPHDP3: [
    {
      name: 'VetaD',
      min: 1,
      max: 1,
      attrs: VETA_D_DPHDP3,
      required: ['dokument', 'k_uladis', 'dapdph_forma', 'typ_platce', 'rok'],
      oneOf: ['mesic', 'ctvrt'],
    },
    { name: 'VetaP', min: 1, max: 1, attrs: VETA_P_BASE, required: ['c_ufo', 'dic'] },
    {
      name: 'Veta1',
      min: 0,
      max: 1,
      attrs: [
        'obrat23',
        'dan23',
        'obrat5',
        'dan5',
        'p_zb23',
        'dan_pzb23',
        'p_zb5',
        'dan_pzb5',
        'p_sl23_e',
        'dan_psl23_e',
        'p_sl5_e',
        'dan_psl5_e',
        'rez_pren23',
        'dan_rpren23',
        'rez_pren5',
        'dan_rpren5',
        'p_sl23_z',
        'dan_psl23_z',
        'p_sl5_z',
        'dan_psl5_z',
      ],
      required: [],
    },
    {
      name: 'Veta2',
      min: 0,
      max: 1,
      attrs: ['dod_zb', 'pln_sluzby', 'pln_vyvoz', 'pln_rez_pren', 'pln_ost'],
      required: [],
    },
    {
      name: 'Veta4',
      min: 0,
      max: 1,
      attrs: [
        'pln23',
        'odp_tuz23_nar',
        'odp_tuz23',
        'pln5',
        'odp_tuz5_nar',
        'odp_tuz5',
        'dov_cu',
        'odp_cu_nar',
        'odp_cu',
        'nar_zdp23',
        'od_zdp23',
        'odkr_zdp23',
        'nar_zdp5',
        'od_zdp5',
        'odkr_zdp5',
        'odp_sum_nar',
        'odp_sum_kr',
      ],
      required: [],
    },
    { name: 'Veta5', min: 0, max: 1, attrs: ['plnosv_nkf'], required: [] },
    {
      name: 'Veta6',
      min: 1,
      max: 1,
      attrs: ['dan_zocelk', 'odp_zocelk', 'dano_da', 'dano_no', 'dano'],
      required: [],
    },
  ],
  DPHKH1: [
    {
      name: 'VetaD',
      min: 1,
      max: 1,
      attrs: [
        'dokument',
        'k_uladis',
        'khdph_forma',
        'rok',
        'mesic',
        'ctvrt',
        'd_poddp',
        'd_zjist',
        'c_jed_vyzvy',
        'vyzva_odp',
        'zdobd_od',
        'zdobd_do',
      ],
      required: ['dokument', 'k_uladis', 'khdph_forma', 'rok'],
      oneOf: ['mesic', 'ctvrt'],
    },
    { name: 'VetaP', min: 1, max: 1, attrs: VETA_P_BASE, required: ['c_ufo', 'dic'] },
    {
      name: 'VetaA1',
      min: 0,
      max: null,
      attrs: ['c_radku', 'dic_odb', 'c_evid_dd', 'duzp', 'zakl_dane1', 'kod_pred_pl'],
      required: [],
    },
    {
      name: 'VetaA2',
      min: 0,
      max: null,
      attrs: [
        'c_radku',
        'k_stat',
        'vatid_dod',
        'c_evid_dd',
        'dppd',
        'zakl_dane1',
        'dan1',
        'zakl_dane2',
        'dan2',
        'zakl_dane3',
        'dan3',
      ],
      required: [],
    },
    {
      name: 'VetaA3',
      min: 0,
      max: null,
      attrs: [
        'c_radku',
        'dup',
        'osv_plneni',
        'c_evid_dd',
        'k_stat',
        'vatid_odb',
        'jm_prijm_obch',
        'd_narozeni',
        'm_pobytu_sidlo',
      ],
      required: [],
    },
    {
      name: 'VetaA4',
      min: 0,
      max: null,
      attrs: [
        'c_radku',
        'dic_odb',
        'c_evid_dd',
        'dppd',
        'zakl_dane1',
        'dan1',
        'zakl_dane2',
        'dan2',
        'zakl_dane3',
        'dan3',
        'kod_rezim_pl',
        'zdph_44',
      ],
      required: [],
    },
    {
      name: 'VetaA5',
      min: 0,
      max: 1,
      attrs: ['zakl_dane1', 'dan1', 'zakl_dane2', 'dan2', 'zakl_dane3', 'dan3'],
      required: [],
    },
    {
      name: 'VetaB1',
      min: 0,
      max: null,
      attrs: [
        'c_radku',
        'dic_dod',
        'c_evid_dd',
        'duzp',
        'kod_pred_pl',
        'zakl_dane1',
        'dan1',
        'zakl_dane2',
        'dan2',
        'zakl_dane3',
        'dan3',
      ],
      required: [],
    },
    {
      name: 'VetaB2',
      min: 0,
      max: null,
      attrs: [
        'c_radku',
        'dic_dod',
        'c_evid_dd',
        'dppd',
        'zakl_dane1',
        'dan1',
        'zakl_dane2',
        'dan2',
        'zakl_dane3',
        'dan3',
        'pomer',
        'zdph_44',
      ],
      required: [],
    },
    {
      name: 'VetaB3',
      min: 0,
      max: 1,
      attrs: ['zakl_dane1', 'dan1', 'zakl_dane2', 'dan2', 'zakl_dane3', 'dan3'],
      required: [],
    },
    {
      name: 'VetaC',
      min: 0,
      max: 1,
      attrs: [
        'obrat23',
        'obrat5',
        'pln23',
        'pln5',
        'pln_rez_pren',
        'rez_pren23',
        'rez_pren5',
        'celk_zd_a2',
      ],
      required: [],
    },
  ],
  DPHSHV: [
    {
      name: 'VetaD',
      min: 1,
      max: 1,
      attrs: ['dokument', 'k_uladis', 'shvies_forma', 'rok', 'mesic', 'ctvrt', 'd_poddp'],
      required: ['dokument', 'k_uladis', 'shvies_forma', 'rok', 'mesic'],
    },
    {
      name: 'VetaP',
      min: 1,
      max: 1,
      attrs: [...VETA_P_BASE, 'dodobchjm'],
      required: ['c_ufo', 'dic'],
    },
    {
      name: 'VetaR',
      min: 0,
      max: null,
      attrs: [
        'c_rad',
        'por_c_stran',
        'k_stat',
        'c_vat',
        'k_pln_eu',
        'pln_pocet',
        'pln_hodnota',
        'k_storno',
      ],
      required: [],
    },
    { name: 'VetaS', min: 0, max: null, attrs: null, required: [] },
  ],
  DPFDP7: [
    {
      name: 'VetaD',
      min: 1,
      max: 1,
      attrs: [
        'dokument',
        'k_uladis',
        'rok',
        'dap_typ',
        'pln_moc',
        'audit',
        'c_ufo_cil',
        'c_pracufo',
      ],
      required: ['dokument', 'k_uladis', 'rok', 'dap_typ'],
    },
    {
      name: 'VetaP',
      min: 1,
      max: 1,
      attrs: [
        'rod_c',
        'jmeno',
        'prijmeni',
        'titul',
        'email',
        'c_telef',
        'naz_obce',
        'ulice',
        'c_pop',
        'psc',
        'stat',
      ],
      required: ['rod_c', 'prijmeni', 'jmeno'],
    },
    {
      name: 'VetaT',
      min: 1,
      max: 1,
      attrs: ['c_nace', 'kc_prij7', 'kc_vyd7', 'pr_sazba', 'vyd7proc'],
      required: ['kc_prij7'],
    },
  ],
};

const DATE_ATTRS = 'd_poddp|d_zjist|dppd|duzp|dup|d_narozeni|zdobd_od|zdobd_do';
const DPHDP3_AMOUNT_ATTRS = FORM_RULES.DPHDP3.filter(
  (r) => r.name !== 'VetaD' && r.name !== 'VetaP',
).flatMap((r) => r.attrs ?? []);

export const VALUE_PATTERNS: ReadonlyArray<{
  readonly form: EpoForm | 'any';
  readonly attr: RegExp;
  readonly value: RegExp;
}> = [
  { form: 'any', attr: new RegExp(`^(${DATE_ATTRS})$`), value: /^\d{2}\.\d{2}\.\d{4}$/ },
  { form: 'any', attr: /^(dic|dic_odb|dic_dod)$/, value: /^[0-9]{1,10}$/ },
  { form: 'any', attr: /^rok$/, value: /^\d{4}$/ },
  { form: 'any', attr: /^mesic$/, value: /^([1-9]|1[0-2])$/ },
  { form: 'any', attr: /^ctvrt$/, value: /^[1-4]$/ },
  { form: 'DPHDP3', attr: new RegExp(`^(${DPHDP3_AMOUNT_ATTRS.join('|')})$`), value: /^-?\d+$/ },
  { form: 'DPHKH1', attr: /^(zakl_dane|dan|obrat|pln|rez_pren|celk_zd)/, value: /^-?\d+\.\d{2}$/ },
  { form: 'DPHSHV', attr: /^pln_hodnota$/, value: /^-?\d+$/ },
  { form: 'DPFDP7', attr: /^rod_c$/, value: /^\d{9,10}$/ },
  { form: 'DPFDP7', attr: /^(kc_prij7|kc_vyd7)$/, value: /^-?\d+$/ },
  { form: 'DPFDP7', attr: /^pr_sazba$/, value: /^(80|60|40|30)$/ },
];

export interface ParsedVeta {
  readonly name: string;
  readonly attrs: Record<string, string>;
  readonly line: number;
}

export interface ParsedPisemnost {
  readonly rootAttrs: Record<string, string>;
  readonly form: string;
  readonly formAttrs: Record<string, string>;
  readonly vety: readonly ParsedVeta[];
}

const NOT_EPO = 'tax-xml: not an EPO document';
const EPO_FORMS: readonly string[] = ['DPHDP3', 'DPHKH1', 'DPHSHV', 'DPFDP7'];
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function unescapeXml(value: string): string {
  return value.replace(
    /&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g,
    (_match, entity: string) => {
      if (entity.startsWith('#x'))
        return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
      if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
      return NAMED_ENTITIES[entity] ?? '';
    },
  );
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of raw.matchAll(/([A-Za-z_][A-Za-z0-9_.-]*)="([^"]*)"/g)) {
    attrs[m[1] ?? ''] = unescapeXml(m[2] ?? '');
  }
  return attrs;
}

function lineAt(xml: string, index: number): number {
  return xml.slice(0, index).split('\n').length;
}

// Parses the restricted EPO shape: one root, one form element, self-closing Věty.
export function parseEpoXml(xml: string): ParsedPisemnost {
  const root = /<Pisemnost\b([^>]*)>/.exec(xml);
  if (!root || !xml.includes('</Pisemnost>')) throw new Error(NOT_EPO);
  const bodyStart = root.index + root[0].length;

  const formTag = /\s*<([A-Za-z0-9]+)((?:\s+[A-Za-z_][A-Za-z0-9_.-]*="[^"]*")*)\s*>/y;
  formTag.lastIndex = bodyStart;
  const fm = formTag.exec(xml);
  if (!fm || !EPO_FORMS.includes(fm[1] ?? '')) throw new Error(NOT_EPO);
  const form = fm[1] ?? '';
  const innerStart = fm.index + fm[0].length;
  const innerEnd = xml.indexOf(`</${form}>`, innerStart);
  if (innerEnd < 0) throw new Error(NOT_EPO);

  const vety: ParsedVeta[] = [];
  for (const m of xml
    .slice(innerStart, innerEnd)
    .matchAll(/<([A-Za-z][A-Za-z0-9_]*)((?:\s+[A-Za-z_][A-Za-z0-9_.-]*="[^"]*")*)\s*(\/?)>/g)) {
    if (m[3] !== '/') throw new Error(NOT_EPO);
    vety.push({
      name: m[1] ?? '',
      attrs: parseAttrs(m[2] ?? ''),
      line: lineAt(xml, innerStart + (m.index ?? 0)),
    });
  }

  return { rootAttrs: parseAttrs(root[1] ?? ''), form, formAttrs: parseAttrs(fm[2] ?? ''), vety };
}

export interface StructuralError {
  readonly line: number | null;
  readonly element: string | null;
  readonly message: string;
}

// Checks a parsed document against the form's Věta rules and value formats.
export function checkStructure(doc: ParsedPisemnost, form: EpoForm): StructuralError[] {
  if (doc.form !== form) {
    return [
      {
        line: null,
        element: doc.form,
        message: `root form element is ${doc.form}, expected ${form}`,
      },
    ];
  }
  const rules = FORM_RULES[form];
  const ruleIndex = new Map(rules.map((r, i) => [r.name, i] as const));
  const counts = new Map<string, number>();
  const errors: StructuralError[] = [];
  let lastIndex = -1;

  for (const veta of doc.vety) {
    const idx = ruleIndex.get(veta.name);
    if (idx === undefined) {
      errors.push({
        line: veta.line,
        element: veta.name,
        message: `unknown Věta ${veta.name} in ${form}`,
      });
      continue;
    }
    if (idx < lastIndex) {
      errors.push({
        line: veta.line,
        element: veta.name,
        message: `Věta ${veta.name} is out of order`,
      });
    }
    lastIndex = Math.max(lastIndex, idx);

    const rule = rules[idx];
    if (!rule) continue;
    const seen = (counts.get(veta.name) ?? 0) + 1;
    counts.set(veta.name, seen);
    if (rule.max !== null && seen > rule.max) {
      errors.push({
        line: veta.line,
        element: veta.name,
        message: `Věta ${veta.name} appears ${seen} times, maximum is ${rule.max}`,
      });
    }

    if (rule.attrs !== null) {
      for (const name of Object.keys(veta.attrs)) {
        if (!rule.attrs.includes(name)) {
          errors.push({
            line: veta.line,
            element: veta.name,
            message: `Element ${veta.name}, attribute '${name}' is not allowed`,
          });
        }
      }
      for (const req of rule.required) {
        if (!(req in veta.attrs)) {
          errors.push({
            line: veta.line,
            element: veta.name,
            message: `Věta ${veta.name}: required attribute ${req} is missing`,
          });
        }
      }
      if (rule.oneOf) {
        const present = rule.oneOf.filter((a) => a in veta.attrs).length;
        if (present !== 1) {
          errors.push({
            line: veta.line,
            element: veta.name,
            message: `Věta ${veta.name}: exactly one of ${rule.oneOf.join(', ')} is required`,
          });
        }
      }
    }

    for (const [name, value] of Object.entries(veta.attrs)) {
      if (value === '') {
        errors.push({
          line: veta.line,
          element: veta.name,
          message: `Věta ${veta.name}: attribute ${name} is empty`,
        });
        continue;
      }
      for (const pattern of VALUE_PATTERNS) {
        if (
          (pattern.form === 'any' || pattern.form === form) &&
          pattern.attr.test(name) &&
          !pattern.value.test(value)
        ) {
          errors.push({
            line: veta.line,
            element: veta.name,
            message: `Věta ${veta.name}: attribute ${name}="${value}" has an invalid format`,
          });
        }
      }
    }
  }

  for (const rule of rules) {
    const n = counts.get(rule.name) ?? 0;
    if (n < rule.min) {
      errors.push({
        line: null,
        element: rule.name,
        message: `Věta ${rule.name} is missing (minimum ${rule.min})`,
      });
    }
  }
  return errors;
}
