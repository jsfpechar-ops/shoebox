import type { DocumentClass, DocumentStatus, LegalDate } from '@shoebox/domain';
import { type MessageKey, t } from '@shoebox/i18n';
import {
  CircleAlert,
  CircleCheck,
  CircleX,
  Clock,
  Copy,
  FileSearch,
  FileX,
  LoaderCircle,
  Lock,
  Paperclip,
  ReceiptText,
  Trash,
} from 'lucide-react';
import { Badge, type BadgeTone } from '../primitives/basic';
import { formatLegalDate } from './format-text';

/** M11 §4: after 120 s of processing the badge says it takes longer than usual. UI constant, not law. */
export const SLOW_PROCESSING_MS = 120_000;

type Icon = typeof Lock;

export type StatusView = { key: MessageKey; tone: BadgeTone; icon: Icon; spin: boolean };

export type StatusBadgeProps = {
  status: DocumentStatus;
  cls: DocumentClass;
  /** ISO instant when processing started. */
  processingSince?: string;
  /** Current instant in ms from the Clock; the component never reads the system clock. */
  now?: number;
  /** Set when the document is in the trash (deleted_at): the date it will be purged. */
  purgeOn?: LegalDate;
  /** Duplicate only: link to the original document. */
  originalHref?: string;
};

function view(key: MessageKey, tone: BadgeTone, icon: Icon, spin = false): StatusView {
  return { key, tone, icon, spin };
}

/** M11 §4 mapping from document status (+ condition) to word, tone and icon. */
export function statusView(props: StatusBadgeProps): StatusView {
  const { status, cls, processingSince, now, purgeOn } = props;
  if (purgeOn !== undefined) return view('status.badge.trash', 'neutral', Trash);
  switch (status) {
    case 'received':
    case 'splitting':
    case 'classifying':
    case 'extracting':
    case 'validating':
    case 'categorizing': {
      const slow =
        processingSince !== undefined &&
        now !== undefined &&
        now - Date.parse(processingSince) > SLOW_PROCESSING_MS;
      return slow
        ? view('status.badge.processing_slow', 'neutral', Clock)
        : view('status.badge.processing', 'info', LoaderCircle, true);
    }
    case 'needs_review':
      return view('status.badge.needs_review', 'warning', CircleAlert);
    case 'ready':
      return view('status.badge.ready', 'success', CircleCheck);
    case 'finalized':
      return view('status.badge.finalized', 'neutral', Lock);
    case 'supporting':
      return cls === 'non_document'
        ? view('status.badge.non_document', 'neutral', FileX)
        : view('status.badge.supporting', 'neutral', Paperclip);
    case 'duplicate':
      return view('status.badge.duplicate', 'neutral', Copy);
    case 'failed':
      return view('status.badge.failed', 'destructive', CircleX);
  }
}

/** Document status as Lucide icon + word + tone, never color alone (07 §3, M11 §4). */
export function StatusBadge(props: StatusBadgeProps) {
  const { key, tone, icon: StatusIcon, spin } = statusView(props);
  const label =
    props.purgeOn === undefined ? t(key) : t(key, { date: formatLegalDate(props.purgeOn) });
  return (
    <span className="inline-flex items-center gap-2" data-status={props.status}>
      <Badge tone={tone}>
        <StatusIcon
          size={16}
          strokeWidth={1.5}
          aria-hidden="true"
          className={spin ? 'motion-safe:animate-spin' : ''}
        />
        {label}
      </Badge>
      {props.status === 'duplicate' && props.originalHref !== undefined ? (
        <a href={props.originalHref} className="text-meta text-link underline">
          {t('status.badge.duplicate_original')}
        </a>
      ) : null}
    </span>
  );
}

export type SecondaryStatus = 'not_tax_document' | 'missing_document';

const SECONDARY: Record<SecondaryStatus, StatusView> = {
  not_tax_document: view('status.badge.not_tax_document', 'info', ReceiptText),
  missing_document: view('status.badge.missing_document', 'warning', FileSearch),
};

/** Secondary badges shown next to the main one (M11 §4): Nedaňový, Chybí doklad (Phase 2). */
export function SecondaryStatusBadge({ kind }: { kind: SecondaryStatus }) {
  const { key, tone, icon: StatusIcon } = SECONDARY[kind];
  return (
    <Badge tone={tone} data-secondary={kind}>
      <StatusIcon size={16} strokeWidth={1.5} aria-hidden="true" />
      {t(key)}
    </Badge>
  );
}
