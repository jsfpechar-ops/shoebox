-- 0045_tax_reserve: M06 §4.11 cached "how much to set aside" estimate; one row per org, worker-written.
-- Forward only. Users select their own row; the worker (podklady.reserve.refresh) writes it.

create table tax_reserve_estimates (                                -- M06 §4.11 cached reserve; rebuilt by the worker
  org_id uuid primary key references organizations(id) on delete cascade,
  as_of date not null,                                              -- Europe/Prague date the estimate is for
  tax_year smallint not null,
  kind text not null check (kind in ('estimate','pausalni_dan')),
  payload jsonb not null default '{}',                              -- TaxReserveEstimate | PausalniDanReserve, Money as decimal strings
  ledger_hash text,                                                 -- hash of the entries used (M04 build_version), for debouncing
  computed_at timestamptz not null default now()
);

-- 05 §10.2: users select only; the worker role writes (no user insert, update or delete policy).
select app.apply_tenant_rls_read_only('tax_reserve_estimates');
