// M06 podklady database I/O: every read the annual summary needs for one org and year, mapped to the
// domain input types, plus the PODKLADY_DPFO filing write and the reserve cache. No computation here.
// Every query is org-scoped (rule 3). Money comes out as decimal strings, dates as YYYY-MM-DD.

import {
  type AnnualTotalsEntry,
  type AssetLineInput,
  BOOKABLE_CLASSES,
  CZK,
  type LegalDate,
  Money,
  type PodkladyAnswers,
  type PodkladyTransaction,
  type PrivateUseInput,
  type ProfileSegment,
  parseLegalDate,
  type ReadinessInput,
  resolveFxRate,
  convertToCzk,
  round2,
  type Currency,
  type VatNoteInput,
} from '@shoebox/domain';
import { eq, sql } from 'drizzle-orm';
import {
  type FilingRow,
  insertFiling,
  ledgerHashOf,
  listFilings,
  supersedeOpenFilings,
} from './filings';
import { taxReserveEstimates } from './schema/reserve';
import type { ServiceTx, TenantTx } from './tenant';

export interface PodkladyRows {
  readonly profiles: ProfileSegment[];
  readonly entries: AnnualTotalsEntry[];
  readonly assetLines: AssetLineInput[];
  readonly privateUse: PrivateUseInput;
  readonly vatFilings: VatNoteInput['vatFilings'];
  readonly transactions: PodkladyTransaction[];
  readonly readiness: Omit<ReadinessInput, 'year' | 'profiles'>;
  readonly taxpayer: { legalName: string; ico: string | null };
  readonly ledgerHash: string;
  readonly documents: ReadonlyArray<{ documentId: string; revision: number }>;
  /** Personal documents in a foreign currency with no ČNB rate (excluded from privateUse). */
  readonly privateUseFxMissing: readonly string[];
}

const PAYMENT_CATEGORIES = [
  'tax_vat_payment',
  'tax_income_payment',
  'tax_pausal_advance',
  'ins_social_own',
  'ins_health_own',
  'tax_other_fees',
] as const;

const czk = (text: string | null | undefined): Money => Money.parse(text ?? '0', CZK);
const legal = (text: string | null | undefined): LegalDate | null =>
  text ? parseLegalDate(text) : null;

async function rowsOf<T>(tx: TenantTx, query: ReturnType<typeof sql>): Promise<T[]> {
  return (await tx.execute(query)) as unknown as T[];
}

