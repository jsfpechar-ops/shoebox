import { Money } from '@shoebox/domain';
import { catalogs, type MessageKey, t } from '@shoebox/i18n';
import { formatCzkWhole } from '../overview/format';
import type { PeriodCard } from './periods';

export type FilingKind = 'radne' | 'opravne' | 'dodatecne' | 'nasledne';

export type VatAction =
  | { kind: 'open'; href: string }
  | { kind: 'download'; href: string; label: 'zip' | 'xml' }
  | { kind: 'prepare'; periodStart: string; filingKind: FilingKind }
  | { kind: 'workbook'; periodStart: string }
  | { kind: 'mark_filed'; filingId: string; periodEnd: string };

export interface VatCardView {
  readonly periodStart: string;
  readonly tone: 'done' | 'ready' | 'todo' | 'warn';
  readonly title: string;
  readonly body: string;
  readonly reasons: readonly string[];
  readonly due: string | null;
  readonly actions: readonly VatAction[];
}

const FORM_ORDER = ['DPHDP3', 'DPHKH1', 'DPHSHV'] as const;
const FILING_KINDS: readonly string[] = ['radne', 'opravne', 'dodatecne', 'nasledne'];
const PRIORITY = ['amendment_needed', 'needs_accountant', 'not_ready'] as const;

const MONTH_FORMAT = new Intl.DateTimeFormat('en-GB', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** Groups cards by period start (newest first); inside a group DPHDP3, DPHKH1, DPHSHV. */
export function groupCards(cards: readonly PeriodCard[]): PeriodCard[][] {
  const groups = new Map<string, PeriodCard[]>();
  for (const card of cards) {
    const group = groups.get(card.periodStart) ?? [];
    group.push(card);
    groups.set(card.periodStart, group);
  }
  return [...groups.keys()]
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    .map((key) =>
      (groups.get(key) ?? []).sort(
        (a, b) => FORM_ORDER.indexOf(a.form) - FORM_ORDER.indexOf(b.form),
      ),
    );
}

function dayMonth(date: string): string {
  const [, m = '', d = ''] = date.split('-');
  return `${Number(d)}. ${Number(m)}.`;
}

function fullDate(date: string): string {
  const [y = '', m = '', d = ''] = date.split('-');
  return `${Number(d)}. ${Number(m)}. ${y}`;
}

/** The reason code as plain words; an unknown code gets the generic sentence. */
export function reasonText(code: string): string {
  const key = `vat.reason.${code.toLowerCase()}`;
  return key in catalogs.en ? t(key as MessageKey) : t('vat.reason.other');
}

export function periodName(periodStart: string): string {
  return MONTH_FORMAT.format(new Date(`${periodStart}T00:00:00Z`));
}

export function vatCardView(group: readonly PeriodCard[]): VatCardView {
  const first = group.find((c) => c.form === 'DPHDP3') ?? group[0];
  if (first === undefined) throw new Error('empty_card_group');
  let main = first;
  for (const kind of PRIORITY) {
    const hit = group.find((c) => c.kind === kind);
    if (hit !== undefined) {
      main = hit;
      break;
    }
  }
  const periodStart = main.periodStart;
  const title = t('vat.card.title', { period: periodName(periodStart) });
  const due = main.dueDate === null ? null : t('vat.card.due', { date: dayMonth(main.dueDate) });
  const actions: VatAction[] = [{ kind: 'open', href: `/prehled/dph/${periodStart}` }];
  const base = { periodStart, title, due };
  switch (main.kind) {
    case 'ready': {
      const filingId = main.filingId;
      if (filingId !== null) {
        const zip = group.length > 1;
        actions.push({
          kind: 'download',
          href: `/api/v1/filings/${filingId}/download?format=${zip ? 'zip' : 'xml'}`,
          label: zip ? 'zip' : 'xml',
        });
        actions.push({ kind: 'mark_filed', filingId, periodEnd: main.periodEnd });
      }
      const body =
        main.amountDue === null
          ? t('vat.card.ready_no_amount')
          : t('vat.card.ready', {
              amount: formatCzkWhole(Money.parse(main.amountDue, 'CZK')),
            });
      return { ...base, tone: 'ready', body, reasons: [], actions };
    }
    case 'draft_unvalidated':
      return { ...base, tone: 'todo', body: t('vat.card.preparing'), reasons: [], actions };
    case 'not_ready':
      return {
        ...base,
        tone: 'todo',
        body: t('vat.card.not_ready', { count: main.reasons.length }),
        reasons: main.reasons.map(reasonText),
        actions,
      };
    case 'needs_accountant':
      actions.push({ kind: 'workbook', periodStart });
      return { ...base, tone: 'warn', body: t('vat.card.needs_accountant'), reasons: [], actions };
    case 'filed':
      return {
        ...base,
        tone: 'done',
        body: t('vat.card.filed', { date: main.filedOn === null ? '' : fullDate(main.filedOn) }),
        reasons: [],
        actions,
      };
    case 'imported_matches':
      return { ...base, tone: 'done', body: t('vat.card.matches_filed'), reasons: [], actions };
    case 'amendment_needed': {
      const proposed = main.proposal?.kind ?? '';
      const filingKind = (FILING_KINDS.includes(proposed) ? proposed : 'opravne') as FilingKind;
      actions.push({ kind: 'prepare', periodStart, filingKind });
      return {
        ...base,
        tone: 'warn',
        body: t('vat.card.amendment', {
          date: main.proposal === null ? '' : fullDate(main.proposal.dueDate),
        }),
        reasons: [],
        actions,
      };
    }
    case 'overdue_missing':
      actions.push({ kind: 'prepare', periodStart, filingKind: 'radne' });
      return { ...base, tone: 'warn', body: t('vat.card.overdue'), reasons: [], actions };
  }
}
