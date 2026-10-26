export type InboxTab = 'review' | 'all' | 'trash';

const TABS: readonly InboxTab[] = ['review', 'all', 'trash'];

export interface InboxRegisterFilter {
  readonly year: number | null;
  readonly paid: string;
  readonly q: string;
}

/** The tab from `?tab=`; without a valid one: review when something needs the user, else all. */
export function inboxTabOf(param: string | undefined, needsUser: boolean): InboxTab {
  if (param !== undefined && (TABS as readonly string[]).includes(param)) {
    return param as InboxTab;
  }
  return needsUser ? 'review' : 'all';
}

/** `/inbox?tab=…` keeping the register filters (year, paid, q) when they are set. */
export function inboxHref(tab: InboxTab, filter?: InboxRegisterFilter): string {
  const params = new URLSearchParams();
  params.set('tab', tab);
  if (filter !== undefined) {
    if (filter.year !== null) params.set('year', String(filter.year));
    if (filter.paid !== 'all') params.set('paid', filter.paid);
    if (filter.q !== '') params.set('q', filter.q);
  }
  return `/inbox?${params.toString()}`;
}

/** Query string for the Excel route: `/api/register?year=2026&paid=unpaid&q=alza` (only set values). */
export function registerDownloadHref(filter: InboxRegisterFilter): string {
  const params = new URLSearchParams();
  if (filter.year !== null) params.set('year', String(filter.year));
  if (filter.paid !== 'all') params.set('paid', filter.paid);
  if (filter.q !== '') params.set('q', filter.q);
  const query = params.toString();
  return query === '' ? '/api/register' : `/api/register?${query}`;
}
