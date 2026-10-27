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
import {
  countTrashedInPeriod,
  loadDocumentOverview,
  loadExportDocs,
} from '../../../src/documents/export-data';
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
import { buildReadme, type LeftOutItem } from '../../../src/documents/export-readme';
import { registerSheet, reviewStateOf } from '../../../src/documents/register-data';
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
  const overview = await loadDocumentOverview(supabase, auth.orgId);
  if (docs.length === 0) {
    const sorted = [...overview.dates].sort();
    return Response.json(
      {
        error: 'empty',
        hint: {
          first: sorted.length > 0 ? sorted[0]?.slice(0, 7) : null,
          last: sorted.length > 0 ? sorted[sorted.length - 1]?.slice(0, 7) : null,
          period: period.key,
        },
      },
      { status: 409, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const used = new Set<string>();
  const isdocUsed = new Set<string>();
  const entries: ZipEntry[] = [];
  const entryNames = new Map<string, string>();
  const leftOut: LeftOutItem[] = [];
  let skipped = 0;
  let budget = EXPORT_MAX_BYTES;
  const counts = { ready: 0, needs_review: 0, not_read: 0 };
  for (const doc of docs) {
    const state = reviewStateOf(doc.row.status);
    counts[state] += 1;
    if (doc.file === null) continue;
    const label = [doc.row.date, doc.row.partner, doc.row.number]
      .filter((part) => part !== null && part !== '')
      .join(' ');
    if (doc.file.size > budget) {
      leftOut.push({ label: label || doc.row.id, reason: 'too_big' });
      continue;
    }
    const { data, error } = await supabase.storage.from('org-files').download(doc.file.path);
    if (error || data === null) {
      skipped += 1;
      leftOut.push({ label: label || doc.row.id, reason: 'missing' });
      continue;
    }
    budget -= doc.file.size;
    const entryName = exportEntryName(
      doc.row,
      doc.file.name,
      doc.file.mime,
      used,
      state === 'needs_review',
    );
    entryNames.set(doc.row.id, entryName);
    entries.push({
      name: entryName,
      data: new Uint8Array(await data.arrayBuffer()),
    });
  }
  const registerName = `documents-${period.key}.xlsx`;
  const sheet = createXlsx(
    t('register.sheet_name'),
    registerSheet(docs.map((doc) => doc.row)),
    new Date(),
  );
  entries.push({ name: registerName, data: new Uint8Array(sheet) });

  let warnings = 0;
  let isdocCount = 0;
  let pohodaName: string | null = null;
  const encoder = new TextEncoder();
  const formats = await loadFormatData(
    supabase,
    auth.orgId,
    docs.map((d) => d.row.id),
  );
  if (formats !== null) {
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
          isdocCount += 1;
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
        pohodaName = `pohoda_${formats.org.ico}_${period.key}_v1.xml`;
        entries.push({ name: pohodaName, data: encoder.encode(result.xml) });
      } catch {
        skipped += 1;
      }
    }
  }

  const trashed = await countTrashedInPeriod(supabase, auth.orgId, period);
  entries.push({
    name: 'README.txt',
    data: encoder.encode(
      buildReadme({
        period: period.key,
        ready: counts.ready,
        needsReview: counts.needs_review,
        notRead: counts.not_read,
        registerName,
        isdocCount,
        pohodaName,
        leftOut,
        trashed,
        undated: overview.undated,
      }),
    ),
  });

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
