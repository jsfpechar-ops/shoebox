// Podklady generation request (0365): the decision is pure, the draft insert is the only write.

import { insertFiling, listFilings, supersedeOpenFilings, type TenantDb } from '@shoebox/db';
import { type MemberRole, type PodkladyAnswers, podkladyAnswersSchema } from '@shoebox/domain';
import { PODKLADY_WRITE_ROLES } from './preview';

export type GenerateDecision =
  | { readonly ok: true; readonly answers: PodkladyAnswers }
  | {
      readonly ok: false;
      readonly status: 400 | 403;
      readonly code: 'forbidden' | 'bad_answers';
    };

/** Role first, then the answers (a strict schema: a rodné číslo or any unknown key is refused before any write). */
export function decideGenerate(role: MemberRole, body: unknown): GenerateDecision {
  if (!PODKLADY_WRITE_ROLES.includes(role)) return { ok: false, status: 403, code: 'forbidden' };
  const raw =
    typeof body === 'object' && body !== null && !Array.isArray(body)
      ? ((body as Record<string, unknown>).answers ?? {})
      : {};
  const parsed = podkladyAnswersSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, status: 400, code: 'bad_answers' };
  return { ok: true, answers: parsed.data };
}

/**
 * Stores the answers as a draft PODKLADY_DPFO filing; the worker reads them by answersVersion.
 * The draft uses kind 'nasledne' so it never takes the 'radne' open slot of a generated filing
 * (unique index filings_one_open_per_kind); an older draft is superseded first.
 */
export async function storeAnswersDraft(
  db: Pick<TenantDb, 'withTenant'>,
  orgId: string,
  year: number,
  answers: PodkladyAnswers,
  userId: string,
): Promise<{ filingId: string; answersVersion: number }> {
  const periodStart = `${year}-01-01`;
  return db.withTenant(orgId, async (tx) => {
    const existing = await listFilings(tx, orgId, { periodStart, types: ['PODKLADY_DPFO'] });
    const answersVersion = existing.length + 1;
    await supersedeOpenFilings(tx, orgId, 'PODKLADY_DPFO', periodStart, 'nasledne');
    const filingId = await insertFiling(
      tx,
      {
        orgId,
        type: 'PODKLADY_DPFO',
        kind: 'nasledne',
        periodStart,
        periodEnd: `${year}-12-31`,
        state: 'draft',
        totals: { answersVersion },
        inputs: answers,
        simpleCheck: {},
        generatedBy: userId,
      },
      [],
      [],
    );
    return { filingId, answersVersion };
  });
}
