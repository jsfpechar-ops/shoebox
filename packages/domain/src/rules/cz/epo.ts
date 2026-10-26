import { z } from 'zod';
import {
  type TaxDocStatus,
  VAT_TREATMENT_VALUES,
  type VatRateType,
  type VatStatus,
  type VatTreatment,
} from '../../enums/index';
import { Money } from '../../money/index';

// --- DPHDP3 row map (M04 §4.10). Rows are rule data: a form change edits this table only. ---

export const Dphdp3RowSchema = z.strictObject({
  row: z.string().regex(/^\d{1,2}$/),
  treatment: z.enum(VAT_TREATMENT_VALUES),
  rate: z.enum(['standard', 'reduced', 'any']),
  statuses: z.array(z.enum(['platce', 'identifikovana_osoba'])).min(1),
  side: z.enum(['input', 'output']),
  /** The deduction row a payer adds (43/44); absent for self-contained rows. */
  deduction_row: z
    .string()
    .regex(/^\d{1,2}$/)
    .optional(),
  /** 40/41/42: the row itself is a deduction and exists only when the deduction is allowed. */
  requires_deduction: z.boolean().optional(),
  /** EPO XML attribute names [base, tax]; optional until verified against the XSD (Phase 3). */
  attrs: z.array(z.string().min(1)).min(1).optional(),
  /** true only for rows whose attrs come from an official sample ([O]). */
  confirmed: z.boolean(),
});
export const Dphdp3RowMapSchema = z.array(Dphdp3RowSchema);
export type Dphdp3RowMapEntry = z.output<typeof Dphdp3RowSchema>;
export type Dphdp3RowMap = readonly Dphdp3RowMapEntry[];

export const CZ_DPHDP3_ROW_MAP: Dphdp3RowMap = [
  {
    row: '1',
    treatment: 'iss_domestic_vat',
    rate: 'standard',
    statuses: ['platce'],
    side: 'output',
    attrs: ['obrat23', 'dan23'],
    confirmed: true,
  },
  {
    row: '2',
    treatment: 'iss_domestic_vat',
    rate: 'reduced',
    statuses: ['platce'],
    side: 'output',
    attrs: ['obrat5', 'dan5'],
    confirmed: true,
  },
  {
    row: '3',
    treatment: 'rcv_eu_goods_acquisition',
    rate: 'standard',
    statuses: ['platce'],
    side: 'output',
    deduction_row: '43',
    attrs: ['p_zb23', 'dan_pzb23'],
    confirmed: true,
  },
  {
    row: '4',
    treatment: 'rcv_eu_goods_acquisition',
    rate: 'reduced',
    statuses: ['platce'],
    side: 'output',
    deduction_row: '44',
    attrs: ['p_zb5', 'dan_pzb5'],
    confirmed: true,
  },
  {
    row: '5',
    treatment: 'rcv_eu_service_reverse_charge',
    rate: 'standard',
    statuses: ['platce', 'identifikovana_osoba'],
    side: 'output',
    deduction_row: '43',
    attrs: ['p_sl23_e', 'dan_psl23_e'],
    confirmed: true,
  },
  {
    row: '6',
    treatment: 'rcv_eu_service_reverse_charge',
    rate: 'reduced',
    statuses: ['platce', 'identifikovana_osoba'],
    side: 'output',
    deduction_row: '44',
    attrs: ['p_sl5_e', 'dan_psl5_e'],
    confirmed: true,
  },
  {
    row: '10',
    treatment: 'rcv_domestic_reverse_charge',
    rate: 'standard',
    statuses: ['platce'],
    side: 'output',
    deduction_row: '43',
    attrs: ['rez_pren23', 'dan_rpren23'],
    confirmed: true,
  },
  {
    row: '11',
    treatment: 'rcv_domestic_reverse_charge',
    rate: 'reduced',
    statuses: ['platce'],
    side: 'output',
    deduction_row: '44',
    attrs: ['rez_pren5', 'dan_rpren5'],
    confirmed: true,
  },
  {
    row: '12',
    treatment: 'rcv_non_eu_service_reverse_charge',
    rate: 'standard',
    statuses: ['platce', 'identifikovana_osoba'],
    side: 'output',
    deduction_row: '43',
    attrs: ['p_sl23_z', 'dan_psl23_z'],
    confirmed: true,
  },
  {
    row: '13',
    treatment: 'rcv_non_eu_service_reverse_charge',
    rate: 'reduced',
    statuses: ['platce', 'identifikovana_osoba'],
    side: 'output',
    deduction_row: '44',
    attrs: ['p_sl5_z', 'dan_psl5_z'],
    confirmed: true,
  },
  {
    row: '20',
    treatment: 'iss_eu_goods',
    rate: 'any',
    statuses: ['platce'],
    side: 'output',
    attrs: ['dod_zb'],
    confirmed: true,
  },
  {
    row: '21',
    treatment: 'iss_eu_service',
    rate: 'any',
    statuses: ['platce'],
    side: 'output',
    attrs: ['pln_sluzby'],
    confirmed: true,
  },
  {
    row: '22',
    treatment: 'iss_export_goods',
    rate: 'any',
    statuses: ['platce'],
    side: 'output',
    attrs: ['pln_vyvoz'],
    confirmed: true,
  },
  {
    row: '25',
    treatment: 'iss_domestic_reverse_charge',
    rate: 'any',
    statuses: ['platce'],
    side: 'output',
    attrs: ['pln_rez_pren'],
    confirmed: true,
  },
  {
    row: '26',
    treatment: 'iss_non_eu_service',
    rate: 'any',
    statuses: ['platce'],
    side: 'output',
    attrs: ['pln_ost'],
    confirmed: true,
  },
  {
    row: '40',
    treatment: 'rcv_domestic_vat',
    rate: 'standard',
    statuses: ['platce'],
    side: 'input',
    requires_deduction: true,
    attrs: ['pln23', 'odp_tuz23_nar'],
    confirmed: false,
  },
  {
    row: '41',
    treatment: 'rcv_domestic_vat',
    rate: 'reduced',
    statuses: ['platce'],
    side: 'input',
    requires_deduction: true,
    attrs: ['pln5', 'odp_tuz5_nar'],
    confirmed: false,
  },
  {
    row: '42',
    treatment: 'rcv_import_customs',
    rate: 'any',
    statuses: ['platce'],
    side: 'input',
    requires_deduction: true,
    attrs: ['dov_cu', 'odp_cu_nar'],
    confirmed: false,
  },
  {
    row: '50',
    treatment: 'iss_exempt',
    rate: 'any',
    statuses: ['platce'],
    side: 'output',
    attrs: ['plnosv_nkf'],
    confirmed: false,
  },
];

