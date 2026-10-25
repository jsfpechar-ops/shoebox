// Drizzle mirror of migrations/0004_partners_registries.sql (05 §3 Partners and registries, §5
// Classification support). The SQL file is the source of truth for DDL; this file gives typed
// queries. RLS policies, grants and the updated_at trigger exist only in SQL.
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  char,
  check,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { directionEnum, taxEffectEnum, vatTreatmentEnum } from './enums';
import { organizations } from './tenancy';

export const partners = pgTable(
  'partners',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    ico: text('ico'),
    dic: text('dic'),
    vatId: text('vat_id'),
    country: char('country', { length: 2 }).notNull().default('CZ'),
    address: jsonb('address'),
    isVatPayer: boolean('is_vat_payer'),
    isUnreliablePayer: boolean('is_unreliable_payer'),
    registryCheckedAt: timestamp('registry_checked_at', { withTimezone: true }),
    emailDomains: text('email_domains').array().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('partners_org_id_ico_key').on(t.orgId, t.ico),
    unique('partners_org_id_vat_id_key').on(t.orgId, t.vatId),
  ],
);

export const partnerBankAccounts = pgTable(
  'partner_bank_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => partners.id, { onDelete: 'cascade' }),
    accountNumber: text('account_number'),
    bankCode: text('bank_code'),
    iban: text('iban'),
    bic: text('bic'),
    publishedInCrpdph: boolean('published_in_crpdph'),
    checkedAt: timestamp('checked_at', { withTimezone: true }),
  },
  (t) => [
    unique('partner_bank_accounts_org_id_partner_id_iban_key').on(t.orgId, t.partnerId, t.iban),
  ],
);

/** GLOBAL (05 §10.3): service role and app_worker only. */
export const registryCache = pgTable(
  'registry_cache',
  {
    source: text('source').notNull(),
    key: text('key').notNull(),
    payload: jsonb('payload').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.source, t.key] }),
    check('registry_cache_source_check', sql`${t.source} in ('ares','crpdph','vies')`),
  ],
);

/** GLOBAL (05 §10.3): ČNB daily fixing; read by authenticated. `rate` is numeric(12,6), never a float. */
export const fxRates = pgTable(
  'fx_rates',
  {
    rateDate: date('rate_date').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    amount: integer('amount').notNull(),
    rate: numeric('rate', { precision: 12, scale: 6 }).notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.rateDate, t.currency] })],
);

/** GLOBAL (05 §10.3): ČNB bank code list; read by authenticated. */
export const bankCodes = pgTable('bank_codes', {
  code: char('code', { length: 4 }).primaryKey(),
  name: text('name').notNull(),
  bic: text('bic'),
  validFrom: date('valid_from').notNull(),
  validTo: date('valid_to'),
});

/** GLOBAL (05 §10.3): the category taxonomy (04 §3.1); read by authenticated, seeded by P0-DB-11. */
export const categories = pgTable('categories', {
  code: text('code').primaryKey(),
  direction: directionEnum('direction').notNull(),
  taxEffect: taxEffectEnum('tax_effect').notNull(),
  labelCs: text('label_cs').notNull(),
  labelEn: text('label_en').notNull(),
  explanationCs: text('explanation_cs').notNull(),
  icon: text('icon'),
  sort: integer('sort').notNull(),
  replacedBy: text('replaced_by').references((): AnyPgColumn => categories.code),
  validFrom: date('valid_from').notNull().default('2000-01-01'),
  validTo: date('valid_to'),
});

export const vendorProfiles = pgTable(
  'vendor_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => partners.id, { onDelete: 'cascade' }),
    defaultCategoryCode: text('default_category_code').references(() => categories.code),
    defaultVatTreatment: vatTreatmentEnum('default_vat_treatment'),
    defaultBusinessFlag: text('default_business_flag'),
    confirmations: integer('confirmations').notNull().default(0),
    lastConfirmedAt: timestamp('last_confirmed_at', { withTimezone: true }),
    pinned: boolean('pinned').notNull().default(false),
    multiCategory: boolean('multi_category').notNull().default(false),
    extractionHints: jsonb('extraction_hints').notNull().default({}),
  },
  (t) => [
    unique('vendor_profiles_org_id_partner_id_key').on(t.orgId, t.partnerId),
    check(
      'vendor_profiles_default_business_flag_check',
      sql`${t.defaultBusinessFlag} in ('business','personal','mixed')`,
    ),
  ],
);
