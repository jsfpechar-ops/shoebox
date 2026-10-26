import { pragueToday } from '@shoebox/domain';
import {
  buildIsdoc,
  buildPohodaDataPack,
  createXlsx,
  createZip,
  type PohodaDocument,
  type ZipEntry,
} from '@shoebox/exports';
import { t } from '@shoebox/i18n';
import { requireActiveRole } from '../../../src/auth/org-context';
import { loadExportDocs } from '../../../src/documents/export-data';
import {
  isdocInputOf,
  loadFormatData,
  pohodaDocumentOf,
  pohodaProfileOf,
} from '../../../src/documents/export-formats';
import {
  EXPORT_MAX_BYTES,
  exportEntryName,
  parsePeriod,
} from '../../../src/documents/export-period';
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
  if (total > EXPORT_MAX_BYTES) return Response.json({ error: 'too_big' }, { status: 413 });

  const used = new Set<string>();
  const isdocUsed = new Set<string>();
  const entries: ZipEntry[] = [];
  const entryNames = new Map<string, string>();
  let skipped = 0;
  for (const doc of docs) {
    if (doc.file === null) continue;
    const { data, error } = await supabase.storage.from('org-files').download(doc.file.path);
    if (error || data === null) {
      skipped += 1;
      continue;
    }
    const entryName = exportEntryName(doc.row, doc.file.name, doc.file.mime, used);
    entryNames.set(doc.row.id, entryName);
    entries.push({
      name: entryName,
      data: new Uint8Array(await data.arrayBuffer()),
    });
  }
  const sheet = createXlsx(
    t('register.sheet_name'),
    registerSheet(docs.map((doc) => doc.row)),
    new Date(),
  );
  entries.push({ name: `documents-${period.key}.xlsx`, data: new Uint8Array(sheet) });

  let warnings = 0;
  const formats = await loadFormatData(
    supabase,
    auth.orgId,
    docs.map((d) => d.row.id),
  );
  if (formats !== null) {
    const encoder = new TextEncoder();
    const pohodaDocs: PohodaDocument[] = [];
    for (const doc of formats.docs) {
      try {
        const input = isdocInputOf(auth.orgId, formats.org, doc);
        const xml = input === null ? null : buildIsdoc(input);
        if (xml !== null) {
          const source = docs.find((d) => d.row.id === doc.id);
          const known = entryNames.get(doc.id);
          const base =
            known !== undefined
              ? known.replace(/\.[^./]*$/, '')
              : source !== undefined
                ? exportEntryName(source.row, null, 'application/octet-stream', new Set()).replace(
                    /\.[^./]*$/,
                    '',
                  )
                : doc.id;
          let name = `isdoc/${base.replace(/\//g, '_')}.isdoc`;
          for (let n = 2; isdocUsed.has(name); n++) {
            name = `isdoc/${base.replace(/\//g, '_')} (${n}).isdoc`;
          }
          isdocUsed.add(name);
          entries.push({ name, data: encoder.encode(xml) });
        }
        const pohodaDoc = pohodaDocumentOf(doc);
        if (pohodaDoc !== null) pohodaDocs.push(pohodaDoc);
      } catch {
        skipped += 1;
      }
    }
    if (pohodaDocs.length > 0 && formats.org.ico !== null) {
      try {
        const result = buildPohodaDataPack(
          { periodLabel: period.key, version: 1, documents: pohodaDocs },
          pohodaProfileOf(formats.org, formats.labels),
        );
        warnings = result.warnings.length;
        entries.push({
          name: `pohoda_${formats.org.ico}_${period.key}_v1.xml`,
          data: encoder.encode(result.xml),
        });
      } catch {
        skipped += 1;
      }
    }
  }

  return new Response(new Uint8Array(createZip(entries, new Date())), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="sysel-${period.key}.zip"`,
      'Cache-Control': 'no-store',
      'X-Export-Skipped': String(skipped),
      'X-Export-Warnings': String(warnings),
    },
  });
}
