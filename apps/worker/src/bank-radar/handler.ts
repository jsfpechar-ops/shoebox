import { MATCHER_CONFIG, radarCandidates, supplierRequestText } from '@shoebox/bank';
import type {
  applyRadarAnswerToTransaction,
  insertRadarQuestion,
  loadLastSupplierSender,
  loadOrgInvoicingDetails,
  loadRadarQuestions,
  loadRadarTransactions,
  markRadarAnswerApplied,
  resolveRadarQuestion,
} from '@shoebox/db';
import { type Clock, pragueToday } from '@shoebox/domain';
import type { BankRadarNightlyPayload, BankRadarRefreshPayload } from '@shoebox/pipeline';
import type { SystemHandler, TenantHandler } from '../registry';

export interface BankRadarStore {
  readonly loadTransactions: typeof loadRadarTransactions;
  readonly loadQuestions: typeof loadRadarQuestions;
  readonly insertQuestion: typeof insertRadarQuestion;
  readonly resolveQuestion: typeof resolveRadarQuestion;
  readonly markApplied: typeof markRadarAnswerApplied;
  readonly applyAnswer: typeof applyRadarAnswerToTransaction;
  readonly loadOrgDetails: typeof loadOrgInvoicingDetails;
  readonly loadSupplierSender: typeof loadLastSupplierSender;
}
export interface BankRadarDeps {
  readonly store: BankRadarStore;
  readonly clock: Clock;
}

/** Category set by the "private payment" answer. TODO(P0-DB-11): null when the code is not seeded. */
const PRIVATE_CATEGORY = 'private_expense';

function answerOf(answer: unknown): { value: string | null; applied: boolean; auto: boolean } {
  const a =
    typeof answer === 'object' && answer !== null ? (answer as Record<string, unknown>) : {};
  return {
    value: typeof a.value === 'string' ? a.value : null,
    applied: a.applied === true,
    auto: a.resolved === 'auto',
  };
}

/** The address part of a `Name <a@b.cz>` header, or the plain address; '' when it is not an address. */
export function senderAddress(raw: string | null): string {
  if (raw === null) return '';
  const angle = /<([^<>\s]+@[^<>\s]+)>/.exec(raw);
  if (angle?.[1]) return angle[1];
  const plain = raw.trim();
  return /^[^\s<>@]+@[^\s<>@]+$/.test(plain) ? plain : '';
}

export function createBankRadarRefreshHandler(
  deps: BankRadarDeps,
): TenantHandler<BankRadarRefreshPayload> {
  return async (payload, ctx) => {
    const { orgId } = payload;
    const tx = ctx.tx;
    const s = deps.store;

    // (a) apply answers that are not applied yet. `upload` and `request` change nothing.
    for (const q of await s.loadQuestions(tx, orgId)) {
      if (q.answered_at === null) continue;
      const a = answerOf(q.answer);
      if (a.applied || a.auto || a.value === null) continue;
      if (a.value === 'private') {
        await s.applyAnswer(tx, orgId, q.transaction_id, PRIVATE_CATEGORY);
      } else if (a.value === 'no_document') {
        await s.applyAnswer(tx, orgId, q.transaction_id, null);
      } else continue;
      await s.markApplied(tx, orgId, q.id);
    }

    // (b) candidates, after the answers changed some transactions.
    const today = pragueToday(deps.clock);
    const rows = await s.loadTransactions(tx, orgId);
    const candidates = radarCandidates(
      rows.map((r) => ({
        id: r.id,
        amount: r.amount,
        currency: r.currency,
        bookedOn: r.booked_on,
        matchState: r.match_state,
        categoryCode: r.category_code,
        isPending: r.is_pending,
        isBusiness: r.is_business,
        linkedAmount: r.linked_amount,
        counterparty: r.counterparty,
        variableSymbol: r.variable_symbol,
      })),
      today,
      MATCHER_CONFIG.radarGraceDays,
    );

    const questions = await s.loadQuestions(tx, orgId);
    const candidateIds = new Set(candidates.map((c) => c.id));

    // (d) auto-resolve open questions whose transaction is no longer a candidate.
    for (const q of questions) {
      if (q.answered_at === null && !candidateIds.has(q.transaction_id)) {
        await s.resolveQuestion(tx, orgId, q.id);
      }
    }

    // (c) one question per candidate; an open or user-answered question blocks a new one.
    const asked = new Set(
      questions
        .filter((q) => q.answered_at === null || !answerOf(q.answer).auto)
        .map((q) => q.transaction_id),
    );
    const fresh = candidates.filter((c) => !asked.has(c.id));
    if (fresh.length === 0) return;
    const org = await s.loadOrgDetails(tx, orgId);
    for (const c of fresh) {
      const sender =
        c.counterparty === null || c.counterparty === ''
          ? null
          : await s.loadSupplierSender(tx, orgId, c.counterparty);
      const request = supplierRequestText({
        orgName: org?.name ?? '',
        ico: org?.ico ?? null,
        dic: org?.dic ?? null,
        address: org?.address ?? null,
        bookedOn: c.bookedOn,
        amount: c.remainder,
        currency: c.currency,
        variableSymbol: c.variableSymbol,
        counterparty: c.counterparty,
      });
      const mailto = `mailto:${senderAddress(sender)}?subject=${encodeURIComponent(request.subject)}&body=${encodeURIComponent(request.body)}`;
      await s.insertQuestion(tx, orgId, c.id, {
        question: 'review.missing_document.question',
        params: {
          amount: c.remainder,
          currency: c.currency,
          date: c.bookedOn,
          counterparty: c.counterparty ?? '',
          mailto,
        },
        options: [
          { value: 'upload', label: 'review.missing_document.upload' },
          { value: 'no_document', label: 'review.missing_document.no_document' },
          { value: 'private', label: 'review.missing_document.private' },
        ],
      });
    }
  };
}

/** Daily fan-out over the active organizations (enqueue is singleton per org). */
export function createBankRadarNightlyHandler(deps: {
  readonly listActiveOrgIds: () => Promise<string[]>;
  readonly enqueue: (orgId: string) => Promise<unknown>;
}): SystemHandler<BankRadarNightlyPayload> {
  return async () => {
    for (const orgId of await deps.listActiveOrgIds()) await deps.enqueue(orgId);
  };
}
