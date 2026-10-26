import type { createSupabaseServerClient } from '../supabase/server';
import { enqueueBankImport, enqueueDocSplit } from './enqueue';
import { restartFailedRead, supabaseReadAgainDeps } from './read-again';
import type { SourceFileInsert, UploadDeps } from './upload';

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** Adapts the signed-in request's Supabase client (RLS applies) to the upload flow's dependencies. */
export function supabaseUploadDeps(supabase: SupabaseServerClient): UploadDeps {
  return {
    async putFile(path, bytes, contentType) {
      const { error } = await supabase.storage
        .from('org-files')
        .upload(path, bytes, { contentType, upsert: false });
      if (error && !(String(error.statusCode) === '409' || error.message.includes('exists'))) {
        throw new Error('storage');
      }
    },
    async insertSourceFile(row: SourceFileInsert) {
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
          channel: 'upload',
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
    async findDocumentBySource(sourceFileId) {
      const { data, error } = await supabase
        .from('documents')
        .select('id')
        .eq('source_file_id', sourceFileId)
        .is('deleted_at', null)
        .limit(1)
        .maybeSingle();
      if (error) throw new Error('documents');
      return data?.id ?? null;
    },
    async insertDocument(row) {
      const { data, error } = await supabase
        .from('documents')
        .insert({
          org_id: row.orgId,
          source_file_id: row.sourceFileId,
          upload_batch_id: row.uploadBatchId,
          status: 'received',
          received_date: row.receivedDate,
        })
        .select('id')
        .single();
      if (error) throw new Error('documents');
      return data.id;
    },
    restartIfFailed: (orgId, documentId) =>
      restartFailedRead(supabaseReadAgainDeps(supabase), orgId, documentId),
    enqueueSort: enqueueDocSplit,
    enqueueStatement: (orgId, sourceFileId) => enqueueBankImport(orgId, sourceFileId),
    newBatchId: () => crypto.randomUUID(),
    today: () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague' }).format(new Date()),
  };
}
