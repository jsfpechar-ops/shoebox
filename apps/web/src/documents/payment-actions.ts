'use server';

import type { MessageKey } from '@shoebox/i18n';
import { revalidatePath } from 'next/cache';
import { requireActiveRole } from '../auth/org-context';
import { enqueueMatchDecision } from './enqueue';

export type PaymentDecisionState = { error: MessageKey | null; done: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only queues the decision; the worker writes the link (match_suggestions and payment_links are select-only). */
export async function decidePaymentAction(
  _prev: PaymentDecisionState,
  form: FormData,
): Promise<PaymentDecisionState> {
  const fail: PaymentDecisionState = { error: 'doc.payment.error', done: false };
  const auth = await requireActiveRole(['owner', 'member']);
  if (!auth.ok) return fail;
  const id = form.get('id');
  const document = form.get('document');
  const decision = form.get('decision');
  if (typeof id !== 'string' || !UUID.test(id)) return fail;
  if (typeof document !== 'string' || !UUID.test(document)) return fail;
  if (decision !== 'accept' && decision !== 'reject') return fail;
  try {
    await enqueueMatchDecision(auth.orgId, id, decision, auth.userId);
  } catch {
    return fail;
  }
  revalidatePath(`/inbox/${document}`);
  return { error: null, done: true };
}
