import { type DocumentClass, type DocumentStatus, parseLegalDate } from '@shoebox/domain';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type BadgeTone,
  SecondaryStatusBadge,
  StatusBadge,
  type StatusBadgeProps,
} from '../src/index';
import { cleanup, render } from './render';

afterEach(cleanup);

const PROCESSING: DocumentStatus[] = [
  'received',
  'splitting',
  'classifying',
  'extracting',
  'validating',
  'categorizing',
];
const NON_BOOKABLE: DocumentClass[] = [
  'settlement_statement',
  'order_confirmation',
  'government_filing',
  'contract',
  'delivery_note',
  'other_supporting',
  'bank_statement',
];
const start = '2026-10-18T10:00:00.000Z';

// [name, props, word, tone, lucide icon class]: one entry per M11 §4 row (and per status/class).
const rows: Array<[string, StatusBadgeProps, string, BadgeTone, string]> = [
  ...PROCESSING.map((status): [string, StatusBadgeProps, string, BadgeTone, string] => [
    status,
    { status, cls: 'unknown' },
    'Processing',
    'info',
    'lucide-loader-circle',
  ]),
  [
    'processing exactly 120 s',
    {
      status: 'extracting',
      cls: 'unknown',
      processingSince: start,
      now: Date.parse('2026-10-18T10:02:00.000Z'),
    },
    'Processing',
    'info',
    'lucide-loader-circle',
  ],
  [
    'processing over 120 s',
    {
      status: 'extracting',
      cls: 'unknown',
      processingSince: start,
      now: Date.parse('2026-10-18T10:02:01.000Z'),
    },
    'Taking longer than usual',
    'neutral',
    'lucide-clock',
  ],
  [
    'needs_review',
    { status: 'needs_review', cls: 'received_invoice' },
    'To review',
    'warning',
    'lucide-circle-alert',
  ],
  ['ready', { status: 'ready', cls: 'received_invoice' }, 'Done', 'success', 'lucide-circle-check'],
  [
    'finalized',
    { status: 'finalized', cls: 'received_invoice' },
    'Closed',
    'neutral',
    'lucide-lock',
  ],
  ...NON_BOOKABLE.map((cls): [string, StatusBadgeProps, string, BadgeTone, string] => [
    `supporting ${cls}`,
    { status: 'supporting', cls },
    'Supporting document',
    'neutral',
    'lucide-paperclip',
  ]),
  [
    'supporting non_document',
    { status: 'supporting', cls: 'non_document' },
    'Not a document',
    'neutral',
    'lucide-file-x',
  ],
  [
    'duplicate',
    { status: 'duplicate', cls: 'received_invoice' },
    'Duplicate',
    'neutral',
    'lucide-copy',
  ],
  [
    'failed',
    { status: 'failed', cls: 'unknown' },
    'Could not read',
    'destructive',
    'lucide-circle-x',
  ],
  [
    'in trash',
    { status: 'ready', cls: 'received_invoice', purgeOn: parseLegalDate('2026-11-17') },
    'In trash (deleted on 17. 11. 2026)',
    'neutral',
    'lucide-trash',
  ],
];

describe('StatusBadge (M11 §4)', () => {
  it.each(rows)('%s → icon + word + tone', (_name, props, word, tone, iconClass) => {
    const { container } = render(<StatusBadge {...props} />);
    const badge = container.querySelector('[data-slot="badge"]');
    expect(badge?.textContent).toBe(word);
    expect(badge?.getAttribute('data-tone')).toBe(tone);
    const svg = badge?.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('class')).toContain(iconClass);
  });

  it('spins only while processing', () => {
    const { container } = render(<StatusBadge status="received" cls="unknown" />);
    expect(container.querySelector('svg')?.getAttribute('class')).toContain(
      'motion-safe:animate-spin',
    );
    cleanup();
    const ready = render(<StatusBadge status="ready" cls="received_invoice" />);
    expect(ready.container.querySelector('svg')?.getAttribute('class')).not.toContain(
      'animate-spin',
    );
  });

  it('links a duplicate to its original', () => {
    const { container } = render(
      <StatusBadge status="duplicate" cls="received_invoice" originalHref="/doklady/1" />,
    );
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/doklady/1');
    expect(link?.textContent).toBe('original');
  });
});

describe('SecondaryStatusBadge', () => {
  it.each([
    ['not_tax_document', 'Not a tax document', 'info', 'lucide-receipt-text'],
    ['missing_document', 'Missing document', 'warning', 'lucide-file-search'],
  ] as const)('%s → %s', (kind, word, tone, iconClass) => {
    const { container } = render(<SecondaryStatusBadge kind={kind} />);
    const badge = container.querySelector('[data-slot="badge"]');
    expect(badge?.textContent).toBe(word);
    expect(badge?.getAttribute('data-tone')).toBe(tone);
    expect(badge?.querySelector('svg')?.getAttribute('class')).toContain(iconClass);
  });
});
