import type { CategorizationWrite, CategorizeLineRow, DocumentForCategorize } from '@shoebox/db';
import {
  buildSummary,
  CATEGORIES,
  type CascadeInput,
  type CascadeLine,
  type CascadeLlmLine,
  type CategoryCode,
  type CategoryDecision,
  CZK,
  categoryAllowsDirection,
  type Direction,
  type DocumentClass,
  deriveVatPointDate,
  deriveVatTreatment,
  type FxRate,
  type FxRateRow,
  findCategory,
  getCategory,
  isCategoryValidOn,
  type LegalDate,
  type LineType,
  Money,
  type ProfileAt,
  parseClassificationRules,
  parseLegalDate,
  type RULE_SCHEMAS,
  type RuleResolver,
  resolveFxRate,
  resolveVatPeriod,
  runCategoryCascade,
  SELF_ASSESSED_TREATMENTS,
  type SupplyKind,
  type TaxDocStatus,
  type VatPeriod,
  type VatStatus,
  type VatTreatment,
  type VatTreatmentParty,
  type VatTreatmentResult,
} from '@shoebox/domain';
import type { CategorizeOutput, CategorizeRequestInput } from '@shoebox/extraction';
import { applyAnswers, openKinds, type QuestionKind, type UserLineField } from './answers';
import { buildQuestions, type QuestionContext } from './questions';

export interface PostCheckRow {
  readonly ruleId: string;
  readonly severity: 'blocking' | 'warning' | 'info';
}
export interface PlanInput {
  readonly doc: DocumentForCategorize;
  readonly llm: CategorizeOutput | null;
  readonly rules: RuleResolver<typeof RULE_SCHEMAS>;
  readonly today: LegalDate;
  readonly model: string; // for the LLM request input
  readonly categorizeVersion: number; // docCategorizeJob.version
  readonly postChecks?: readonly PostCheckRow[]; // TODO(P1-VAL-08): lane B's post_categorize checks; default []
}
export interface PlanResult {
  readonly needsLlm: boolean;
  readonly llmRequest: CategorizeRequestInput | null; // set when needsLlm
  readonly write: Omit<CategorizationWrite, 'runs'>;
  readonly event: {
    readonly lowConfidenceLines: number[];
    readonly questions: string[];
    readonly deferred: string[];
    readonly dominantLineId: string; // feeds vendor memory (0322)
  };
}

export class CategorizeInputError extends Error {
  constructor(reason: string) {
    super(`CategorizeInputError: ${reason}`);
    this.name = 'CategorizeInputError';
  }
}

type FieldWrite = CategorizationWrite['fields'][number];
type LineWrite = CategorizationWrite['lines'][number];
type FieldSourceOut = FieldWrite['source'];

