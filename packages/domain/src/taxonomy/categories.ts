import { Decimal } from 'decimal.js';
import type { LegalDate } from '../dates/index';
import type { Direction, TaxEffect } from '../enums/index';

export type CategoryGroup =
  | 'income'
  | 'expense'
  | 'non_deductible'
  | 'asset'
  | 'pass_through'
  | 'tax_insurance'
  | 'transfer'
  | 'private';

/** `both`: the category occurs on received and issued documents (pass-through, transfers). */
export type CategoryDirection = Direction | 'both';

export type Deductibility =
  | 'deductible'
  | 'non_deductible'
  | 'partially_deductible'
  | 'not_applicable';

export interface Category {
  readonly code: CategoryCode;
  readonly group: CategoryGroup;
  readonly direction: CategoryDirection;
  readonly taxEffect: TaxEffect;
  readonly labelEn: string;
  /** One sentence a layman understands. */
  readonly explanationEn: string;
  /** Lucide icon name, kebab-case. */
  readonly icon: string;
  readonly sort: number;
  /** '2000-01-01' for the whole seed. */
  readonly validFrom: LegalDate;
  readonly validTo: LegalDate | null;
  readonly replacedBy: CategoryCode | null;
}

export class UnknownCategoryError extends Error {
  constructor(code: string) {
    super(`Unknown category code: ${code}`);
    this.name = 'UnknownCategoryError';
  }
}

