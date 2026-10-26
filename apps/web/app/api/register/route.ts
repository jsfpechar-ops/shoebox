import { createXlsx, XLSX_MIME } from '@shoebox/exports';
import { t } from '@shoebox/i18n';
import { requireActiveRole } from '../../../src/auth/org-context';
import {
  applyRegisterFilter,
  loadRegister,
  parseRegisterFilter,
  registerFileName,
  registerSheet,
} from '../../../src/documents/register-data';
import { createSupabaseServerClient } from '../../../src/supabase/server';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  const auth = await requireActiveRole(['owner', 'member', 'accountant', 'viewer']);
  if (!auth.ok)
    return Response.json(
      { error: auth.code },
      { status: auth.code === 'unauthenticated' ? 401 : 403 },
    );
  const filter = parseRegisterFilter(new URL(request.url).searchParams);
  const rows = applyRegisterFilter(
    await loadRegister(await createSupabaseServerClient(), auth.orgId),
    filter,
  );
  const bytes = createXlsx(t('register.sheet_name'), registerSheet(rows), new Date());
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': XLSX_MIME,
      'Content-Disposition': `attachment; filename="${registerFileName(filter)}"`,
      'Cache-Control': 'no-store',
    },
  });
}
