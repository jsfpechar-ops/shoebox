// Drizzle mirror of migrations/0002_tenancy.sql (05 §2). The SQL file is the source of truth for
// DDL; this file gives typed queries. The exclusion constraint on taxpayer_profiles, the
// updated_at trigger and the RLS policies exist only in SQL (Drizzle has no API for them).
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  jsonb,
  pgSchema,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { memberRoleEnum, taxRegimeEnum, vatPeriodEnum, vatStatusEnum } from './enums';

/** Supabase Auth's users table (managed by Supabase; referenced, never migrated here). */
export const authSchema = pgSchema('auth');
export const authUsers = authSchema.table('users', {
  id: uuid('id').primaryKey(),
});

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  ico: text('ico'),
  dic: text('dic'),
  inboundEmailSlug: text('inbound_email_slug').notNull().unique(),
  inboundEmailSecret: text('inbound_email_secret').notNull(),
  inboundEmailSecretPrev: text('inbound_email_secret_prev'),
  inboundEmailSecretPrevUntil: timestamp('inbound_email_secret_prev_until', { withTimezone: true }),
  settings: jsonb('settings').notNull().default({}),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  archiveMode: boolean('archive_mode').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const memberships = pgTable(
  'memberships',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    role: memberRoleEnum('role').notNull(),
    invitedBy: uuid('invited_by').references(() => authUsers.id),
    prefs: jsonb('prefs').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] }), index('memberships_user_id').on(t.userId)],
);

export const taxpayerProfiles = pgTable(
  'taxpayer_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    validFrom: date('valid_from').notNull(),
    validTo: date('valid_to'),
    vatStatus: vatStatusEnum('vat_status').notNull(),
    vatPeriod: vatPeriodEnum('vat_period'),
    taxRegime: taxRegimeEnum('tax_regime').notNull(),
    pausalRate: smallint('pausal_rate'),
    pausalDanBand: smallint('pausal_dan_band'),
    entityType: text('entity_type').notNull().default('osvc'),
    legalName: text('legal_name').notNull(),
    ico: text('ico').notNull(),
    dic: text('dic'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    title: text('title'),
    filingEmail: text('filing_email'),
    filingPhone: text('filing_phone'),
    address: jsonb('address').notNull(),
    fuCode: text('fu_code'),
    ufoCode: text('ufo_code'),
    mainActivityNace: text('main_activity_nace'),
    insurer: text('insurer'),
    hasAccountant: boolean('has_accountant').notNull().default(false),
    foreignServiceDppdPolicy: text('foreign_service_dppd_policy')
      .notNull()
      .default('service_period_end'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('taxpayer_profiles_org_id_valid_from').on(t.orgId, t.validFrom),
    check('taxpayer_profiles_pausal_rate_check', sql`${t.pausalRate} in (80,60,40,30)`),
    check('taxpayer_profiles_pausal_dan_band_check', sql`${t.pausalDanBand} in (1,2,3)`),
    check('taxpayer_profiles_entity_type_check', sql`${t.entityType} in ('osvc','sro')`),
    check(
      'taxpayer_profiles_insurer_check',
      sql`${t.insurer} in ('vzp','vozp','cpzp','ozp','zpskoda','zpmv','rbp')`,
    ),
    check(
      'taxpayer_profiles_foreign_service_dppd_policy_check',
      sql`${t.foreignServiceDppdPolicy} in ('service_period_end','issue_date')`,
    ),
  ],
);
