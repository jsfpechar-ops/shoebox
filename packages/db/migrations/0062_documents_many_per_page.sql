-- 0062_documents_many_per_page (05 §4): page sorting (0500-0513) makes several documents from one
-- file, and two receipts on one photo share a page, so documents_source_page (one document per
-- file page) no longer holds. document_pages records which pages each document has. Forward-only.
drop index if exists documents_source_page;
