import { t } from '@shoebox/i18n';
import {
  LegalDateText,
  MoneyText,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@shoebox/ui';
import Link from 'next/link';
import type { RegisterRow } from './register-data';

const DASH = '—';

function paidLabel(row: RegisterRow): string {
  if (row.paid === 'paid') return t('register.paid.yes');
  if (row.paid === 'unpaid') return t('register.paid.no');
  return t('register.paid.none');
}

export function RegisterTable({ rows }: { rows: readonly RegisterRow[] }) {
  return (
    <div className="overflow-x-auto rounded-control border border-border bg-card">
      <Table aria-label={t('register.table.label')}>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{t('register.col.date')}</TableHead>
            <TableHead scope="col">{t('register.col.partner')}</TableHead>
            <TableHead scope="col">{t('register.col.number')}</TableHead>
            <TableHead scope="col" className="text-right">
              {t('register.col.gross')}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t('register.col.vat')}
            </TableHead>
            <TableHead scope="col">{t('register.col.paid')}</TableHead>
            <TableHead scope="col">{t('register.col.file')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>{row.date ? <LegalDateText date={row.date} /> : DASH}</TableCell>
              <TableCell>
                <Link prefetch={false} href={`/inbox/${row.id}`} className="underline">
                  {row.partner ?? t('inbox.row.unknown_supplier')}
                </Link>
              </TableCell>
              <TableCell>{row.number ?? DASH}</TableCell>
              <TableCell className="text-right tabular-nums">
                {row.gross !== null ? (
                  <MoneyText value={row.gross} currency={row.currency} />
                ) : (
                  DASH
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.vat !== null ? <MoneyText value={row.vat} currency={row.currency} /> : DASH}
              </TableCell>
              <TableCell>
                {paidLabel(row)}
                {row.paidAt ? (
                  <>
                    {' · '}
                    <LegalDateText date={row.paidAt} />
                  </>
                ) : null}
              </TableCell>
              <TableCell>
                {row.manual
                  ? t('register.file.manual')
                  : row.hasFile
                    ? t('register.file.yes')
                    : DASH}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
