import { Decimal } from 'decimal.js';
import type { LegalDate } from '../dates/index';
import type {
  Direction,
  DocumentClass,
  TaxDocStatus,
  VatRateType,
  VatStatus,
  VatTreatment,
} from '../enums/index';
import type { Money } from '../money/index';
import type { RULE_SCHEMAS } from '../rules/keys';
import type { RuleResolver, RulesAt } from '../rules/resolver';
import { type CategoryCode, getCategory } from '../taxonomy/categories';

export type SupplyKind = 'service' | 'goods';

export interface VatTreatmentParty {
  readonly country: string | null;
  readonly czDic: string | null;
  readonly vatId: string | null;
  readonly vatIdValid: boolean | null;
  readonly isVatPayer: boolean | null;
}

export interface VatTreatmentLine {
  readonly vat: Money | null;
  readonly vatRatePct: string | null;
  readonly rcCommodityCode: string | null;
  readonly categoryCode: CategoryCode;
  readonly isStatementIncomeLine: boolean;
}

export interface VatTreatmentFlags {
  readonly reverseCharge92a: boolean;
  readonly customsDeclaration: boolean;
  readonly placeOfSupplyAbroad: boolean;
}

export interface VatTreatmentInput {
  readonly direction: Direction;
  readonly docClass: DocumentClass;
  readonly taxDocStatus: TaxDocStatus;
  readonly issueDate: LegalDate;
  readonly flags: VatTreatmentFlags;
  readonly line: VatTreatmentLine;
  readonly supplier: VatTreatmentParty | null;
  readonly customer: VatTreatmentParty | null;
  readonly supplyKind: SupplyKind | null;
  readonly vatStatus: VatStatus;
  readonly rules: RuleResolver<typeof RULE_SCHEMAS>;
}

export interface VatTreatmentResult {
  readonly treatment: VatTreatment | null;
  readonly ambiguous?: 'supply_kind' | 'supplier';
  readonly provisional?: true;
  readonly note?: 'TAXDOC_FOREIGN_VAT_CHARGED_B2B' | 'PLACE_OF_SUPPLY_ABROAD';
}

export const SERVICE_DEFAULT_CATEGORIES: readonly CategoryCode[] = [
  'exp_software_saas',
  'exp_hosting_domains',
  'exp_platform_commission',
  'exp_advertising',
  'exp_services_general',
];

export const SELF_ASSESSED_TREATMENTS: readonly VatTreatment[] = [
  'rcv_eu_service_reverse_charge',
  'rcv_non_eu_service_reverse_charge',
  'rcv_eu_goods_acquisition',
  'rcv_domestic_reverse_charge',
  'rcv_import_customs',
];

const CZ = 'CZ';
const OUT_OF_SCOPE_TAX_EFFECTS: readonly string[] = [
  'pass_through',
  'tax_or_insurance_payment',
  'transfer',
];

type RulesAtNow = RulesAt<typeof RULE_SCHEMAS>;

function isEuCountry(country: string | null, rulesAt: RulesAtNow): boolean {
  if (country === null || country === CZ) return false;
  return (rulesAt.get('vat.eu_member_states') as readonly string[]).includes(country);
}

function isOutOfScopeCategory(code: CategoryCode, rulesAt: RulesAtNow): boolean {
  return (rulesAt.get('vat.out_of_scope_categories') as readonly string[]).includes(code);
}

function hasPositiveVat(line: VatTreatmentLine): boolean {
  return line.vat?.isPositive() ?? false;
}

function hasPositiveRate(line: VatTreatmentLine): boolean {
  return line.vatRatePct !== null && new Decimal(line.vatRatePct).gt(0);
}

export function deriveVatTreatment(input: VatTreatmentInput): VatTreatmentResult {
  const rulesAt = input.rules.at(input.issueDate);
  return input.direction === 'in' ? deriveReceived(input, rulesAt) : deriveIssued(input, rulesAt);
}

