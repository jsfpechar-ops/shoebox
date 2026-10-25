// Drizzle mirror of migrations/0007_platform.sql (05 §9 Platform). The SQL file is the source of
// truth for DDL; this file gives typed queries. The unlogged flag of rate_limit_counters, the
// function app.rate_limit_hit() (see ../rate-limit.ts), the updated_at trigger, the RLS policies
// and the grants exist only in SQL. cost_usd is numeric(10,4): a string in Drizzle, never a float.
import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { authUsers, organizations } from './tenancy';

/** Tenant table with a nullable org_id (05 §10.3): users select rows of their orgs, server code inserts. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    orgId: uuid('org_id'),
    actorUserId: uuid('actor_user_id'),
    actorKind: text('actor_kind').notNull(),
    entity: text('entity').notNull(),
    entityId: uuid('entity_id'),
    action: text('action').notNull(),
    diff: jsonb('diff'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_org_id_at_idx').on(t.orgId, t.at),
    check(
      'audit_log_actor_kind_check',
      sql`${t.actorKind} in ('user','system','accountant','api','staff')`,
    ),
  ],
);

/** GLOBAL (05 §10.3): admin hotfix of law data (06 §2); service role writes, the worker reads. */
export const rulesOverrides = pgTable('rules_overrides', {
  id: uuid('id').primaryKey().defaultRandom(),
  ruleKey: text('rule_key').notNull(),
  validFrom: date('valid_from').notNull(),
  validTo: date('valid_to'),
  value: jsonb('value').notNull(),
  reason: text('reason').notNull(),
  source: text('source').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Tenant-keyed counters, select-only for users (05 §10.2); the worker writes them. */
export const llmUsageDaily = pgTable(
  'llm_usage_daily',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    model: text('model').notNull(),
    calls: integer('calls').notNull(),
    inputTokens: bigint('input_tokens', { mode: 'number' }).notNull(),
    outputTokens: bigint('output_tokens', { mode: 'number' }).notNull(),
    costUsd: numeric('cost_usd', { precision: 10, scale: 4 }).notNull(),
  },
  (t) => [primaryKey({ name: 'llm_usage_daily_pkey', columns: [t.orgId, t.day, t.model] })],
);

/** GLOBAL (05 §10.3): service role only (M12 §4.9). */
export const staffUsers = pgTable(
  'staff_users',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('staff_users_role_check', sql`${t.role} in ('admin','support')`)],
);

/** Select and write owner-only (05 §10.2). */
export const privacyRequests = pgTable(
  'privacy_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => authUsers.id),
    state: text('state').notNull().default('pending'),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
    resultPath: text('result_path'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'privacy_requests_kind_check',
      sql`${t.kind} in ('export','close_archive','close_delete')`,
    ),
    check(
      'privacy_requests_state_check',
      sql`${t.state} in ('pending','running','ready','scheduled','done','cancelled','failed')`,
    ),
  ],
);

/** GLOBAL (05 §10.3), unlogged in SQL: fixed-window counters written only by app.rate_limit_hit(). */
export const rateLimitCounters = pgTable(
  'rate_limit_counters',
  {
    key: text('key').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    hits: integer('hits').notNull(),
  },
  (t) => [primaryKey({ name: 'rate_limit_counters_pkey', columns: [t.key, t.windowStart] })],
);