/** One org, one tax year: everything the podklady domain input needs. */
export async function readPodkladyRows(
  tx: TenantTx,
  orgId: string,
  year: number,
  currentLedgerAlgo: bigint,
  /** Rule `fx.max_lookback_days`: how far back a ČNB rate may be taken for a personal document. */
  fxMaxLookbackDays: number,
): Promise<PodkladyRows> {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const bookable = sql.join(
    BOOKABLE_CLASSES.map((c) => sql`${c}`),
    sql`, `,
  );

  // Profiles up to the end of the year (asset lines need the profile at their issue date).
  const profileRows = await rowsOf<{
    valid_from: string;
    valid_to: string | null;
    entity_type: string;
    tax_regime: ProfileSegment['taxRegime'];
    vat_status: ProfileSegment['vatStatus'];
    pausal_rate: number | null;
    pausal_dan_band: number | null;
    has_accountant: boolean;
    legal_name: string;
    ico: string;
  }>(
    tx,
    sql`select valid_from::text, valid_to::text, entity_type, tax_regime::text, vat_status::text, pausal_rate, pausal_dan_band, has_accountant, legal_name, ico
        from taxpayer_profiles
        where org_id = ${orgId} and valid_from <= ${yearEnd}::date
        order by valid_from`,
  );
  const allSegments: ProfileSegment[] = profileRows.map((p) => ({
    validFrom: parseLegalDate(p.valid_from),
    validTo: legal(p.valid_to),
    entityType: p.entity_type,
    taxRegime: p.tax_regime,
    vatStatus: p.vat_status,
    pausalRate: p.pausal_rate as ProfileSegment['pausalRate'],
    pausalDanBand: p.pausal_dan_band as ProfileSegment['pausalDanBand'],
    hasAccountant: p.has_accountant,
  }));
  const profiles = allSegments.filter((s) => s.validTo === null || s.validTo >= yearStart);
  const lastProfile = profileRows[profileRows.length - 1];
  const taxpayer = {
    legalName: lastProfile?.legal_name ?? '',
    ico: lastProfile?.ico ?? null,
  };
  const vatStatusAt = (date: LegalDate | null): string | null => {
    if (date === null) return null;
    const hit = [...allSegments]
      .reverse()
      .find((s) => s.validFrom <= date && (s.validTo === null || s.validTo >= date));
    return hit?.vatStatus ?? null;
  };

  // Tax ledger entries of the year (+ build_version for the hash and the stale count).
  const entryRows = await rowsOf<{
    entry_date: string;
    tax_year: number;
    basis: AnnualTotalsEntry['basis'];
    document_id: string | null;
    line_id: string | null;
    category_code: string;
    tax_effect: AnnualTotalsEntry['taxEffect'];
    amount_czk: string;
    business_share_pct: string;
    business_amount_czk: string;
    build_version: string;
    revision: number | null;
    ledger_algo: string | null;
  }>(
    tx,
    sql`select e.entry_date::text, e.tax_year::int, e.basis, e.document_id, e.line_id, e.category_code, e.tax_effect::text,
               e.amount_czk::text, e.business_share_pct::text, e.business_amount_czk::text, e.build_version::text, d.revision,
               d.stage_version->'ledger'->>'v' as ledger_algo
        from tax_ledger_entries e
        left join documents d on d.id = e.document_id and d.org_id = e.org_id
        where e.org_id = ${orgId} and e.tax_year = ${year}
        order by e.entry_date, e.document_id, e.line_id, e.id`,
  );
  const entries: AnnualTotalsEntry[] = entryRows.map((e) => ({
    entryDate: parseLegalDate(e.entry_date),
    taxYear: e.tax_year,
    basis: e.basis,
    documentId: e.document_id ?? '',
    lineId: e.line_id,
    categoryCode: e.category_code,
    taxEffect: e.tax_effect,
    amountCzk: e.amount_czk,
    businessSharePct: e.business_share_pct,
    businessAmountCzk: e.business_amount_czk,
  }));
  const withDoc = entryRows.filter((e) => e.document_id !== null);
  const ledgerHash = ledgerHashOf(
    withDoc.map((e) => ({ documentId: e.document_id as string, buildVersion: e.build_version })),
  );
  const docMap = new Map<string, { documentId: string; revision: number }>();
  for (const e of withDoc) {
    docMap.set(e.document_id as string, {
      documentId: e.document_id as string,
      revision: e.revision ?? 1,
    });
  }
  const documents = [...docMap.values()].sort((a, b) => a.documentId.localeCompare(b.documentId));
  // Stale = built by an older ledger algorithm (stage_version.ledger.v), not an older build_version sequence value.
  const staleEntries = entryRows.filter(
    (e) => e.document_id !== null && BigInt(e.ledger_algo ?? '0') < currentLedgerAlgo,
  ).length;

  // Asset lines.
  const assetRows = await rowsOf<{
    document_id: string;
    line_id: string;
    document_number: string | null;
    partner_name: string | null;
    description: string | null;
    issue_date: string | null;
    paid_at: string | null;
    vat_point_date: string | null;
    category_code: string;
    net: string | null;
    gross: string | null;
    business_share_pct: string;
    car_flag: boolean;
    paid_in_year: string;
  }>(
    tx,
    sql`select l.document_id, l.id as line_id, d.document_number, p.name as partner_name, l.description,
               d.issue_date::text, d.paid_at::text, d.vat_point_date::text, l.category_code,
               l.net::text, l.gross::text, l.business_share_pct::text,
               exists (select 1 from document_lines o where o.org_id = l.org_id and o.document_id = l.document_id and o.id <> l.id
                       and (o.category_code like 'exp\\_car\\_%' or o.category_code = 'exp_fuel')) as car_flag,
               coalesce((select sum(e.amount_czk) from tax_ledger_entries e
                         where e.org_id = l.org_id and e.line_id = l.id and e.tax_year = ${year} and e.basis <> 'provisional'), 0)::text as paid_in_year
        from document_lines l
        join documents d on d.id = l.document_id and d.org_id = l.org_id
        left join partners p on p.id = d.partner_id and p.org_id = d.org_id
        where l.org_id = ${orgId} and l.category_code in ('asset_long_term', 'exp_small_assets')
          and d.status in ('ready', 'finalized') and d.deleted_at is null
          and (d.paid_at between ${yearStart}::date and ${yearEnd}::date
               or d.issue_date between ${yearStart}::date and ${yearEnd}::date)
        order by d.issue_date, l.document_id, l.position`,
  );
  const assetLines: AssetLineInput[] = assetRows.map((a) => ({
    documentId: a.document_id,
    lineId: a.line_id,
    documentNumber: a.document_number,
    partnerName: a.partner_name,
    description: a.description,
    issueDate: legal(a.issue_date),
    paidAt: legal(a.paid_at),
    categoryCode: a.category_code,
    net: a.net === null ? null : czk(a.net),
    gross: a.gross === null ? null : czk(a.gross),
    businessSharePct: a.business_share_pct,
    vatDeducted: vatStatusAt(legal(a.vat_point_date) ?? legal(a.issue_date)) === 'platce',
    carFlag: a.car_flag,
    paidInYear: czk(a.paid_in_year),
  }));

  // Private use.
  const personalRows = await rowsOf<{
    document_id: string;
    paid_at: string;
    currency: string;
    amount: string;
    fx_rate: string | null;
  }>(
    tx,
    sql`select id as document_id, paid_at::text, currency, coalesce(total_gross, 0)::text as amount, fx_rate::text
        from documents
        where org_id = ${orgId} and business_flag = 'personal' and deleted_at is null
          and paid_at between ${yearStart}::date and ${yearEnd}::date
        order by paid_at, id`,
  );
  // ZDP § 38: foreign amounts enter the podklady in CZK. documents.fx_rate is the per-unit ČNB rate
  // set at categorization; without it, the ČNB fixing of the payment date (fx_rates) is used.
  const foreignCurrencies = [...new Set(personalRows.map((r) => r.currency).filter((c) => c !== 'CZK'))];
  const fxRows =
    foreignCurrencies.length === 0
      ? []
      : await rowsOf<{ rate_date: string; currency: string; amount: number; rate: string }>(
          tx,
          sql`select rate_date::text, currency, amount, rate::text from fx_rates
              where currency in (${sql.join(foreignCurrencies.map((c) => sql`${c}`), sql`, `)})
                and rate_date between (${yearStart}::date - ${fxMaxLookbackDays}::int) and ${yearEnd}::date
              order by rate_date`,
        );
  const privateUseFxMissing: string[] = [];
  const personalDocuments: PrivateUseInput['personalDocuments'][number][] = [];
  for (const r of personalRows) {
    const paidAt = parseLegalDate(r.paid_at);
    if (r.currency === 'CZK') {
      personalDocuments.push({ documentId: r.document_id, paidAt, amountCzk: czk(r.amount) });
      continue;
    }
    const foreign = Money.parse(r.amount, r.currency as Currency);
    if (r.fx_rate !== null) {
      personalDocuments.push({
        documentId: r.document_id,
        paidAt,
        amountCzk: round2(Money.fromDecimal(foreign.toDecimal().times(r.fx_rate), CZK)),
      });
      continue;
    }
    const fx = resolveFxRate(
      r.currency as Currency,
      paidAt,
      fxRows.map((x) => ({
        rateDate: parseLegalDate(x.rate_date),
        currency: x.currency as Currency,
        amount: x.amount,
        rate: x.rate,
      })),
      'rate_valid_on_date_else_last_published',
      fxMaxLookbackDays,
    );
    if (fx === null) {
      privateUseFxMissing.push(r.document_id);
      continue;
    }
    personalDocuments.push({ documentId: r.document_id, paidAt, amountCzk: round2(convertToCzk(foreign, fx)) });
  }
  const partialRows = await rowsOf<{
    document_id: string;
    line_id: string;
    description: string | null;
    total: string;
    share: string;
  }>(
    tx,
    sql`select l.document_id, l.id as line_id, l.description,
               coalesce((select sum(e.amount_czk) from tax_ledger_entries e
                         where e.org_id = l.org_id and e.line_id = l.id and e.tax_year = ${year}), 0)::text as total,
               l.business_share_pct::text as share
        from document_lines l
        join documents d on d.id = l.document_id and d.org_id = l.org_id
        where l.org_id = ${orgId} and l.business_share_pct > 0 and l.business_share_pct < 100
          and d.status in ('ready', 'finalized') and d.deleted_at is null and d.class in (${bookable})
          and exists (select 1 from tax_ledger_entries e
                      where e.org_id = l.org_id and e.line_id = l.id and e.tax_year = ${year})
        order by d.issue_date, l.document_id, l.position`,
  );
  const carRows = await rowsOf<{ id: string; answer: unknown }>(
    tx,
    sql`select id, answer from review_questions
        where org_id = ${orgId} and kind = 'car_regime' order by created_at, id`,
  );
  const privateUse: PrivateUseInput = {
    personalDocuments,
    partialShareLines: partialRows.map((r) => ({
      documentId: r.document_id,
      lineId: r.line_id,
      description: r.description,
      totalCzk: czk(r.total),
      businessSharePct: r.share,
    })),
    carRegimeAnswers: carRows.map((r) => {
      const a = (r.answer ?? {}) as { answer?: unknown; businessSharePct?: unknown };
      const answer = a.answer === 'actual_costs' || a.answer === 'flat_km' ? a.answer : null;
      const share =
        typeof a.businessSharePct === 'string' || typeof a.businessSharePct === 'number'
          ? String(a.businessSharePct)
          : null;
      return { questionId: r.id, answer, businessSharePct: share };
    }),
  };

  // VAT filings of the year.
  const vatRows = await rowsOf<{ period_start: string; row64: string | null; state: string }>(
    tx,
    sql`select period_start::text, totals->>'row64' as row64, state::text
        from filings
        where org_id = ${orgId} and type = 'DPHDP3' and state <> 'superseded'
          and period_start between ${yearStart}::date and ${yearEnd}::date
        order by period_start, id`,
  );
  const vatFilings: VatNoteInput['vatFilings'] = vatRows.map((r) => ({
    periodStart: parseLegalDate(r.period_start),
    row64: czk(r.row64),
    state: r.state,
  }));

  // Bank transactions: tax and insurance payments of the year.
  const txRows = await rowsOf<{ category_code: string; booked_on: string; amount: string }>(
    tx,
    sql`select category_code, booked_on::text, amount::text
        from transactions
        where org_id = ${orgId} and category_code in (${sql.join(
          PAYMENT_CATEGORIES.map((c) => sql`${c}`),
          sql`, `,
        )})
          and booked_on between ${yearStart}::date and ${yearEnd}::date
        order by booked_on, id`,
  );
  const transactions: PodkladyTransaction[] = txRows.map((r) => ({
    categoryCode: r.category_code,
    bookedOn: parseLegalDate(r.booked_on),
    amount: czk(r.amount),
  }));

  // Readiness counts.
  const [counts] = await rowsOf<{
    pending: number;
    unpaid: number;
    unknown_count: number;
    unknown_sum: string;
    unexplained_count: number;
    unexplained_sum: string;
  }>(
    tx,
    sql`select
      (select count(*)::int from documents where org_id = ${orgId} and deleted_at is null and class in (${bookable})
         and status not in ('ready', 'finalized')
         and (issue_date between ${yearStart}::date and ${yearEnd}::date or paid_at between ${yearStart}::date and ${yearEnd}::date)) as pending,
      (select count(*)::int from documents where org_id = ${orgId} and deleted_at is null and class = 'issued_invoice'
         and issue_date <= ${yearEnd}::date and paid_at is null) as unpaid,
      (select count(*)::int from documents where org_id = ${orgId} and deleted_at is null and business_flag = 'unknown'
         and paid_at between ${yearStart}::date and ${yearEnd}::date) as unknown_count,
      (select coalesce(sum(total_gross), 0)::text from documents where org_id = ${orgId} and deleted_at is null and business_flag = 'unknown'
         and paid_at between ${yearStart}::date and ${yearEnd}::date) as unknown_sum,
      (select count(*)::int from transactions where org_id = ${orgId} and amount < 0 and match_state = 'unmatched'
         and booked_on between ${yearStart}::date and ${yearEnd}::date) as unexplained_count,
      (select coalesce(sum(abs(amount)), 0)::text from transactions where org_id = ${orgId} and amount < 0 and match_state = 'unmatched'
         and booked_on between ${yearStart}::date and ${yearEnd}::date) as unexplained_sum`,
  );
  const readiness: PodkladyRows['readiness'] = {
    // TODO(ledger-stale): no build timestamp on documents, so documents finalized after the newest build are not counted.
    ledger: { staleEntries, documentsFinalizedAfterBuild: 0 },
    pendingDocuments: counts?.pending ?? 0,
    unpaidIssued: counts?.unpaid ?? 0,
    unexplainedTransactions: {
      count: counts?.unexplained_count ?? 0,
      sum: czk(counts?.unexplained_sum),
    },
    businessFlagUnknown: { count: counts?.unknown_count ?? 0, sum: czk(counts?.unknown_sum) },
  };

  return {
    profiles,
    entries,
    assetLines,
    privateUse,
    vatFilings,
    transactions,
    readiness,
    taxpayer,
    ledgerHash,
    documents,
    privateUseFxMissing,
  };
}