// [code, group, direction, taxEffect, labelEn, explanationEn, icon]
// Order is the spec order of 04 §3.1; `sort` is derived from the position (10, 20, 30, ...).
const RAW = [
  [
    'income_services',
    'income',
    'out',
    'taxable_income',
    'Services income',
    'Money from services you provide to customers.',
    'briefcase',
  ],
  [
    'income_goods',
    'income',
    'out',
    'taxable_income',
    'Goods income',
    'Money from goods you sell to customers.',
    'package',
  ],
  [
    'income_accommodation',
    'income',
    'out',
    'taxable_income',
    'Accommodation income',
    'Money from renting out accommodation.',
    'bed',
  ],
  [
    'income_platform_payout',
    'income',
    'out',
    'taxable_income',
    'Platform payout',
    'Payouts from online platforms for your sales.',
    'wallet',
  ],
  [
    'income_other_taxable',
    'income',
    'out',
    'taxable_income',
    'Other taxable income',
    'Other income that is taxable.',
    'coins',
  ],
  [
    'income_interest',
    'income',
    'out',
    'non_taxable_income',
    'Interest income',
    'Interest you earn on money held.',
    'percent',
  ],
  [
    'income_subsidy',
    'income',
    'out',
    'non_taxable_income',
    'Subsidy',
    'Public support money received for the business.',
    'hand-coins',
  ],
  [
    'income_loan_received',
    'income',
    'out',
    'non_taxable_income',
    'Loan received',
    'Money borrowed that must be paid back.',
    'banknote',
  ],
  [
    'income_owner_deposit',
    'income',
    'out',
    'non_taxable_income',
    'Owner deposit',
    'Money the owner puts into the business account.',
    'piggy-bank',
  ],
  [
    'income_vat_refund',
    'income',
    'out',
    'non_taxable_income',
    'VAT refund',
    'VAT money returned to the business by the tax office.',
    'receipt',
  ],
  [
    'exp_material',
    'expense',
    'in',
    'deductible_expense',
    'Material',
    'Materials used up in the business.',
    'hammer',
  ],
  [
    'exp_goods_for_resale',
    'expense',
    'in',
    'deductible_expense',
    'Goods for resale',
    'Goods bought to sell on.',
    'shopping-cart',
  ],
  [
    'exp_small_assets',
    'expense',
    'in',
    'deductible_expense',
    'Small assets',
    'Low-value items used in the business.',
    'laptop',
  ],
  [
    'exp_services_general',
    'expense',
    'in',
    'deductible_expense',
    'General services',
    'Services bought for the business.',
    'wrench',
  ],
  [
    'exp_software_saas',
    'expense',
    'in',
    'deductible_expense',
    'Software and subscriptions',
    'Software licences and online subscriptions for the business.',
    'cloud',
  ],
  [
    'exp_hosting_domains',
    'expense',
    'in',
    'deductible_expense',
    'Hosting and domains',
    'Web hosting and domain name costs.',
    'globe',
  ],
  [
    'exp_telecom',
    'expense',
    'in',
    'deductible_expense',
    'Telecom',
    'Phone and internet costs used for the business.',
    'phone',
  ],
  [
    'exp_rent',
    'expense',
    'in',
    'deductible_expense',
    'Rent',
    'Rent for premises used in the business.',
    'building',
  ],
  [
    'exp_energy',
    'expense',
    'in',
    'deductible_expense',
    'Energy',
    'Electricity, gas and heating for business premises.',
    'zap',
  ],
  [
    'exp_cleaning',
    'expense',
    'in',
    'deductible_expense',
    'Cleaning',
    'Cleaning of the premises you use for business.',
    'sparkles',
  ],
  [
    'exp_property_management',
    'expense',
    'in',
    'deductible_expense',
    'Property management',
    'Fees for managing business property.',
    'key',
  ],
  [
    'exp_platform_commission',
    'expense',
    'in',
    'deductible_expense',
    'Platform commission',
    'Commission charged by online platforms.',
    'badge-percent',
  ],
  [
    'exp_payment_fees',
    'expense',
    'in',
    'deductible_expense',
    'Payment fees',
    'Fees charged by card and payment providers.',
    'credit-card',
  ],
  [
    'exp_bank_fees',
    'expense',
    'in',
    'deductible_expense',
    'Bank fees',
    'Fees charged by the bank on the business account.',
    'landmark',
  ],
  [
    'exp_advertising',
    'expense',
    'in',
    'deductible_expense',
    'Advertising',
    'Marketing and advertising costs.',
    'megaphone',
  ],
  [
    'exp_accounting_legal',
    'expense',
    'in',
    'deductible_expense',
    'Accounting and legal',
    'Accountant and legal service fees.',
    'scale',
  ],
  [
    'exp_postage_shipping',
    'expense',
    'in',
    'deductible_expense',
    'Postage and shipping',
    'Costs of sending parcels and documents.',
    'truck',
  ],
  [
    'exp_travel_transport',
    'expense',
    'in',
    'deductible_expense',
    'Travel and transport',
    'Business trips and public transport.',
    'plane',
  ],
  ['exp_fuel', 'expense', 'in', 'deductible_expense', 'Fuel', 'Fuel for business driving.', 'fuel'],
  [
    'exp_car_operating',
    'expense',
    'in',
    'deductible_expense',
    'Car operating costs',
    'Running costs of a car used in the business.',
    'car',
  ],
  [
    'exp_car_lease',
    'expense',
    'in',
    'deductible_expense',
    'Car lease',
    'Lease payments for a car used in the business.',
    'car-front',
  ],
  [
    'exp_repairs',
    'expense',
    'in',
    'deductible_expense',
    'Repairs',
    'Repairs and maintenance of business assets.',
    'drill',
  ],
  [
    'exp_insurance_business',
    'expense',
    'in',
    'deductible_expense',
    'Business insurance',
    'Insurance for the business.',
    'shield',
  ],
  [
    'exp_training_education',
    'expense',
    'in',
    'deductible_expense',
    'Training and education',
    'Courses that keep up your business skills.',
    'graduation-cap',
  ],
  [
    'exp_office_supplies',
    'expense',
    'in',
    'deductible_expense',
    'Office supplies',
    'Paper, pens and other office consumables.',
    'paperclip',
  ],
  [
    'exp_salaries',
    'expense',
    'in',
    'deductible_expense',
    'Salaries',
    'Wages paid to employees.',
    'users',
  ],
  [
    'exp_other_deductible',
    'expense',
    'in',
    'deductible_expense',
    'Other deductible expense',
    'Other costs of the business that are deductible.',
    'tag',
  ],
  [
    'exp_representation',
    'non_deductible',
    'in',
    'non_deductible_expense',
    'Representation',
    'Entertainment and hospitality, not tax-deductible.',
    'utensils',
  ],
  [
    'exp_fines_penalties',
    'non_deductible',
    'in',
    'non_deductible_expense',
    'Fines and penalties',
    'Fines and penalties, not tax-deductible.',
    'triangle-alert',
  ],
  [
    'exp_other_non_deductible',
    'non_deductible',
    'in',
    'non_deductible_expense',
    'Other non-deductible expense',
    'Other costs that are not tax-deductible.',
    'ban',
  ],
  [
    'asset_long_term',
    'asset',
    'in',
    'asset',
    'Long-term asset',
    'An asset kept for more than one year.',
    'building-2',
  ],
  [
    'pt_tourist_fee',
    'pass_through',
    'both',
    'pass_through',
    'Tourist fee',
    'Tourist tax collected for the municipality.',
    'map-pin',
  ],
  [
    'pt_deposit',
    'pass_through',
    'both',
    'pass_through',
    'Deposit',
    'Deposit held for a customer and returned later.',
    'lock',
  ],
  [
    'pt_customs_vat',
    'pass_through',
    'both',
    'pass_through',
    'Customs VAT',
    'Import VAT paid for goods passing through customs.',
    'ship',
  ],
  [
    'tax_vat_payment',
    'tax_insurance',
    'in',
    'tax_or_insurance_payment',
    'VAT payment',
    'VAT paid to the tax office.',
    'receipt-text',
  ],
  [
    'tax_income_payment',
    'tax_insurance',
    'in',
    'tax_or_insurance_payment',
    'Income tax payment',
    'Income tax paid to the tax office.',
    'landmark',
  ],
  [
    'tax_pausal_advance',
    'tax_insurance',
    'in',
    'tax_or_insurance_payment',
    'Flat-rate advance',
    'Advance payment under the flat-rate regime.',
    'calendar-check',
  ],
  [
    'ins_social_own',
    'tax_insurance',
    'in',
    'tax_or_insurance_payment',
    'Own social insurance',
    'Social insurance paid by the owner.',
    'heart-handshake',
  ],
  [
    'ins_health_own',
    'tax_insurance',
    'in',
    'tax_or_insurance_payment',
    'Own health insurance',
    'Health insurance paid by the owner.',
    'heart-pulse',
  ],
  [
    'tax_other_fees',
    'tax_insurance',
    'in',
    'tax_or_insurance_payment',
    'Other tax fees',
    'Other taxes and official fees.',
    'file-text',
  ],
  [
    'transfer_own_accounts',
    'transfer',
    'both',
    'transfer',
    'Transfer between own accounts',
    'Money moved between your own accounts.',
    'arrow-left-right',
  ],
  [
    'transfer_cash_deposit',
    'transfer',
    'both',
    'transfer',
    'Cash deposit',
    'Cash paid into the bank account.',
    'arrow-down-to-line',
  ],
  [
    'transfer_cash_withdrawal',
    'transfer',
    'both',
    'transfer',
    'Cash withdrawal',
    'Cash taken out of the bank account.',
    'arrow-up-from-line',
  ],
  [
    'loan_repayment_principal',
    'transfer',
    'both',
    'transfer',
    'Loan repayment (principal)',
    'The principal part of a loan repayment.',
    'undo-2',
  ],
  [
    'private_expense',
    'private',
    'in',
    'private',
    'Private expense',
    'A cost paid for private, not business, purposes.',
    'user',
  ],
  [
    'private_withdrawal',
    'private',
    'both',
    'private',
    'Private withdrawal',
    'Money the owner takes out for private use.',
    'user-minus',
  ],
] as const;

