import type { LegalDate } from '../dates/index';
import type { DocumentStatus, LineType, VatRateType, VatTreatment } from '../enums/index';
import { convertToCzk, type FxRate, type FxRateRow, resolveFxRate } from '../fx';
import { BOOKABLE_CLASSES } from '../ledgers/tax';
import { type Currency, CZK, Money, round2, vatForRate } from '../money/index';
import type { KhSection } from '../rules/cz/epo';
import {
  parseDphdp3RowMap,
  parseKhRouting,
  resolveDphdp3Rows,
  resolveKhSection,
} from '../rules/cz/epo';
import type { RULE_SCHEMAS } from '../rules/keys';
import type { RuleResolver } from '../rules/resolver';
import type { CategoryCode } from '../taxonomy/categories';
import {
  deriveVatPointDate,
  type PaymentEvidenceDate,
  type ProfileAt,
  periodFor,
  type VatPointDocument,
  type VatPointRule,
} from './point-date';

export type BusinessFlag = 'business' | 'personal' | 'mixed' | 'unknown';

export interface VatLedgerLine {
  readonly lineId: string;
  readonly position: number;
  readonly lineType: LineType;
  readonly net: Money | null;
  readonly vat: Money | null;
  readonly gross: Money | null;
  readonly vatTreatment: VatTreatment | null;
  readonly vatRateType: VatRateType;
  readonly categoryCode: CategoryCode | null;
  readonly businessSharePct: string;
}

export interface VatLedgerRecapRow {
  readonly vatRateType: VatRateType;
  readonly vatRatePct: number;
  readonly base: Money;
  readonly vat: Money;
}

export interface VatLedgerDocument extends VatPointDocument {
  readonly documentId: string;
  readonly status: DocumentStatus;
  readonly deleted: boolean;
  readonly businessFlag: BusinessFlag;
  readonly currency: Currency;
  readonly documentNumber: string | null;
  readonly totalGross: Money | null;
  readonly lines: readonly VatLedgerLine[];
  readonly recap: readonly VatLedgerRecapRow[];
}

export interface VatLedgerPartner {
  readonly country: string | null;
  readonly dic: string | null;
  readonly vatId: string | null;
  readonly vatIdValid: boolean | null;
}

export interface VatLedgerInput {
  readonly doc: VatLedgerDocument;
  readonly partner: VatLedgerPartner;
  readonly profileAt: ProfileAt;
  readonly payments: readonly PaymentEvidenceDate[];
  readonly fxRates: readonly FxRateRow[];
  readonly deductionAllowed: boolean;
  readonly rules: RuleResolver<typeof RULE_SCHEMAS>;
}

/** One row of `vat_ledger_entries` (05 §7) before `org_id`/`build_version`. */
export interface VatLedgerEntryDraft {
  readonly periodStart: LegalDate;
  readonly periodEnd: LegalDate;
  readonly vatPointDate: LegalDate;
  readonly vatPointRule: VatPointRule;
  readonly documentId: string;
  readonly lineId: null;
  readonly vatTreatment: VatTreatment;
  readonly vatRateType: VatRateType;
  readonly vatRatePct: number;
  readonly baseCzk: Money;
  readonly vatCzk: Money;
  readonly deductionPct: string;
  readonly currency: Currency;
  readonly baseForeign: Money | null;
  readonly fxRate: string | null;
  readonly fxAmount: number | null;
  readonly fxRateDate: LegalDate | null;
  readonly dphdp3Rows: readonly string[];
  readonly khSection: KhSection | null;
  readonly khDocumentTotalCzk: Money | null;
  readonly shvCode: 0 | 1 | 2 | 3 | null;
  readonly counterpartyVatId: string | null;
  readonly evidenceNumber: string | null;
}

export type VatLedgerIssueCode =
  | 'S_DATE_MISSING'
  | 'S_FX_MISSING'
  | 'S_SELF_ASSESSED_RATE_UNKNOWN'
  | 'S_MIXED_TREATMENT_SAME_RATE';

export interface VatLedgerIssue {
  readonly code: VatLedgerIssueCode;
  readonly vatTreatment: VatTreatment;
  readonly vatRateType: VatRateType;
}

export interface VatLedgerResult {
  readonly entries: VatLedgerEntryDraft[];
  readonly issues: VatLedgerIssue[];
}

