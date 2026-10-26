import type { ImportMapping, ImportOptions } from '@shoebox/pipeline';
import { enqueueImportRun, enqueueImportUndo } from '../documents/enqueue';
import type { createSupabaseServerClient } from '../supabase/server';
import type { ImportDeps } from './handlers';

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** Adapts the signed-in request's Supabase client (RLS applies) to the import handlers' dependencies. */
export function supabaseImportDeps(supabase: SupabaseServerClient): ImportDeps {
  return {
    async putFile(path, bytes, contentType) {
      const { error } = await supabase.storage
        .from('org-files')
        .upload(path, bytes, { contentType, upsert: false });
      if (error && !(String(error.statusCode) === '409' || error.message.includes('exists'))) {
        throw new Error('storage');
      }
    },
    async download(path) {
      const { data, error } = await supabase.storage.from('org-files').download(path);
      if (error) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
    async insertSourceFile(row) {
      const { data, error } = await supabase
        .from('source_files')
        .insert({
          org_id: row.orgId,
          sha256: row.sha256,
          storage_path: row.storagePath,
          mime_type: row.mimeType,
          byte_size: row.byteSize,
          original_filename: row.originalFilename,
          filename_nfc: row.filenameNfc,
          uploaded_by: row.uploadedBy,
          channel: 'import',
        })
        .select('id')
        .single();
      if (!error) return { id: data.id, created: true };
      if (error.code !== '23505') throw new Error('source_files');
      const existing = await supabase
        .from('source_files')
        .select('id')
        .eq('org_id', row.orgId)
        .eq('sha256', row.sha256)
        .single();
      if (existing.error) throw new Error('source_files');
      return { id: existing.data.id, created: false };
    },
    async findImportBySource(sourceFileId) {
      const { data, error } = await supabase
        .from('spreadsheet_imports')
        .select('created_at')
        .eq('source_file_id', sourceFileId)
        .limit(1)
        .maybeSingle();
      if (error) throw new Error('spreadsheet_imports');
      return data === null ? null : { createdAt: data.created_at };
    },
    async insertImport(row) {
      const { data, error } = await supabase
        .from('spreadsheet_imports')
        .insert({
          org_id: row.orgId,
          source_file_id: row.sourceFileId,
          row_count: row.rowCount,
          created_by: row.userId,
        })
        .select('id')
        .single();
      if (error) throw new Error('spreadsheet_imports');
      return data.id;
    },
    async loadImport(id) {
      const { data, error } = await supabase
        .from('spreadsheet_imports')
        .select(
          'id, org_id, state, source_file_id, row_count, imported_count, skipped_count, duplicate_count, created_at, source_files(storage_path, original_filename)',
        )
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error('spreadsheet_imports');
      if (data === null) return null;
      const file = Array.isArray(data.source_files) ? data.source_files[0] : data.source_files;
      if (file === undefined || file === null) return null;
      return {
        id: data.id,
        orgId: data.org_id,
        state: data.state,
        sourceFileId: data.source_file_id,
        storagePath: file.storage_path,
        fileName: file.original_filename ?? '',
        rowCount: data.row_count,
        importedCount: data.imported_count,
        skippedCount: data.skipped_count,
        duplicateCount: data.duplicate_count,
        createdAt: data.created_at,
      };
    },
    async findSavedMapping(orgId, signature) {
      const { data, error } = await supabase
        .from('import_mappings')
        .select('mapping, options')
        .eq('org_id', orgId)
        .eq('kind', 'documents')
        .eq('header_signature', signature)
        .order('last_used_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error('import_mappings');
      if (data === null) return null;
      return {
        mapping: data.mapping as ImportMapping,
        options: data.options as ImportOptions,
      };
    },
    async saveMapping(row) {
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from('import_mappings')
        .upsert(
          {
            org_id: row.orgId,
            kind: 'documents',
            header_signature: row.headerSignature,
            mapping: row.mapping,
            options: row.options,
            created_by: row.userId,
            last_used_at: now,
            updated_at: now,
          },
          { onConflict: 'org_id,kind,money_account_id,header_signature' },
        )
        .select('id')
        .single();
      if (error) throw new Error('import_mappings');
      return data.id;
    },
    async markStarted(importId, mappingId) {
      const { data, error } = await supabase
        .from('spreadsheet_imports')
        .update({ state: 'importing', mapping_id: mappingId })
        .eq('id', importId)
        .eq('state', 'parsed')
        .select('id');
      if (error) throw new Error('spreadsheet_imports');
      return (data ?? []).length > 0;
    },
    enqueueRun: enqueueImportRun,
    enqueueUndo: enqueueImportUndo,
  };
}