export type CategoryCode = (typeof RAW)[number][0];

export const CATEGORY_CODES: readonly CategoryCode[] = RAW.map((r) => r[0]);

export const CATEGORIES: readonly Category[] = RAW.map((r, i) => ({
  code: r[0],
  group: r[1],
  direction: r[2],
  taxEffect: r[3],
  labelEn: r[4],
  explanationEn: r[5],
  icon: r[6],
  sort: (i + 1) * 10,
  validFrom: '2000-01-01' as LegalDate,
  validTo: null,
  replacedBy: null,
}));

const BY_CODE: ReadonlyMap<string, Category> = new Map(CATEGORIES.map((c) => [c.code, c]));

export function isCategoryCode(value: string): value is CategoryCode {
  return BY_CODE.has(value);
}

export function findCategory(code: string): Category | undefined {
  return BY_CODE.get(code);
}

export function getCategory(code: string): Category {
  const category = BY_CODE.get(code);
  if (!category) {
    throw new UnknownCategoryError(code);
  }
  return category;
}

export function categoryAllowsDirection(category: Category, direction: Direction): boolean {
  return category.direction === 'both' || category.direction === direction;
}

/** True when `validFrom <= date <= validTo` (`validTo` null means open-ended). ISO dates compare as strings. */
export function isCategoryValidOn(category: Category, date: LegalDate | string): boolean {
  if (date < category.validFrom) {
    return false;
  }
  return category.validTo === null || date <= category.validTo;
}

/** M04 §4.1. `sharePct` is the business share in percent, 0..100. */
export function deriveDeductibility(category: Category, sharePct: string | Decimal): Deductibility {
  const share = sharePct instanceof Decimal ? sharePct : new Decimal(sharePct);
  if (!share.isFinite() || share.isNegative() || share.greaterThan(100)) {
    throw new RangeError(`Share must be between 0 and 100, got ${share.toString()}`);
  }
  switch (category.taxEffect) {
    case 'deductible_expense':
      if (share.equals(100)) {
        return 'deductible';
      }
      return share.isZero() ? 'non_deductible' : 'partially_deductible';
    case 'non_deductible_expense':
    case 'private':
      return 'non_deductible';
    default:
      // asset, all income, pass_through, transfer and tax_or_insurance_payment
      return 'not_applicable';
  }
}
