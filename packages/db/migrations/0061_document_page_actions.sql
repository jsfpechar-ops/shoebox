-- 0061_document_page_actions: the user's fixes after page sorting (briefs 0510-0512). security
-- invoker: RLS decides (owner and member may write). Each returns the documents to read again.

-- "These are separate invoices": every page after the first becomes its own document.
create or replace function public.separate_document_pages(p_document_id uuid) returns uuid[]
  language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare
  v_doc documents%rowtype;
  v_page document_pages%rowtype;
  v_new uuid;
  v_ids uuid[];
begin
  select * into v_doc from documents
    where id = p_document_id and deleted_at is null and status <> 'finalized';
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if (select count(*) from document_pages where document_id = v_doc.id) < 2 then
    return '{}'::uuid[];
  end if;
  v_ids := array[v_doc.id];
  for v_page in
    select * from document_pages where document_id = v_doc.id and position > 1 order by position
  loop
    insert into documents (org_id, source_file_id, status, received_date, upload_batch_id)
      values (v_doc.org_id, v_page.source_file_id, 'received', v_doc.received_date, v_doc.upload_batch_id)
      returning id into v_new;
    insert into document_pages (org_id, document_id, position, source_file_id, file_page, region,
        supplier_key, doc_number, label_n, label_of, has_totals, starts_document)
      values (v_doc.org_id, v_new, 1, v_page.source_file_id, v_page.file_page, v_page.region,
        v_page.supplier_key, v_page.doc_number, v_page.label_n, v_page.label_of, v_page.has_totals,
        v_page.starts_document);
    v_ids := v_ids || v_new;
  end loop;
  delete from document_pages where document_id = v_doc.id and position > 1;
  update documents set status = 'received' where id = v_doc.id;
  return v_ids;
end $$;

-- "Add a missing page" / "Yes, one invoice": p_other's pages go after p_document_id's; p_other is
-- removed (soft delete) and open same_invoice questions of both are answered.
create or replace function public.join_documents(p_document_id uuid, p_other_id uuid) returns uuid[]
  language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare
  v_doc documents%rowtype;
  v_other documents%rowtype;
  v_max smallint;
begin
  if p_document_id = p_other_id then
    raise exception 'same_document' using errcode = '22023';
  end if;
  select * into v_doc from documents
    where id = p_document_id and deleted_at is null and status <> 'finalized';
  select * into v_other from documents
    where id = p_other_id and deleted_at is null and status <> 'finalized';
  if v_doc.id is null or v_other.id is null or v_doc.org_id <> v_other.org_id then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  -- A document from before page sorting has no page rows: its whole file is its pages.
  if not exists (select 1 from document_pages where document_id = v_doc.id) then
    insert into document_pages (org_id, document_id, position, source_file_id, file_page)
      select v_doc.org_id, v_doc.id, g, v_doc.source_file_id, g
      from generate_series(1, coalesce((select page_count from source_files where id = v_doc.source_file_id), 1)) g;
  end if;
  select max(position) into v_max from document_pages where document_id = v_doc.id;
  if exists (select 1 from document_pages where document_id = v_other.id) then
    insert into document_pages (org_id, document_id, position, source_file_id, file_page, region,
        supplier_key, doc_number, label_n, label_of, has_totals, starts_document)
      select org_id, v_doc.id, v_max + position, source_file_id, file_page, region, supplier_key,
        doc_number, label_n, label_of, has_totals, starts_document
      from document_pages where document_id = v_other.id;
    delete from document_pages where document_id = v_other.id;
  else
    insert into document_pages (org_id, document_id, position, source_file_id, file_page)
      select v_doc.org_id, v_doc.id, v_max + g, v_other.source_file_id, g
      from generate_series(1, coalesce((select page_count from source_files where id = v_other.source_file_id), 1)) g;
  end if;
  update documents set deleted_at = now() where id = v_other.id;
  update documents set status = 'received' where id = v_doc.id;
  update review_questions
    set answer = '{"same": true}'::jsonb, answered_by = auth.uid(), answered_at = now()
    where kind = 'same_invoice' and answered_at is null and document_id in (v_doc.id, v_other.id);
  return array[v_doc.id];
end $$;

revoke execute on function public.separate_document_pages(uuid) from public, anon;
revoke execute on function public.join_documents(uuid, uuid) from public, anon;
grant execute on function public.separate_document_pages(uuid) to authenticated;
grant execute on function public.join_documents(uuid, uuid) to authenticated;
