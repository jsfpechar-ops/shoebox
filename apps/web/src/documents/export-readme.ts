import { t } from '@shoebox/i18n';

export type LeftOutReason = 'missing' | 'too_big';

export interface LeftOutItem {
  readonly label: string;
  readonly reason: LeftOutReason;
}

export interface ReadmeInput {
  readonly period: string;
  readonly ready: number;
  readonly needsReview: number;
  readonly notRead: number;
  readonly registerName: string;
  readonly isdocCount: number;
  readonly pohodaName: string | null;
  readonly leftOut: readonly LeftOutItem[];
  readonly trashed: number;
  readonly undated: number;
}

/** The README.txt of the accountant ZIP: plain English, CRLF line ends. */
export function buildReadme(input: ReadmeInput): string {
  const lines: string[] = [
    t('export.readme.title', { period: input.period }),
    '',
    t('export.readme.counts', {
      total: input.ready + input.needsReview + input.notRead,
      ready: String(input.ready),
      review: String(input.needsReview),
      unread: String(input.notRead),
    }),
    '',
    t('export.readme.files'),
    t('export.readme.register', { name: input.registerName }),
    t('export.readme.pdfs'),
    t('export.readme.prefix'),
  ];
  if (input.isdocCount > 0) lines.push(t('export.readme.isdoc'));
  if (input.pohodaName !== null) lines.push(t('export.readme.pohoda', { name: input.pohodaName }));

  const notes: string[] = input.leftOut.map((item) =>
    t(item.reason === 'too_big' ? 'export.readme.left_too_big' : 'export.readme.left_missing', {
      label: item.label,
    }),
  );
  if (input.trashed > 0) notes.push(t('export.readme.left_trash', { n: input.trashed }));
  if (input.undated > 0) notes.push(t('export.readme.left_undated', { n: input.undated }));
  lines.push('', notes.length > 0 ? t('export.readme.left_out') : t('export.readme.nothing_left'));
  lines.push(...notes);
  return `${lines.join('\r\n')}\r\n`;
}
