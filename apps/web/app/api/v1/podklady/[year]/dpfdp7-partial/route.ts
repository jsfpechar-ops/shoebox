import { insertPartialFiling } from '@shoebox/db';
import { createCzRules, pragueToday } from '@shoebox/domain';
import { logger } from '@shoebox/platform';
import {
  dpfdp7FileName,
  isPartialXmlAvailable,
  redactRodneCislo,
  serializeDpfdp7Partial,
  validateXml,
} from '@shoebox/tax-xml';
import { requireActiveRole } from '../../../../../../src/auth/org-context';
import { podkladyDb } from '../../../../../../src/podklady/db';
import {
  buildPartialFilingTotals,
  decidePartialXml,
  partialXmlLogFields,
  toDpfHeader,
} from '../../../../../../src/podklady/dpfdp7';
import { loadPodkladySummary } from '../../../../../../src/podklady/load';
import { parseYearParam } from '../../../../../../src/podklady/preview';
import { appOrigin } from '../../../../../../src/supabase/server';

export const runtime = 'nodejs';

const NO_STORE = 'no-store';

// Never log a body, an error message or the XML here: only partialXmlLogFields and error.name.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ year: string }> },
): Promise<Response> {
  if (request.headers.get('origin') !== appOrigin())
    return Response.json({ error: 'origin' }, { status: 403 });
  const auth = await requireActiveRole(['owner', 'member', 'accountant', 'viewer']);
  if (!auth.ok)
    return Response.json(
      { error: auth.code },
      { status: auth.code === 'unauthenticated' ? 401 : 403 },
    );
  const year = parseYearParam((await params).year, pragueToday({ now: () => Date.now() }));
  if (year === null) return Response.json({ error: 'not_found' }, { status: 404 });
  try {
    if (auth.role !== 'owner') {
      return Response.json(
        { error: 'forbidden' },
        { status: 403, headers: { 'Cache-Control': NO_STORE } },
      );
    }
    const rules = createCzRules();
    const forms = rules.at(`${year}-01-01`).get('epo.forms') as Record<
      string,
      { version?: string } | undefined
    >;
    const version = forms.DPFDP7?.version ?? '';
    const { summary, ledgerHash, profileAtYearEnd } = await loadPodkladySummary(auth.orgId, year);
    const body: unknown = await request.json().catch(() => null);
    const decision = decidePartialXml({
      role: auth.role,
      flagOn: rules.at(`${year}-12-31`).get('feature.dpfdp7_partial') === true,
      xsdAvailable: isPartialXmlAvailable(year, rules),
      partialXmlEligible: summary.partialXmlEligible,
      flatRate: summary.flatRate,
      body,
    });
    if (!decision.ok || summary.flatRate === null) {
      const status = decision.ok ? 404 : decision.status;
      const error = decision.ok ? 'not_found' : decision.error;
      return Response.json({ error }, { status, headers: { 'Cache-Control': NO_STORE } });
    }
    if (profileAtYearEnd === null) {
      return Response.json({ error: 'not_found' }, { status: 404 });
    }
    const fr = summary.flatRate;
    const xml = serializeDpfdp7Partial(
      {
        year,
        header: toDpfHeader(profileAtYearEnd),
        income: fr.incomeKc,
        flat: fr.flat,
        rate: fr.rate,
        appVersion: process.env.SHOEBOX_APP_VERSION ?? '0.0.0',
      },
      decision.rodneCislo,
      rules,
    );
    const v = await validateXml(xml, 'DPFDP7', version);
    const xsdValid: boolean | null = v.method === 'xsd' ? v.valid : null;
    if (!v.valid) {
      const text = redactRodneCislo(
        v.errors.map((e) => `${e.element ?? ''} ${e.message}`.trim()).join('; '),
      ).slice(0, 500);
      logger.warn(
        { ...partialXmlLogFields(auth.orgId, year, null, false), errorReason: text },
        'dpfdp7_partial.xml_invalid',
      );
      return Response.json(
        { error: 'xml_invalid' },
        { status: 422, headers: { 'Cache-Control': NO_STORE } },
      );
    }
    const filingId = await podkladyDb().withTenant(auth.orgId, (tx) =>
      insertPartialFiling(tx, auth.orgId, {
        year,
        totals: buildPartialFilingTotals(fr, ledgerHash),
        formVersion: `DPFDP7 ${version}`,
        xsdValid,
        generatedBy: auth.userId,
        at: new Date(),
      }),
    );
    logger.info(partialXmlLogFields(auth.orgId, year, filingId, xsdValid), 'dpfdp7_partial.served');
    const headers: Record<string, string> = {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="${dpfdp7FileName(year)}"`,
      'Cache-Control': NO_STORE,
    };
    if (!decision.checksumOk) headers['X-Rodne-Cislo-Checksum'] = 'mismatch';
    return new Response(xml, { status: 200, headers });
  } catch (error) {
    logger.error(
      {
        ...partialXmlLogFields(auth.orgId, year, null, null),
        errorCode: error instanceof Error ? error.name : 'unknown',
      },
      'dpfdp7_partial.failed',
    );
    return Response.json(
      { error: 'failed' },
      { status: 500, headers: { 'Cache-Control': NO_STORE } },
    );
  }
}