export interface PodkladyFilingInsert {
  readonly year: number;
  readonly totals: Record<string, unknown>;
  readonly answers: PodkladyAnswers;
  readonly answersVersion: number;
  readonly pdfPath: string | null;
  readonly xlsxPath: string | null;
  readonly generatedBy: string;
  readonly at: Date;
}

/** Supersedes the open PODKLADY_DPFO of the year, then inserts the new one with its document snapshot. totals gets ledgerHash and answersVersion added. */
export async function insertPodkladyFiling(
  tx: TenantTx,
  orgId: string,
  input: PodkladyFilingInsert,
  rows: PodkladyRows,
): Promise<{ filingId: string; supersededIds: string[] }> {
  const periodStart = `${input.year}-01-01`;
  const supersededIds = await supersedeOpenFilings(
    tx,
    orgId,
    'PODKLADY_DPFO',
    periodStart,
    'radne',
  );
  const filingId = await insertFiling(
    tx,
    {
      orgId,
      type: 'PODKLADY_DPFO',
      kind: 'radne',
      periodStart,
      periodEnd: `${input.year}-12-31`,
      state: 'generated',
      totals: {
        ...input.totals,
        ledgerHash: rows.ledgerHash,
        answersVersion: input.answersVersion,
      },
      inputs: input.answers,
      pdfPath: input.pdfPath,
      xlsxPath: input.xlsxPath,
      generatedAt: input.at,
      generatedBy: input.generatedBy,
      simpleCheck: {}, // column is not null; brief said null
    },
    rows.documents,
    [],
  );
  return { filingId, supersededIds };
}

