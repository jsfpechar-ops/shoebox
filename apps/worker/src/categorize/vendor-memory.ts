import type { CategorizationWrite, DocumentForCategorize } from '@shoebox/db';
import type { QuestionPayload } from './answers';

export interface VendorObservation {
  readonly categoryCode: string;
  readonly vatTreatment: string | null;
  readonly businessFlag: 'business' | 'personal' | 'mixed';
  readonly subject: string | null;
  readonly pin: boolean;
  readonly multiCategory: boolean;
}

export interface VendorProfileState {
  readonly defaultCategoryCode: string | null;
  readonly defaultVatTreatment: string | null;
  readonly defaultBusinessFlag: string | null;
  readonly confirmations: number;
  readonly pinned: boolean;
  readonly multiCategory: boolean;
  readonly extractionHints: Record<string, unknown>;
  readonly lastConfirmedAt: Date | null;
}

export interface LearnResult {
  readonly profile: VendorProfileState;
  readonly changed: boolean;
  readonly relearn: {
    readonly oldCode: string;
    readonly newCode: string;
    readonly count: number;
  } | null;
  readonly reachedThreshold: boolean;
}

export function emptyProfile(): VendorProfileState {
  return {
    defaultCategoryCode: null,
    defaultVatTreatment: null,
    defaultBusinessFlag: null,
    confirmations: 0,
    pinned: false,
    multiCategory: false,
    extractionHints: {},
    lastConfirmedAt: null,
  };
}

/** §4.7 recordConfirmation as a pure state transition. `now` is the confirmation time. */
export function learnVendorProfile(
  profile: VendorProfileState,
  obs: VendorObservation,
  minConfirmations: number,
  now: Date,
): LearnResult {
  let next: VendorProfileState = { ...profile };
  let touched = false;
  let relearn: LearnResult['relearn'] = null;

  const replaceDefaults = (confirmations: number): VendorProfileState => ({
    ...next,
    defaultCategoryCode: obs.categoryCode,
    defaultVatTreatment: obs.vatTreatment,
    defaultBusinessFlag: obs.businessFlag,
    confirmations,
  });

  if (profile.defaultCategoryCode === null) {
    next = replaceDefaults(1);
    touched = true;
  } else if (profile.defaultCategoryCode === obs.categoryCode) {
    next = {
      ...next,
      confirmations: profile.confirmations + 1,
      defaultVatTreatment: obs.vatTreatment,
      defaultBusinessFlag: obs.businessFlag,
    };
    touched = true;
  } else if (profile.pinned) {
    // A pinned profile keeps its default; the relearn question is asked only on an explicit change.
  } else if (profile.confirmations <= 1) {
    next = replaceDefaults(1);
    touched = true;
  } else {
    relearn = {
      oldCode: profile.defaultCategoryCode,
      newCode: obs.categoryCode,
      count: profile.confirmations,
    };
  }

  if (obs.pin) next = { ...next, pinned: true };
  const multiChanged = obs.multiCategory !== profile.multiCategory;
  next = { ...next, multiCategory: obs.multiCategory };
  const pinChanged = obs.pin && !profile.pinned;

  const currentSubject = profile.extractionHints.subject_cs ?? null;
  if (obs.subject !== null) {
    next = { ...next, extractionHints: { ...next.extractionHints, subject_cs: obs.subject } };
  }
  const hintChanged = obs.subject !== null && obs.subject !== currentSubject;

  next = { ...next, lastConfirmedAt: now };

  const reachedThreshold =
    (profile.confirmations < minConfirmations && next.confirmations >= minConfirmations) ||
    (!profile.pinned && next.pinned);

  return {
    profile: next,
    changed: touched || multiChanged || pinChanged || hintChanged,
    relearn,
    reachedThreshold,
  };
}

/** The relearn_vendor answer: from_now_on → defaults = new code (treatment/flag kept), confirmations 1, pinned; this_only → unchanged. */
export function applyRelearnAnswer(
  profile: VendorProfileState,
  newCode: string,
  value: 'this_only' | 'from_now_on',
): VendorProfileState {
  if (value === 'this_only') return { ...profile };
  return { ...profile, defaultCategoryCode: newCode, confirmations: 1, pinned: true };
}

/** The observation of a user-confirmed run, or null when the run is not a confirmation (trigger, source and remember rules of §2). `dominantLineId` is the planner's dominant line. */
export function confirmationOf(
  trigger: string,
  doc: DocumentForCategorize,
  write: Omit<CategorizationWrite, 'runs'>,
  dominantLineId: string,
): VendorObservation | null {
  if (trigger !== 'question_answered' && trigger !== 'user_reprocess') return null;
  const line = write.lines.find((l) => l.lineId === dominantLineId);
  if (line === undefined || line.categoryCode === null) return null;

  const remembered = doc.fields
    .filter((f) => f.source === 'user' && /^lines\[\d+\]\.remember$/.test(f.fieldKey))
    .map((f) => f.valueText);
  const userSourced = line.classificationSource === 'user';
  if (!userSourced && !remembered.some((v) => v === 'vendor' || v === 'always')) return null;

  const share = Number(line.businessSharePct);
  const businessFlag: VendorObservation['businessFlag'] =
    share === 100 ? 'business' : share === 0 ? 'personal' : 'mixed';

  const itemIds = new Set(doc.lines.filter((l) => l.lineType === 'item').map((l) => l.id));
  const confirmedCategories = new Set(
    write.lines
      .filter(
        (l) =>
          itemIds.has(l.lineId) && l.classificationSource === 'user' && l.categoryCode !== null,
      )
      .map((l) => l.categoryCode),
  );

  const subjectField = write.fields.find(
    (f) => f.fieldKey === 'summary.subject' && f.source === 'user' && f.valueText !== null,
  );

  return {
    categoryCode: line.categoryCode,
    vatTreatment: line.vatTreatment,
    businessFlag,
    subject: userSourced ? (subjectField?.valueText ?? null) : null,
    pin: remembered.includes('always'),
    multiCategory: confirmedCategories.size >= 2,
  };
}

export function relearnPayload(
  partnerId: string,
  merchant: string,
  oldCode: string,
  newCode: string,
  count: number,
): QuestionPayload {
  return {
    question: 'categorize.question.relearn_vendor',
    params: { partner_id: partnerId, old_code: oldCode, new_code: newCode, count, merchant },
    options: [
      { value: 'this_only', label: 'categorize.option.this_only' },
      { value: 'from_now_on', label: 'categorize.option.from_now_on' },
    ],
  };
}
