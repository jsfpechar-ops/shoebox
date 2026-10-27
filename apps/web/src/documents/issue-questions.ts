import type { MessageKey } from '@shoebox/i18n';
import { type EditKey, editKeyOf } from './correction';
import type { DetailCheck } from './detail-data';

/** Asks the Fix field of a value to open (FixField listens for it). */
export const OPEN_FIX_EVENT = 'shoebox:open-fix';

/** What one tap does: settle the issue, move the document to the trash, or open the Fix field. */
export type AnswerAction = 'dismiss' | 'trash' | 'fix';

export interface IssueAnswer {
  readonly label: MessageKey;
  readonly action: AnswerAction;
  /** The Fix field to open, for `fix` only. */
  readonly editKey?: EditKey;
}

export interface IssueQuestion {
  readonly id: string | null;
  readonly text: MessageKey;
  readonly params: Record<string, string | number>;
  readonly answers: readonly IssueAnswer[];
}

function fixAnswer(editKey: EditKey | null): IssueAnswer[] {
  return editKey === null ? [] : [{ label: 'doc.issue.fix', action: 'fix', editKey }];
}

/** Turns one open blocking issue into a plain question with one-tap answers. */
export function questionOf(check: DetailCheck): IssueQuestion {
  const base = { id: check.id, params: check.params };
  switch (check.key) {
    case 'proto.check.buyer.other_firm':
      return {
        ...base,
        text: 'doc.issue.other_firm',
        answers: [
          { label: 'doc.issue.other_firm.yes', action: 'dismiss' },
          { label: 'doc.issue.other_firm.no', action: 'trash' },
        ],
      };
    case 'proto.check.buyer.supplier_is_me':
      return {
        ...base,
        text: 'doc.issue.supplier_is_me',
        answers: [
          { label: 'doc.issue.supplier_is_me.yes', action: 'dismiss' },
          { label: 'doc.issue.supplier_is_me.no', action: 'fix', editKey: 'supplier.ico' },
        ],
      };
    case 'proto.check.ico_checksum.fail':
      return {
        ...base,
        text: 'doc.issue.ico',
        answers: [{ label: 'doc.issue.ico.yes', action: 'dismiss' }, ...fixAnswer('supplier.ico')],
      };
    default: {
      const editKey =
        check.fieldName === null ? null : editKeyOf(`proto.field.${check.fieldName}` as MessageKey);
      return {
        ...base,
        text: check.key,
        answers: [{ label: 'doc.issue.fine', action: 'dismiss' }, ...fixAnswer(editKey)],
      };
    }
  }
}

/** The status after answers: ready only when no blocking issue is open and the class is known. */
export function statusAfterAnswers(
  openBlocking: number,
  documentClass: string,
): 'ready' | 'needs_review' {
  const unsure = documentClass === 'unknown' || documentClass === 'unreadable';
  return openBlocking === 0 && !unsure ? 'ready' : 'needs_review';
}

/** The blocking issues of a document as questions, and the warnings as plain notes. */
export function splitChecks(checks: readonly DetailCheck[]): {
  questions: IssueQuestion[];
  notes: DetailCheck[];
} {
  return {
    questions: checks.filter((c) => c.severity === 'blocking').map(questionOf),
    notes: checks.filter((c) => c.severity !== 'blocking'),
  };
}