/** Newest non-superseded PODKLADY_DPFO of the year. */
export async function latestPodkladyFiling(
  tx: TenantTx,
  orgId: string,
  year: number,
): Promise<FilingRow | null> {
  const rows = await listFilings(tx, orgId, {
    periodStart: `${year}-01-01`,
    types: ['PODKLADY_DPFO'],
    states: ['draft', 'generated', 'downloaded', 'marked_filed'],
  });
  return rows[0] ?? null;
}

export interface ReserveRow {
  readonly asOf: string;
  readonly taxYear: number;
  readonly kind: 'estimate' | 'pausalni_dan';
  readonly payload: unknown;
  readonly ledgerHash: string | null;
  readonly computedAt: Date;
}

export async function readReserveEstimate(tx: TenantTx, orgId: string): Promise<ReserveRow | null> {
  const [row] = await tx
    .select()
    .from(taxReserveEstimates)
    .where(eq(taxReserveEstimates.orgId, orgId))
    .limit(1);
  if (!row) return null;
  return {
    asOf: row.asOf,
    taxYear: row.taxYear,
    kind: row.kind as ReserveRow['kind'],
    payload: row.payload,
    ledgerHash: row.ledgerHash,
    computedAt: row.computedAt,
  };
}

export async function upsertReserveEstimate(
  tx: ServiceTx,
  orgId: string,
  row: Omit<ReserveRow, 'computedAt'>,
): Promise<void> {
  const values = {
    asOf: row.asOf,
    taxYear: row.taxYear,
    kind: row.kind,
    payload: row.payload,
    ledgerHash: row.ledgerHash,
    computedAt: sql`now()`,
  };
  await tx
    .insert(taxReserveEstimates)
    .values({ orgId, ...values })
    .onConflictDoUpdate({ target: taxReserveEstimates.orgId, set: values });
}