function deriveReceived(input: VatTreatmentInput, rulesAt: RulesAtNow): VatTreatmentResult {
  const { line, flags, supplier, taxDocStatus } = input;
  if (supplier === null) return { treatment: null, ambiguous: 'supplier' };

  const category = getCategory(line.categoryCode);
  if (
    OUT_OF_SCOPE_TAX_EFFECTS.includes(category.taxEffect) ||
    isOutOfScopeCategory(line.categoryCode, rulesAt)
  ) {
    return { treatment: 'rcv_out_of_scope' };
  }
  if (line.rcCommodityCode !== null || (flags.reverseCharge92a && supplier.czDic !== null)) {
    return { treatment: 'rcv_domestic_reverse_charge' };
  }
  if (flags.customsDeclaration) return { treatment: 'rcv_import_customs' };

  if (supplier.czDic !== null) {
    if (taxDocStatus === 'not_tax_document') return { treatment: 'rcv_domestic_no_vat' };
    if (hasPositiveVat(line) || hasPositiveRate(line)) return { treatment: 'rcv_domestic_vat' };
    return { treatment: 'rcv_domestic_no_vat' };
  }
  if (supplier.country === CZ) return { treatment: 'rcv_domestic_no_vat' };

  if (hasPositiveVat(line))
    return { treatment: 'rcv_foreign_vat_charged', note: 'TAXDOC_FOREIGN_VAT_CHARGED_B2B' };
  if (flags.placeOfSupplyAbroad)
    return { treatment: 'rcv_out_of_scope', note: 'PLACE_OF_SUPPLY_ABROAD' };

  const supplyKind: SupplyKind | null =
    input.supplyKind ?? (SERVICE_DEFAULT_CATEGORIES.includes(line.categoryCode) ? 'service' : null);
  if (supplyKind === null) return { treatment: null, ambiguous: 'supply_kind' };
  const provisional = input.supplyKind === null ? { provisional: true as const } : {};

  if (isEuCountry(supplier.country, rulesAt)) {
    const treatment: VatTreatment =
      supplyKind === 'goods' ? 'rcv_eu_goods_acquisition' : 'rcv_eu_service_reverse_charge';
    return { treatment, ...provisional };
  }
  const treatment: VatTreatment =
    supplyKind === 'service' ? 'rcv_non_eu_service_reverse_charge' : 'rcv_import_customs';
  return { treatment, ...provisional };
}

function deriveIssued(input: VatTreatmentInput, rulesAt: RulesAtNow): VatTreatmentResult {
  const { line, customer, supplyKind } = input;
  const isPayer = input.vatStatus === 'platce';

  if (line.isStatementIncomeLine) return { treatment: isPayer ? 'iss_domestic_vat' : 'iss_no_vat' };

  const isEuBusiness = customer !== null && isEuCountry(customer.country, rulesAt);
  // An EU customer without a valid VAT ID is treated as B2C (domestic rules).
  const isB2c =
    customer === null ||
    customer.czDic !== null ||
    customer.country === CZ ||
    (isEuBusiness && customer.vatIdValid !== true);
  if (isB2c) {
    if (!isPayer) return { treatment: 'iss_no_vat' };
    return {
      treatment: line.rcCommodityCode !== null ? 'iss_domestic_reverse_charge' : 'iss_domestic_vat',
    };
  }

  // Foreign business or non-EU customer: the supply kind decides.
  if (supplyKind === null) return { treatment: null, ambiguous: 'supply_kind' };
  if (isEuBusiness) {
    if (supplyKind === 'service') return { treatment: 'iss_eu_service' };
    return { treatment: isPayer ? 'iss_eu_goods' : 'iss_no_vat' };
  }
  if (!isPayer) return { treatment: 'iss_no_vat' };
  return { treatment: supplyKind === 'service' ? 'iss_non_eu_service' : 'iss_export_goods' };
}

export function deriveVatRateType(
  treatment: VatTreatment | null,
  printedRatePct: string | null,
  categoryCode: CategoryCode,
  rulesAt: RulesAtNow,
): VatRateType {
  if (treatment === 'rcv_domestic_vat' || treatment === 'iss_domestic_vat') {
    const pct = new Decimal(printedRatePct ?? '0');
    if (pct.isZero()) return 'zero';
    const rates = rulesAt.get('vat.rates');
    if (pct.equals(rates.standard)) return 'standard';
    if (pct.equals(rates.reduced)) return 'reduced';
    return 'none';
  }
  if (treatment !== null && SELF_ASSESSED_TREATMENTS.includes(treatment)) {
    const reduced = (rulesAt.get('vat.reduced_rate_categories') as readonly string[]).includes(
      categoryCode,
    );
    return reduced ? 'reduced' : 'standard';
  }
  return 'none';
}
