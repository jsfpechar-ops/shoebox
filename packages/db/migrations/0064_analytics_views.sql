-- 0064_analytics_views (brief 0521, owner 2026-10-26): staff-only views for failure analytics over
-- pipeline_events (0063), extraction_runs and documents. Schema `analytics` is not usable by app roles
-- (anon, authenticated, app_worker); only the service role reads it, e.g. through
-- packages/db/scripts/analytics-export.ts. Codes, counts and supplier IČO only. Forward-only.
create schema analytics;
revoke all on schema analytics from public;
grant usage on schema analytics to service_role;

-- Per week: read outcomes, failed model calls, checks that fired, user actions.
create view analytics.failure_reasons_weekly as
select date_trunc('week', e.at)::date as week, e.kind, e.code, e.detail, e.model, e.prompt_version,
  count(*)::int as events, count(distinct e.document_id)::int as documents
from (
  select p.at, p.document_id, p.kind, p.code, p.detail, p.model, p.prompt_version
    from public.pipeline_events p where p.kind <> 'status'
  union all
  select p.at, p.document_id, 'check_blocking', r.rule_id, null, p.model, p.prompt_version
    from public.pipeline_events p cross join unnest(p.blocking) as r(rule_id) where p.kind = 'read'
  union all
  select p.at, p.document_id, 'check_warning', r.rule_id, null, p.model, p.prompt_version
    from public.pipeline_events p cross join unnest(p.warnings) as r(rule_id) where p.kind = 'read'
) e
group by 1, 2, 3, 4, 5, 6;

-- Which fields users fix, by the model and prompt of the read before the fix.
create view analytics.field_corrections as
select e.field_key, r.model, r.prompt_version, r.method,
  count(*) filter (where e.code = 'changed')::int as changed,
  count(*) filter (where e.code = 'filled')::int as filled,
  count(distinct e.document_id)::int as documents
from public.pipeline_events e
left join lateral (
  select p.model, p.prompt_version, p.method from public.pipeline_events p
  where p.document_id = e.document_id and p.kind = 'read' and p.id < e.id
  order by p.id desc limit 1
) r on true
where e.kind = 'user_edit'
group by 1, 2, 3, 4;

-- One row per document: how it went from upload to ready, and what the AI calls cost.
create view analytics.document_journey as
select d.id as document_id, d.org_id, d.status::text as status, d.class::text as class, d.entry_mode,
  d.deleted_at is not null as trashed,
  ev.first_at, ev.reads, ev.failed_reads, ev.user_edits, ev.first_outcome, ev.ready_at,
  round(extract(epoch from ev.ready_at - ev.first_at) / 3600, 2) as hours_to_ready,
  (ev.first_outcome = 'ready' and ev.user_edits = 0) as straight_through,
  c.calls as ai_calls, c.input_tokens, c.output_tokens, c.cost_usd
from public.documents d
cross join lateral (
  select min(e.at) as first_at,
    count(*) filter (where e.kind = 'read')::int as reads,
    count(*) filter (where e.kind = 'read_failed')::int as failed_reads,
    count(*) filter (where e.kind = 'user_edit')::int as user_edits,
    (array_agg(e.code order by e.id) filter (where e.kind = 'read'))[1] as first_outcome,
    min(e.at) filter (where e.kind = 'status' and e.code = 'ready') as ready_at
  from public.pipeline_events e where e.document_id = d.id
) ev
cross join lateral (
  select count(*)::int as calls, coalesce(sum(r.input_tokens), 0)::bigint as input_tokens,
    coalesce(sum(r.output_tokens), 0)::bigint as output_tokens, sum(r.cost_usd) as cost_usd
  from public.extraction_runs r
  where r.document_id = d.id and r.method in ('llm', 'llm_escalated')
) c;

-- AI usage per week, stage, model and prompt version.
create view analytics.ai_cost_weekly as
select date_trunc('week', r.created_at)::date as week, r.stage, r.method::text as method, r.model,
  r.prompt_version,
  count(*)::int as calls, count(*) filter (where r.ok)::int as ok_calls,
  count(distinct r.document_id)::int as documents,
  coalesce(sum(r.input_tokens), 0)::bigint as input_tokens,
  coalesce(sum(r.output_tokens), 0)::bigint as output_tokens,
  coalesce(sum(r.cache_read_tokens), 0)::bigint as cache_read_tokens,
  coalesce(sum(r.cache_write_tokens), 0)::bigint as cache_write_tokens,
  sum(r.cost_usd) as cost_usd
from public.extraction_runs r
group by 1, 2, 3, 4, 5;

-- Suppliers (by IČO, per org) whose documents need the most fixing; feeds supplier memory.
create view analytics.supplier_trouble as
select j.org_id, d.partner_snapshot->>'ico' as supplier_ico,
  count(*)::int as documents,
  sum(j.user_edits)::int as user_edits,
  sum(j.failed_reads)::int as failed_reads,
  count(*) filter (where j.straight_through is not true)::int as not_straight_through
from analytics.document_journey j
join public.documents d on d.id = j.document_id
where d.partner_snapshot->>'ico' is not null
group by 1, 2;

revoke all on all tables in schema analytics from public;
grant select on all tables in schema analytics to service_role;