/** The header columns of the taxpayer profile that covers one date (DPFDP7 partial XML header). */
export interface TaxpayerHeaderRow {
  readonly fuCode: string | null;
  readonly ufoCode: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly title: string | null;
  readonly filingEmail: string | null;
  readonly filingPhone: string | null;
  readonly mainActivityNace: string | null;
  readonly address: unknown;
}

/** The profile covering `date` (YYYY-MM-DD), or null. */
export async function readTaxpayerHeaderAt(
  tx: TenantTx,
  orgId: string,
  date: string,
): Promise<TaxpayerHeaderRow | null> {
  const rows = await rowsOf<{
    fu_code: string | null;
    ufo_code: string | null;
    first_name: string | null;
    last_name: string | null;
    title: string | null;
    filing_email: string | null;
    filing_phone: string | null;
    main_activity_nace: string | null;
    address: unknown;
  }>(
    tx,
    sql`select fu_code, ufo_code, first_name, last_name, title, filing_email, filing_phone, main_activity_nace, address
        from taxpayer_profiles
        where org_id = ${orgId} and valid_from <= ${date}::date and (valid_to is null or valid_to >= ${date}::date)
        order by valid_from desc
        limit 1`,
  );
  const r = rows[0];
  if (r === undefined) return null;
  return {
    fuCode: r.fu_code,
    ufoCode: r.ufo_code,
    firstName: r.first_name,
    lastName: r.last_name,
    title: r.title,
    filingEmail: r.filing_email,
    filingPhone: r.filing_phone,
    mainActivityNace: r.main_activity_nace,
    address: r.address,
  };
}

export interface PartialFilingInsert {
  readonly year: number;
  readonly totals: Record<string, unknown>;
  readonly formVersion: string;
  readonly xsdValid: boolean | null;
  readonly generatedBy: string;
  readonly at: Date;
}

/** Supersedes the open DPFDP7_PARTIAL of the year, then inserts the new one. Totals only: no XML, no rodné číslo. */
export async function insertPartialFiling(
  tx: TenantTx,
  orgId: string,
  input: PartialFilingInsert,
): Promise<string> {
  const periodStart = `${input.year}-01-01`;
  await supersedeOpenFilings(tx, orgId, 'DPFDP7_PARTIAL', periodStart, 'radne');
  return insertFiling(
    tx,
    {
      orgId,
      type: 'DPFDP7_PARTIAL',
      kind: 'radne',
      periodStart,
      periodEnd: `${input.year}-12-31`,
      state: 'downloaded',
      formVersion: input.formVersion,
      totals: input.totals,
      inputs: {},
      xmlPath: null,
      xsdValid: input.xsdValid,
      generatedAt: input.at,
      generatedBy: input.generatedBy,
      simpleCheck: {},
    },
    [],
    [],
  );
}
