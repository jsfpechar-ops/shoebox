import { pragueToday } from '@shoebox/domain';
import { createXlsx, createZip, type ZipEntry } from '@shoebox/exports';
import { t } from '@shoebox/i18n';
import { requireActiveRole } from '../../../src/auth/org-context';
import { loadExportDocs } from '../../../src/documents/export-data';
import { EXPORT_MAX_BYTES, exportEntryName, parsePeriod } from '../../../src/documents/export-period';
import { registerSheet } from '../../../src/documents/register-data';
import { createSupabaseServerClient } from '../../../src/supabase/server';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  const auth = await requireActiveRole(['owner', 'member', 'accountant', 'viewer']);
  if (!auth.ok)
    return Response.json(
      { error: auth.code },
      { status: auth.code === 'unauthenticated' ? 401 : 403 },
    );
  const today = pragueToday({ now: () => Date.now() });
  const period = parsePeriod(new URL(request.url).searchParams.get('period'), today);
  const supabase = await createSupabaseServerClient();
  const docs = await loadExportDocs(supabase, auth.orgId, period);
  const total = docs.reduce((sum, doc) => sum + (doc.file?.size ?? 0), 0);
  if (total > EXPORT_MAX_BYTES)
    return Response.json({ error: 'too_big' }, { status: 413 });

  const used = new Set<string>();
  const entries: ZipEntry[] = [];
  let skipped = 0;
  for (const doc of docs) {
    if (doc.file === null) continue;
    const { data, error } = await supabase.storage.from('org-files').download(doc.file.path);
    if (error || data === null) {
      skipped += 1;
      continue;
    }
    entries.push({
      name: exportEntryName(doc.row, doc.file.name, doc.file.mime, used),
      data: new Uint8Array(await data.arrayBuffer()),
    });
  }
  const sheet = createXlsx(
    t('register.sheet_name'),
    registerSheet(docs.map((doc) => doc.row)),
    new Date(),
  );
  entries.push({ name: `documents-${period.key}.xlsx`, data: new Uint8Array(sheet) });

  return new Response(new Uint8Array(createZip(entries, new Date())), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="sysel-${period.key}.zip"`,
      'Cache-Control': 'no-store',
      'X-Export-Skipped': String(skipped),
    },
  });
}
