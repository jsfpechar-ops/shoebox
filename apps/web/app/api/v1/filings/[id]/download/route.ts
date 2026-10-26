import { createZip, type ZipEntry } from '@shoebox/exports';
import { isUuid } from '../../../../../../src/auth/authz';
import { requireActiveRole } from '../../../../../../src/auth/org-context';
import { createSupabaseServerClient } from '../../../../../../src/supabase/server';
import {
  currentLedgerHash,
  decideDownload,
  FILING_DOWNLOAD_ROLES,
  type FilingView,
  loadBundle,
  loadFiling,
} from '../../../../../../src/vat/filings';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireActiveRole(FILING_DOWNLOAD_ROLES);
  if (!auth.ok)
    return Response.json(
      { error: auth.code },
      { status: auth.code === 'unauthenticated' ? 401 : 403 },
    );
  const { id } = await params;
  if (!isUuid(id)) return Response.json({ error: 'not_found' }, { status: 404 });
  const format = new URL(request.url).searchParams.get('format');
  const supabase = await createSupabaseServerClient();
  const filing = await loadFiling(supabase, auth.orgId, id);
  const bundle: FilingView[] =
    filing === null
      ? []
      : filing.bundleId === null
        ? [filing]
        : await loadBundle(supabase, auth.orgId, filing.bundleId);
  const hash =
    filing === null ? '' : await currentLedgerHash(supabase, auth.orgId, filing.periodStart);
  const decision = decideDownload(filing, bundle, hash, format);
  if (!decision.ok) return Response.json({ error: decision.error }, { status: decision.status });
  if (filing === null) return Response.json({ error: 'not_found' }, { status: 404 });

  const entries: ZipEntry[] = [];
  for (const item of decision.paths) {
    const { data, error } = await supabase.storage.from('org-files').download(item.path);
    if (error || data === null) return Response.json({ error: 'storage' }, { status: 500 });
    entries.push({ name: item.name, data: new Uint8Array(await data.arrayBuffer()) });
  }

  if (decision.markDownloaded) {
    // XML: the filing itself. ZIP: every generated filing of the bundle that went out in it.
    const ids =
      format === 'zip'
        ? bundle.filter((b) => b.state === 'generated').map((b) => b.id)
        : [filing.id];
    const marked = await supabase
      .from('filings')
      .update({ state: 'downloaded' })
      .eq('org_id', auth.orgId)
      .in('id', ids)
      .eq('state', 'generated');
    // Best effort: the file is already the user's; a failed state update is logged, not served as an error.
    if (marked.error)
      // biome-ignore lint/suspicious/noConsole: TODO(audit), the web app has no audit helper yet
      console.error(
        JSON.stringify({ event: 'filing.downloaded.mark_failed', filingId: filing.id }),
      );
  }
  // biome-ignore lint/suspicious/noConsole: TODO(audit), the web app has no audit helper yet
  console.info(JSON.stringify({ event: 'filing.downloaded', filingId: filing.id, format }));

  const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
  if (format === 'zip') {
    const zip = createZip(entries, new Date());
    return new Response(new Uint8Array(zip), {
      headers: {
        ...headers,
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="DPH-${filing.periodStart}.zip"`,
      },
    });
  }
  const xml = entries[0];
  if (xml === undefined) return Response.json({ error: 'not_generated' }, { status: 409 });
  const name = decision.paths[0]?.name ?? 'filing.xml';
  return new Response(new Uint8Array(xml.data), {
    headers: {
      ...headers,
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
    },
  });
}