export function parseDphdp3RowMap(value: unknown): Dphdp3RowMap {
  return Dphdp3RowMapSchema.parse(value);
}

const byRowNumber = (a: string, b: string) => Number.parseInt(a, 10) - Number.parseInt(b, 10);

/**
 * DPHDP3 row numbers for one VAT treatment. `deductionAllowed` is computed by the caller
 * (tax_doc_status, deduction-blocking checks, deduction_pct > 0). Neplatce gets no rows.
 */
export function resolveDphdp3Rows(
  treatment: VatTreatment,
  rate: VatRateType,
  status: VatStatus,
  deductionAllowed: boolean,
  map: Dphdp3RowMap,
): string[] {
  if (status === 'neplatce') return [];
  const rows = new Set<string>();
  for (const entry of map) {
    if (entry.treatment !== treatment) continue;
    if (entry.rate !== 'any' && entry.rate !== rate) continue;
    if (!entry.statuses.includes(status)) continue;
    if (entry.requires_deduction && !deductionAllowed) continue;
    rows.add(entry.row);
    if (status === 'platce' && deductionAllowed && entry.deduction_row !== undefined)
      rows.add(entry.deduction_row);
  }
  return [...rows].sort(byRowNumber);
}

// --- KH routing (M05 §4.2 step 8). The limit is an input (vat.kh_document_limit), never a constant. ---

const KhSectionValues = ['A1', 'A2', 'A3', 'A4', 'A5', 'B1', 'B2', 'B3'] as const;
export type KhSection = (typeof KhSectionValues)[number];

export const KhRoutingSchema = z.strictObject({
  version: z.number().int().min(1),
  rules: z.array(
    z.strictObject({
      treatments: z.array(z.enum(VAT_TREATMENT_VALUES)).min(1),
      section: z.enum(KhSectionValues).optional(),
      over_limit: z.enum(KhSectionValues).optional(),
      under_limit: z.enum(KhSectionValues).optional(),
      over_limit_requires: z.array(z.enum(['counterparty_cz_dic', 'full_tax_document'])).optional(),
    }),
  ),
});
export type KhRouting = z.output<typeof KhRoutingSchema>;

export const CZ_KH_ROUTING: KhRouting = {
  version: 1,
  rules: [
    { treatments: ['rcv_domestic_reverse_charge'], section: 'B1' },
    {
      treatments: [
        'rcv_eu_service_reverse_charge',
        'rcv_non_eu_service_reverse_charge',
        'rcv_eu_goods_acquisition',
      ],
      section: 'A2',
    },
    {
      treatments: ['rcv_domestic_vat'],
      over_limit: 'B2',
      under_limit: 'B3',
      over_limit_requires: ['counterparty_cz_dic', 'full_tax_document'],
    },
    { treatments: ['iss_domestic_reverse_charge'], section: 'A1' },
    {
      treatments: ['iss_domestic_vat'],
      over_limit: 'A4',
      under_limit: 'A5',
      over_limit_requires: ['counterparty_cz_dic'],
    },
  ],
};

export function parseKhRouting(value: unknown): KhRouting {
  return KhRoutingSchema.parse(value);
}

export interface KhRoutingInput {
  readonly vatStatus: VatStatus;
  readonly treatment: VatTreatment;
  /** Signed; the absolute value is tested against the limit. */
  readonly docTotalCzk: Money;
  readonly counterpartyCzDic: boolean;
  readonly taxDocStatus: TaxDocStatus;
  /** vat.kh_document_limit, in whole CZK. */
  readonly limitCzk: number;
}

/** KH section for one document, or null (not a payer, or no control-statement entry). */
export function resolveKhSection(input: KhRoutingInput, routing: KhRouting): KhSection | null {
  if (input.vatStatus !== 'platce') return null;
  const rule = routing.rules.find((r) => r.treatments.includes(input.treatment));
  if (!rule) return null;
  if (rule.section !== undefined) return rule.section;
  const over = input.docTotalCzk.abs().compare(Money.parse(String(input.limitCzk), 'CZK')) > 0;
  const requires = rule.over_limit_requires ?? [];
  const requirementsMet = requires.every((req) =>
    req === 'counterparty_cz_dic'
      ? input.counterpartyCzDic
      : input.taxDocStatus === 'full_tax_document',
  );
  if (over && requirementsMet) return rule.over_limit ?? null;
  return rule.under_limit ?? null;
}
