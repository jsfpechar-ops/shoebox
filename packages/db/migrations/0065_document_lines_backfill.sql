-- 0065_document_lines_backfill (M02 §6 step 5, brief 0622): documents read before brief 0620 have a
-- VAT recap in document_vat_summary but no document_lines, so they were never categorized and are
-- missing from the ledgers. One `item` line per recap row (gross = base + vat), a single line from
-- the totals where no recap was printed, and a `rounding` line where documents.rounding <> 0.
-- Only documents that have no lines at all are touched. Forward-only; re-runnable (second run is a no-op).

insert into document_lines (org_id, document_id, position, line_type, net, vat, gross, vat_rate_type, vat_rate_pct)
select s.org_id, s.document_id,
       row_number() over (partition by s.document_id order by s.vat_rate_pct desc, s.vat_rate_type),
       'item', s.base, s.vat, s.base + s.vat, s.vat_rate_type, s.vat_rate_pct
from document_vat_summary s
join documents d on d.id = s.document_id and d.org_id = s.org_id
where d.deleted_at is null
  and not exists (select 1 from document_lines l where l.document_id = s.document_id);

insert into document_lines (org_id, document_id, position, line_type, net, vat, gross, vat_rate_type)
select d.org_id, d.id, 1, 'item', d.total_net, d.total_vat, d.total_gross, 'none'
from documents d
where d.deleted_at is null
  and d.total_gross is not null
  and not exists (select 1 from document_vat_summary s where s.document_id = d.id)
  and not exists (select 1 from document_lines l where l.document_id = d.id);

insert into document_lines (org_id, document_id, position, line_type, net, vat, gross, vat_rate_type)
select d.org_id, d.id,
       (select max(l.position) from document_lines l where l.document_id = d.id) + 1,
       'rounding', d.rounding, 0, d.rounding, 'none'
from documents d
where d.deleted_at is null
  and d.rounding <> 0
  and exists (select 1 from document_lines l where l.document_id = d.id)
  and not exists (select 1 from document_lines l where l.document_id = d.id and l.line_type = 'rounding');