const LINE_FIELD_RE = /^lines\[(\d+)\]\.(category_code|business_share_pct|supply_kind)$/;
const WRITE_SOURCES: readonly string[] = ['llm', 'rule', 'vendor_memory', 'derived', 'user'];
const NO_PROFILE = {
  vatStatus: 'neplatce' as VatStatus,
  vatPeriod: null,
  foreignServiceDppdPolicy: 'issue_date' as const,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function date(value: string | null): LegalDate | null {
  return value === null ? null : parseLegalDate(value);
}

function conf(value: number): string {
  return value.toFixed(3);
}

function sourceOut(source: string): FieldSourceOut {
  return WRITE_SOURCES.includes(source) ? (source as FieldSourceOut) : 'rule';
}

function pickBusinessFlag(value: string | null): 'business' | 'personal' | 'mixed' | null {
  return value === 'business' || value === 'personal' || value === 'mixed' ? value : null;
}

function moneyOrNull(text: string | null, currency: string): Money | null {
  return text === null ? null : Money.parse(text, currency);
}

export function planCategorization(input: PlanInput): PlanResult {
  const { doc, llm, rules, today } = input;
  if (doc.direction !== 'in' && doc.direction !== 'out') {
    throw new CategorizeInputError('direction');
  }
  if (doc.issueDate === null) throw new CategorizeInputError('issue_date');
  if (doc.lines.length === 0) throw new CategorizeInputError('no lines');
  const direction: Direction = doc.direction;
  const issueDate = parseLegalDate(doc.issueDate);
  const docClass = doc.class as DocumentClass;
  const taxDocStatus = doc.taxDocStatus as TaxDocStatus;
  const rulesAt = rules.at(issueDate);
  const cls = parseClassificationRules(rulesAt);

  // (1) profile at issue date, settings
  const profileRowAt = (at: LegalDate) =>
    [...doc.profiles]
      .filter((p) => p.validFrom <= at && (p.validTo === null || p.validTo >= at))
      .sort((a, b) => (a.validFrom < b.validFrom ? 1 : a.validFrom > b.validFrom ? -1 : 0))[0] ??
    null;
  const profileAt: ProfileAt = (at) => {
    const row = profileRowAt(at);
    if (row === null) return NO_PROFILE;
    return {
      vatStatus: row.vatStatus as VatStatus,
      vatPeriod: row.vatPeriod as VatPeriod | null,
      foreignServiceDppdPolicy:
        (row.foreignServiceDppdPolicy as 'issue_date' | 'service_period_end' | null) ??
        'issue_date',
    };
  };
  const vatStatus = profileAt(issueDate).vatStatus;
  const deductionAllowed = vatStatus === 'platce'; // TODO(decision-deduction)

  const settingsRaw = isRecord(doc.orgSettings) ? doc.orgSettings : {};
  const car = isRecord(settingsRaw.car) ? settingsRaw.car : {};
  const carShare = car.business_share_pct;
  const settings = {
    activityKeywords: strList(settingsRaw.activity_keywords),
    carBusinessSharePct:
      typeof carShare === 'string' || typeof carShare === 'number' ? String(carShare) : null,
    hiddenCategoryCodes: strList(settingsRaw.hidden_categories),
  };

  // FX before the cascade
  const foreign = doc.currency !== CZK;
  const fxRows: FxRateRow[] = doc.fxRates.map((r) => ({
    rateDate: parseLegalDate(r.rateDate),
    currency: r.currency,
    amount: r.amount,
    rate: r.rate,
  }));
  const fxRule = rulesAt.get('vat.cnb_rate_rule');
  const fxLookback = rulesAt.get('fx.max_lookback_days');
  const fxAtIssue: FxRate | null = foreign
    ? resolveFxRate(doc.currency, issueDate, fxRows, fxRule, fxLookback)
    : null;
  const fxRateToCzk: string | null = foreign
    ? (doc.fxRate ?? fxAtIssue?.perUnit.toFixed(6) ?? null)
    : null;

  // user fields
  const lineIdToPosition = new Map(doc.lines.map((l) => [l.id, l.position]));
  const answerFields: UserLineField[] = applyAnswers(doc.questions, lineIdToPosition);
  const userValues = new Map<string, string>(); // `${position}|${key}` → value
  const userKeys = new Set<string>(); // field keys already owned by the user
  for (const line of doc.lines) {
    if (line.classificationSource !== 'user') continue;
    if (line.categoryCode !== null) {
      userValues.set(`${line.position}|category_code`, line.categoryCode);
      userKeys.add(`lines[${line.position}].category_code`);
    }
    userValues.set(`${line.position}|business_share_pct`, line.businessSharePct);
    userKeys.add(`lines[${line.position}].business_share_pct`);
  }
  let userSubject: string | null = null;
  let fieldSubject: string | null = null;
  for (const f of doc.fields) {
    if (f.source === 'user') userKeys.add(f.fieldKey);
    const m = LINE_FIELD_RE.exec(f.fieldKey);
    if (f.source === 'user' && m && f.valueText !== null) {
      userValues.set(`${m[1]}|${m[2]}`, f.valueText);
    }
    if (f.fieldKey === 'summary.subject' && f.valueText !== null) {
      if (f.source === 'user') userSubject = f.valueText;
      else if (f.source === 'llm') fieldSubject = f.valueText;
    }
  }
  for (const f of answerFields) userValues.set(`${f.position}|${f.key}`, f.value);
  const userOf = (position: number, key: UserLineField['key']): string | null =>
    userValues.get(`${position}|${key}`) ?? null;

  // (2) cascade
  const llmByPosition = new Map((llm?.lines ?? []).map((l) => [l.position, l]));
  const cascadeLines: CascadeLine[] = doc.lines.map((l: CategorizeLineRow) => ({
    lineId: l.id,
    position: l.position,
    lineType: l.lineType as LineType,
    description: l.description,
    quantity: l.quantity,
    net: moneyOrNull(l.net, doc.currency),
    vat: moneyOrNull(l.vat, doc.currency),
    gross: moneyOrNull(l.gross, doc.currency),
    userCategoryCode: userOf(l.position, 'category_code'),
    userBusinessSharePct: userOf(l.position, 'business_share_pct'),
    statementColumn: null,
  }));
  const vendor = doc.vendor;
  const cascadeInput: CascadeInput = {
    doc: {
      class: docClass,
      direction,
      issueDate,
      currency: doc.currency,
      fxRateToCzk,
      personalPurchaseSuspected: llm?.businessLikelihood === 'personal', // TODO(P1-VAL-08)
    },
    lines: cascadeLines,
    supplier: doc.partner ? { name: doc.partner.name, naceCodes: [], authorityKind: null } : null,
    vendor: vendor
      ? {
          pinned: vendor.pinned,
          multiCategory: vendor.multiCategory,
          confirmations: vendor.confirmations,
          defaultCategoryCode: vendor.defaultCategoryCode,
          defaultBusinessFlag: pickBusinessFlag(vendor.defaultBusinessFlag),
        }
      : null,
    original: null,
    settings,
    vatStatusAtIssue: vatStatus,
    deductionAllowed,
    ...(llm
      ? {
          llm: {
            lines: llm.lines.map(
              (l): CascadeLlmLine => ({
                position: l.position,
                categoryCode: l.categoryCode,
                confidence: l.confidence,
                assetCandidate: l.assetCandidate,
              }),
            ),
          },
        }
      : {}),
    rules,
  };
  const cascade = runCategoryCascade(cascadeInput);
  const decisionOf = new Map<number, CategoryDecision>(cascade.lines.map((d) => [d.position, d]));

  // subject
  const hintRaw = isRecord(vendor?.extractionHints) ? vendor.extractionHints.subject_cs : null;
  const vendorHint = typeof hintRaw === 'string' && hintRaw.trim() !== '' ? hintRaw : null;
  const runSubject = llm?.subject ?? null;
  const llmSubject = runSubject ?? fieldSubject;
  const hasSubject = [userSubject, llmSubject, vendorHint].some(
    (s) => s !== null && s.trim() !== '',
  );
  const needsLlm = llm === null && (cascade.needsLlm.length > 0 || !hasSubject);

  // (4) VAT treatment per line
  const supplier: VatTreatmentParty | null = doc.partner
    ? {
        country: doc.partner.country,
        czDic: doc.partner.dic,
        vatId: doc.partner.vatId,
        vatIdValid: null,
        isVatPayer: doc.partner.isVatPayer,
      }
    : null;
  const customer: VatTreatmentParty = {
    country: 'CZ',
    czDic: doc.orgDic,
    vatId: null,
    vatIdValid: null,
    isVatPayer: vatStatus !== 'neplatce',
  };
  const treatmentOf = new Map<number, VatTreatmentResult>();
  const extraLineKinds: { lineId: string; kind: 'supply_kind' }[] = [];
  for (const l of doc.lines) {
    const decision = decisionOf.get(l.position);
    if (!decision || decision.categoryCode === null) continue;
    const llmLine = llmByPosition.get(l.position);
    const userKind = userOf(l.position, 'supply_kind');
    const llmKind = llmLine?.supplyKind;
    const supplyKind: SupplyKind | null =
      userKind === 'service' || userKind === 'goods'
        ? userKind
        : llmKind === 'service' || llmKind === 'goods'
          ? llmKind
          : null;
    const result = deriveVatTreatment({
      direction,
      docClass,
      taxDocStatus,
      issueDate,
      flags: {
        reverseCharge92a: false,
        customsDeclaration: false,
        placeOfSupplyAbroad: llmLine?.placeOfSupplyAbroad ?? false,
      },
      line: {
        vat: moneyOrNull(l.vat, doc.currency),
        vatRatePct: l.vatRatePct,
        rcCommodityCode: l.rcCommodityCode,
        categoryCode: decision.categoryCode,
        isStatementIncomeLine:
          l.lineType === 'item' &&
          docClass === 'platform_statement' &&
          (moneyOrNull(l.gross, doc.currency)?.isPositive() ?? false),
      },
      supplier,
      customer,
      supplyKind,
      vatStatus,
      rules,
    });
    treatmentOf.set(l.position, result);
    if (result.ambiguous === 'supply_kind' || llmKind === 'mixed') {
      extraLineKinds.push({ lineId: l.id, kind: 'supply_kind' });
    }
  }

  // (5) VAT point date, rate, FX date
  const treatments: VatTreatment[] = [];
  for (const r of treatmentOf.values()) if (r.treatment !== null) treatments.push(r.treatment);
  const userPointRaw = doc.fields.find(
    (f) => f.fieldKey === 'document.vat_point_date' && f.source === 'user',
  )?.valueText;
  const point = deriveVatPointDate(
    {
      class: docClass,
      direction,
      taxDocStatus,
      issueDate,
      duzp: date(doc.duzp),
      receivedDate: date(doc.receivedDate),
      servicePeriodFrom: date(doc.servicePeriodFrom),
      servicePeriodTo: date(doc.servicePeriodTo),
      paidAt: date(doc.paidAt),
      userVatPointDate: userPointRaw ? parseLegalDate(userPointRaw) : null,
    },
    treatments,
    profileAt,
    [],
    rules,
  );
  const pointDate = point?.date ?? issueDate;
  let fxRate: string | null = null;
  let fxRateDate: string | null = null;
  if (foreign) {
    if (doc.fxRate !== null) {
      fxRate = doc.fxRate;
      fxRateDate = doc.fxRateDate;
    } else if (fxAtIssue !== null) {
      fxRate = fxAtIssue.perUnit.toFixed(6);
      const atPoint = resolveFxRate(doc.currency, pointDate, fxRows, fxRule, fxLookback);
      fxRateDate = (atPoint ?? fxAtIssue).rateDate;
    }
  }
  const rates = rulesAt.get('vat.rates');
  const reducedCategories = rulesAt.get('vat.reduced_rate_categories') as readonly string[];
  const vatRatePctOf = (l: CategorizeLineRow, decision: CategoryDecision): string | null => {
    if (l.vatRatePct !== null) return l.vatRatePct;
    const treatment = treatmentOf.get(l.position)?.treatment ?? null;
    if (treatment === null || !SELF_ASSESSED_TREATMENTS.includes(treatment)) return null;
    const reduced =
      decision.categoryCode !== null && reducedCategories.includes(decision.categoryCode);
    return String(reduced ? rates.reduced : rates.standard);
  };

  // dominant line
  const itemLines = doc.lines.filter((l) => l.lineType === 'item');
  let dominant: CategorizeLineRow | undefined;
  let best: Money | null = null;
  for (const l of itemLines) {
    const abs = (moneyOrNull(l.gross, doc.currency) ?? Money.zero(doc.currency)).abs();
    if (best === null || abs.compare(best) > 0) {
      best = abs;
      dominant = l;
    }
  }
  dominant ??= doc.lines.find((l) => l.position === 1) ?? doc.lines[0];
  if (dominant === undefined) throw new CategorizeInputError('no lines');
  const dominantLine = dominant;

  // (6) line writes
  const lineWrites: LineWrite[] = doc.lines.map((l) => {
    const d = decisionOf.get(l.position);
    if (!d || d.categoryCode === null) {
      return {
        lineId: l.id,
        categoryCode: null,
        vatTreatment: null,
        vatRatePct: l.vatRatePct,
        businessSharePct: d?.businessSharePct ?? l.businessSharePct,
        deductibility: d?.deductibility ?? null,
        classificationSource: null,
        classificationConfidence: null,
      };
    }
    return {
      lineId: l.id,
      categoryCode: d.categoryCode,
      vatTreatment: treatmentOf.get(l.position)?.treatment ?? null,
      vatRatePct: vatRatePctOf(l, d),
      businessSharePct: d.businessSharePct,
      deductibility: d.deductibility,
      classificationSource: d.source,
      classificationConfidence: conf(d.confidence),
    };
  });

  // fields
  const fields: FieldWrite[] = [];
  const answerKeys = new Set<string>();
  for (const f of answerFields) {
    const key = `lines[${f.position}].${f.key}`;
    answerKeys.add(key);
    fields.push({ fieldKey: key, valueText: f.value, source: 'user', confidence: null });
  }
  const canWrite = (key: string) => !userKeys.has(key) && !answerKeys.has(key);
  for (const l of doc.lines) {
    const d = decisionOf.get(l.position);
    const p = l.position;
    if (!d || d.categoryCode === null) continue;
    const write = lineWrites.find((w) => w.lineId === l.id);
    if (canWrite(`lines[${p}].category_code`) && d.source !== 'user') {
      fields.push({
        fieldKey: `lines[${p}].category_code`,
        valueText: d.categoryCode,
        source: sourceOut(d.source),
        confidence: conf(d.confidence),
      });
    }
    if (write?.vatTreatment && canWrite(`lines[${p}].vat_treatment`)) {
      fields.push({
        fieldKey: `lines[${p}].vat_treatment`,
        valueText: write.vatTreatment,
        source: 'derived',
        confidence: null,
      });
    }
    if (canWrite(`lines[${p}].business_share_pct`)) {
      fields.push({
        fieldKey: `lines[${p}].business_share_pct`,
        valueText: d.businessSharePct,
        source: 'derived',
        confidence: null,
      });
    }
    const llmLine = llmByPosition.get(p);
    if (
      llmLine &&
      (llmLine.supplyKind === 'service' || llmLine.supplyKind === 'goods') &&
      canWrite(`lines[${p}].supply_kind`)
    ) {
      fields.push({
        fieldKey: `lines[${p}].supply_kind`,
        valueText: llmLine.supplyKind,
        source: 'llm',
        confidence: conf(llmLine.confidence),
      });
    }
  }
  if (runSubject !== null && userSubject === null) {
    fields.push({
      fieldKey: 'summary.subject',
      valueText: runSubject,
      source: 'llm',
      confidence: null,
    });
  }
  fields.push({
    fieldKey: 'document.business_flag',
    valueText: cascade.businessFlag,
    source: 'derived',
    confidence: null,
  });

  // (7) questions
  const fxFactor = foreign ? (fxRateToCzk ?? '1') : '1';
  const grossCzk = (text: string | null): string | null => {
    const money = moneyOrNull(text, doc.currency);
    return money === null ? null : money.multiply(fxFactor).toFixed2();
  };
  const topCategories = new Map<string, { code: string; label: string; confidence: number }[]>();
  for (const l of doc.lines) {
    const o = llmByPosition.get(l.position);
    if (!o) continue;
    const tops: { code: string; label: string; confidence: number }[] = [];
    for (const [code, confidence] of [
      [o.categoryCode, o.confidence],
      [o.alternativeCategoryCode, 0],
    ] as const) {
      const cat = code === null ? undefined : findCategory(code);
      if (cat && !tops.some((t) => t.code === cat.code)) {
        tops.push({ code: cat.code, label: cat.labelEn, confidence });
      }
    }
    topCategories.set(l.id, tops);
  }
  const suggested: QuestionContext['suggested'] = {};
  const likelihood = llm?.businessLikelihood;
  const suggestFlag =
    likelihood === 'business' || likelihood === 'personal' || likelihood === 'mixed'
      ? likelihood
      : pickBusinessFlag(vendor?.defaultBusinessFlag ?? null);
  if (suggestFlag !== null) suggested.business_or_personal = suggestFlag;
  const planned = buildQuestions(cascade, doc.questions, {
    merchant: doc.partner?.name ?? null,
    lines: doc.lines.map((l) => ({
      lineId: l.id,
      position: l.position,
      description: l.description,
      grossCzk: grossCzk(l.gross),
    })),
    extraLineKinds,
    thresholdCzk: String(rulesAt.get('asset.capitalization_threshold')),
    suggested,
    topCategories,
    maxQuestions: cls.maxQuestionsPerDocument,
  });

  // summary
  const dominantDecision = decisionOf.get(dominantLine.position);
  let summaryCs: string | null = null;
  if (dominantDecision && dominantDecision.categoryCode !== null) {
    const treatment = treatmentOf.get(dominantLine.position)?.treatment ?? null;
    const dominantWrite = lineWrites.find((w) => w.lineId === dominantLine.id);
    summaryCs = buildSummary({
      asOf: today,
      subject: { user: userSubject, llm: llmSubject, vendorHint },
      dominant: {
        categoryCode: dominantDecision.categoryCode,
        taxEffect:
          dominantDecision.taxEffect ?? getCategory(dominantDecision.categoryCode).taxEffect,
        deductibility: dominantDecision.deductibility,
        businessSharePct: dominantDecision.businessSharePct,
        vatTreatment: treatment,
        vatRatePct: dominantWrite?.vatRatePct ?? null,
      },
      otherTaxEffects: cascade.lines
        .filter((d) => d.position !== dominantLine.position && d.taxEffect !== null)
        .map((d) => d.taxEffect as NonNullable<typeof d.taxEffect>),
      servicePeriodFrom: date(doc.servicePeriodFrom),
      servicePeriodTo: date(doc.servicePeriodTo),
      duzp: date(doc.duzp),
      issueDate,
      recurringCategories: cls.recurringCategories,
      vatStatus,
      deductionAllowed,
      vatPeriod:
        treatment !== null && SELF_ASSESSED_TREATMENTS.includes(treatment)
          ? resolveVatPeriod(profileAt(pointDate), pointDate)
          : null,
    });
  }

  // (8) status
  const postChecks = input.postChecks ?? [];
  const needsReview =
    planned.asked.length > 0 ||
    planned.deferred.length > 0 ||
    openKinds(doc.questions).size > 0 ||
    lineWrites.some((w) => w.categoryCode === null) ||
    postChecks.some((c) => c.severity === 'blocking');

  // LLM request
  let llmRequest: CategorizeRequestInput | null = null;
  if (needsLlm) {
    const hidden = new Set(settings.hiddenCategoryCodes);
    const periodFrom = doc.servicePeriodFrom;
    const periodTo = doc.servicePeriodTo;
    llmRequest = {
      model: input.model,
      document: {
        class: doc.class,
        direction,
        supplier: doc.partner
          ? {
              name: doc.partner.name,
              country: doc.partner.country,
              vatPayer: doc.partner.isVatPayer,
              nace: null,
            }
          : null,
        taxDocStatus: doc.taxDocStatus,
        currency: doc.currency,
        issueDate: doc.issueDate,
        servicePeriod: periodFrom !== null && periodTo !== null ? [periodFrom, periodTo] : null,
      },
      business: {
        activities: settings.activityKeywords,
        nace: profileRowAt(issueDate)?.mainActivityNace ?? null,
        vatStatus,
      },
      lines: doc.lines.map((l) => ({
        position: l.position,
        description: l.description,
        gross: l.gross,
        lineType: l.lineType,
      })),
      resolved: Object.fromEntries(
        doc.lines.map((l) => [
          String(l.position),
          decisionOf.get(l.position)?.categoryCode ?? null,
        ]),
      ),
      categories: CATEGORIES.filter(
        (c) =>
          categoryAllowsDirection(c, direction) &&
          isCategoryValidOn(c, issueDate) &&
          !hidden.has(c.code),
      ).map((c) => ({
        code: c.code as CategoryCode,
        direction: c.direction,
        taxEffect: c.taxEffect,
        label: c.labelEn,
        explanation: c.explanationEn,
      })),
    };
  }

  const askedKinds: QuestionKind[] = planned.asked.map((q) => q.kind);
  return {
    needsLlm,
    llmRequest,
    write: {
      orgId: doc.orgId,
      documentId: doc.id,
      status: needsReview ? 'needs_review' : 'ready',
      document: {
        businessFlag: cascade.businessFlag,
        summaryCs,
        vatPointDate: point?.date ?? null,
        fxRate,
        fxRateDate,
        categorizeVersion: input.categorizeVersion,
      },
      lines: lineWrites,
      fields,
      questions: planned.asked.map((q) => ({ kind: q.kind, payload: q.payload })),
    },
    event: {
      lowConfidenceLines: cascade.lines
        .filter(
          (d) =>
            d.categoryCode !== null &&
            d.source !== 'user' &&
            d.confidence < cls.autoAcceptConfidence,
        )
        .map((d) => d.position),
      questions: askedKinds,
      deferred: planned.deferred,
      dominantLineId: dominantLine.id,
    },
  };
}