export const SELF_ASSESSED_TREATMENTS: readonly VatTreatment[] = [
  'rcv_eu_service_reverse_charge',
  'rcv_non_eu_service_reverse_charge',
  'rcv_eu_goods_acquisition',
  'rcv_domestic_reverse_charge',
];
export const DOMESTIC_RECAP_TREATMENTS: readonly VatTreatment[] = [
  'iss_domestic_vat',
  'rcv_domestic_vat',
];
export const ZERO_VAT_ISSUED_TREATMENTS: readonly VatTreatment[] = [
  'iss_eu_service',
  'iss_eu_goods',
  'iss_non_eu_service',
  'iss_export_goods',
  'iss_exempt',
  'iss_no_vat',
  'iss_domestic_reverse_charge',
];
export const EVIDENCE_NUMBER_MAX = 60;

// TODO(rules): move to an epo.shv_codes key in Phase 3
const SHV_CODES = { iss_eu_goods: 0, iss_eu_service: 3, io_eu_service: 3 } as const;

interface Group {
  readonly treatment: VatTreatment;
  readonly rateType: VatRateType;
  readonly lines: VatLedgerLine[];
}

export function buildVatLedgerEntries(input: VatLedgerInput): VatLedgerResult {
  const { doc, partner, profileAt, payments, fxRates, deductionAllowed, rules } = input;
  const entries: VatLedgerEntryDraft[] = [];
  const issues: VatLedgerIssue[] = [];

  // 1. Gates.
  if (
    doc.deleted ||
    (doc.status !== 'ready' && doc.status !== 'finalized') ||
    !BOOKABLE_CLASSES.includes(doc.class) ||
    doc.businessFlag === 'personal'
  ) {
    return { entries, issues };
  }

  // 2. Usable lines, 3. groups in first-seen order.
  const usable: VatLedgerLine[] = [];
  const groups = new Map<string, Group>();
  for (const line of doc.lines) {
    if (line.lineType === 'text' || line.vatTreatment === null) continue;
    if (Money.parse(line.businessSharePct, CZK).isZero()) continue;
    usable.push(line);
    const key = `${line.vatTreatment}|${line.vatRateType}`;
    let group = groups.get(key);
    if (!group) {
      group = { treatment: line.vatTreatment, rateType: line.vatRateType, lines: [] };
      groups.set(key, group);
    }
    group.lines.push(line);
  }

  // 4. Per group.
  for (const group of groups.values()) {
    const { treatment, rateType, lines } = group;

    // 4a. VAT point date.
    const anchor = doc.duzp ?? doc.issueDate;
    if (anchor === null) {
      issues.push({ code: 'S_DATE_MISSING', vatTreatment: treatment, vatRateType: rateType });
      continue;
    }
    // No VAT point rule for this treatment (e.g. rcv_foreign_vat_charged, rcv_out_of_scope): nothing to report.
    const vp = deriveVatPointDate(doc, [treatment], profileAt, payments, rules);
    if (vp === null) continue;

    // 4b. Profile and period.
    const profile = profileAt(vp.date);
    if (profile.vatStatus === 'neplatce') continue;
    const period = periodFor(vp.date, profile);
    if (period === null) continue;

    // 4c. Rate.
    const at = rules.at(vp.date);
    const rates = at.get('vat.rates');
    const pct =
      rateType === 'standard' ? rates.standard : rateType === 'reduced' ? rates.reduced : 0;
    const selfAssessed = SELF_ASSESSED_TREATMENTS.includes(treatment);
    if (selfAssessed && pct === 0) {
      issues.push({
        code: 'S_SELF_ASSESSED_RATE_UNKNOWN',
        vatTreatment: treatment,
        vatRateType: rateType,
      });
      continue;
    }
    const zeroVat = ZERO_VAT_ISSUED_TREATMENTS.includes(treatment);

    // 4d. Amounts.
    const netSum = Money.sum(
      lines.map((l) => l.net ?? Money.zero(doc.currency)),
      doc.currency,
    );
    // Zero amounts add nothing; skipping them keeps a zero in another currency from mixing in.
    const vatSum = Money.sum(
      lines.flatMap((l) => (l.vat === null || l.vat.isZero() ? [] : [l.vat])),
      doc.currency,
    );
    let fx: FxRate | null = null;
    let base: Money;
    let vat: Money;
    if (doc.currency === CZK) {
      if (DOMESTIC_RECAP_TREATMENTS.includes(treatment)) {
        const mixed = usable.some(
          (l) => l.vatRateType === rateType && l.vatTreatment !== treatment,
        );
        if (mixed) {
          issues.push({
            code: 'S_MIXED_TREATMENT_SAME_RATE',
            vatTreatment: treatment,
            vatRateType: rateType,
          });
          continue;
        }
        const recapRow = doc.recap.find((r) => r.vatRateType === rateType);
        base = recapRow?.base ?? netSum;
        vat = recapRow?.vat ?? vatSum;
      } else {
        base = netSum;
        vat = selfAssessed ? vatForRate(base, String(pct)) : zeroVat ? Money.zero(CZK) : vatSum;
      }
    } else {
      fx = resolveFxRate(
        doc.currency,
        vp.date,
        fxRates,
        at.get('vat.cnb_rate_rule'),
        at.get('fx.max_lookback_days'),
      );
      if (fx === null) {
        issues.push({ code: 'S_FX_MISSING', vatTreatment: treatment, vatRateType: rateType });
        continue;
      }
      base = round2(convertToCzk(netSum, fx));
      vat = selfAssessed
        ? vatForRate(base, String(pct))
        : zeroVat
          ? Money.zero(CZK)
          : round2(convertToCzk(vatSum, fx));
    }

    // 4e. DPHDP3 rows.
    const rows = resolveDphdp3Rows(
      treatment,
      rateType,
      profile.vatStatus,
      deductionAllowed,
      parseDphdp3RowMap(at.get('epo.dphdp3_row_map')),
    );

    // 4f. KH section (payers only).
    let khSection: KhSection | null = null;
    let khDocumentTotalCzk: Money | null = null;
    if (profile.vatStatus === 'platce' && doc.totalGross !== null) {
      const docTotal = fx === null ? doc.totalGross : round2(convertToCzk(doc.totalGross, fx));
      const kh = resolveKhSection(
        {
          vatStatus: profile.vatStatus,
          treatment,
          docTotalCzk: docTotal,
          counterpartyCzDic: partner.dic?.startsWith('CZ') === true,
          taxDocStatus: doc.taxDocStatus,
          limitCzk: at.get('vat.kh_document_limit'),
        },
        parseKhRouting(at.get('epo.kh_routing')),
      );
      khSection = kh;
      khDocumentTotalCzk = kh === null ? null : docTotal.abs();
    }

    // 4g. SH code.
    let shvCode: 0 | 1 | 2 | 3 | null = null;
    if (treatment === 'iss_eu_goods') {
      shvCode = SHV_CODES.iss_eu_goods;
    } else if (treatment === 'iss_eu_service') {
      shvCode = SHV_CODES.iss_eu_service;
    } else if (
      profile.vatStatus === 'identifikovana_osoba' &&
      treatment === 'iss_no_vat' &&
      partner.country !== null &&
      at.get('vat.eu_member_states').includes(partner.country) &&
      partner.vatId !== null &&
      partner.vatIdValid === true &&
      lines.every((l) => l.categoryCode === 'income_services')
    ) {
      shvCode = SHV_CODES.io_eu_service;
    }

    // 4h. Nothing to report.
    if (rows.length === 0 && shvCode === null) continue;

    // 4i. Deduction share (smallest in the group, original string kept), counterparty, evidence.
    const shares = lines.map((l) => l.businessSharePct);
    const deductionPct = shares.reduce(
      (min, s) => (Money.parse(s, CZK).compare(Money.parse(min, CZK)) < 0 ? s : min),
      shares[0] ?? '100',
    );

    // 4j. Push the entry.
    entries.push({
      periodStart: period.start,
      periodEnd: period.end,
      vatPointDate: vp.date,
      vatPointRule: vp.rule,
      documentId: doc.documentId,
      lineId: null,
      vatTreatment: treatment,
      vatRateType: rateType,
      vatRatePct: pct,
      baseCzk: base,
      vatCzk: vat,
      deductionPct,
      currency: doc.currency,
      baseForeign: fx === null ? null : netSum,
      fxRate: fx === null ? null : fx.rate,
      fxAmount: fx === null ? null : fx.amount,
      fxRateDate: fx === null ? null : fx.rateDate,
      dphdp3Rows: rows,
      khSection,
      khDocumentTotalCzk,
      shvCode,
      counterpartyVatId: partner.country === 'CZ' ? partner.dic : partner.vatId,
      evidenceNumber: doc.documentNumber?.trim().slice(0, EVIDENCE_NUMBER_MAX) || null,
    });
  }

  return { entries, issues };
}
