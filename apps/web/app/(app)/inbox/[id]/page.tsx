import type { LegalDate } from '@shoebox/domain';
import { t } from '@shoebox/i18n';
import { Badge, Button, Card, LegalDateText, MoneyText, StatusBadge } from '@shoebox/ui';
import Link from 'next/link';
import { requireActiveRole } from '../../../../src/auth/org-context';
import { AutoRefresh } from '../../../../src/documents/auto-refresh';
import { EDITABLE, editKeyOf } from '../../../../src/documents/correction';
import { loadDocumentDetail } from '../../../../src/documents/detail-data';
import { supabaseDuplicateStore } from '../../../../src/documents/duplicate';
import { DuplicateNotice } from '../../../../src/documents/duplicate-notice';
import { FixField } from '../../../../src/documents/fix-field';
import { PROCESSING_STATUSES } from '../../../../src/documents/inbox-data';
import { PagesCard } from '../../../../src/documents/pages-card';
import { loadJoinCandidates, loadPagesView } from '../../../../src/documents/pages-data';
import { loadPaymentView, supabasePaymentStore } from '../../../../src/documents/payment';
import { PaymentCard } from '../../../../src/documents/payment-card';
import { PdfViewer } from '../../../../src/documents/pdf-viewer';
import { readAgainAction } from '../../../../src/documents/read-again-actions';
import { moveToTrashAction } from '../../../../src/documents/trash-actions';
import { createSupabaseServerClient } from '../../../../src/supabase/server';

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireActiveRole(['owner', 'member', 'accountant', 'viewer']);
  const supabase = await createSupabaseServerClient();
  const detail = auth.ok ? await loadDocumentDetail(supabase, auth.orgId, id) : null;
  const pagesView = detail ? await loadPagesView(supabase, detail.id) : null;
  const candidates =
    detail && auth.ok ? await loadJoinCandidates(supabase, auth.orgId, detail.id) : [];

  if (detail === null) {
    return (
      <div className="flex flex-col gap-6">
        <Link href="/inbox" className="text-body underline">
          {t('doc.detail.back')}
        </Link>
        <p className="text-body">{t('doc.detail.not_found')}</p>
      </div>
    );
  }

  const processing = PROCESSING_STATUSES.includes(detail.status);
  const canFix =
    auth.ok &&
    (auth.role === 'owner' || auth.role === 'member') &&
    (detail.status === 'ready' || detail.status === 'needs_review');
  const signed = detail.file
    ? await supabase.storage.from('org-files').createSignedUrl(detail.file.path, 300)
    : null;
  const fileUrl = signed && !signed.error ? (signed.data?.signedUrl ?? null) : null;
  const originalId =
    auth.ok && detail.status === 'duplicate'
      ? await supabaseDuplicateStore(supabase, auth.orgId)
          .originalOf(detail.id)
          .catch(() => null)
      : null;
  const paymentView =
    auth.ok && !processing && detail.status !== 'failed'
      ? await loadPaymentView(supabasePaymentStore(supabase, auth.orgId), detail.id)
      : null;
  const canAct = auth.ok && (auth.role === 'owner' || auth.role === 'member');

  return (
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-2 lg:items-start">
      <Link href="/inbox" className="text-body underline lg:col-span-2">
        {t('doc.detail.back')}
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-2 lg:col-span-2">
        <h1 className="text-title">{detail.title ?? t('inbox.row.unknown_supplier')}</h1>
        <StatusBadge
          status={detail.status}
          cls={detail.cls}
          {...(processing ? { processingSince: detail.createdAt } : {})}
        />
      </div>

      {detail.status === 'duplicate' ? (
        <DuplicateNotice
          documentId={detail.id}
          originalId={originalId}
          canAct={auth.ok && (auth.role === 'owner' || auth.role === 'member')}
        />
      ) : null}

      {processing ? (
        <>
          <p className="text-body">{t('doc.detail.reading')}</p>
          <AutoRefresh active />
        </>
      ) : detail.status === 'failed' ? (
        <Card className="flex flex-col gap-4 p-6">
          <p className="text-body">{t('doc.detail.failed')}</p>
          {auth.ok && (auth.role === 'owner' || auth.role === 'member') ? (
            <form action={readAgainAction}>
              <input type="hidden" name="id" value={detail.id} />
              <Button type="submit">{t('doc.read_again.button')}</Button>
            </form>
          ) : null}
        </Card>
      ) : (
        <>
          {paymentView && (paymentView.paidAt !== null || paymentView.found.length > 0) ? (
            <PaymentCard documentId={detail.id} view={paymentView} canAct={canAct} />
          ) : null}
          <Card className="flex flex-col gap-4 p-6">
            <h2 className="text-card-title">{t('doc.detail.read_title')}</h2>
            {detail.readBy === 'isdoc' ? (
              <p className="text-meta text-muted-foreground">{t('doc.detail.read_by_isdoc')}</p>
            ) : null}
            <dl className="flex flex-col gap-3">
              {detail.fields.map((field) => {
                const editKey = canFix ? editKeyOf(field.label) : null;
                return (
                  <div key={field.label} className="flex flex-wrap justify-between gap-2">
                    <dt className="text-body text-foreground">{t(field.label)}</dt>
                    <dd className="text-body">
                      {field.kind === 'money' ? (
                        <MoneyText value={field.value} currency={detail.currency} />
                      ) : field.kind === 'date' ? (
                        <LegalDateText date={field.value as LegalDate} />
                      ) : (
                        field.value
                      )}
                    </dd>
                    {editKey ? (
                      <FixField
                        documentId={detail.id}
                        editKey={editKey}
                        kind={EDITABLE[editKey].kind}
                        label={field.label}
                        current={field.value}
                      />
                    ) : null}
                  </div>
                );
              })}
              {detail.vatLines.map((line) => (
                <p key={`${line.rate}-${line.base}`} className="text-body">
                  {t('doc.detail.vat_line', { rate: line.rate, base: line.base, vat: line.vat })}
                </p>
              ))}
            </dl>
          </Card>

          {detail.checks.length > 0 ? (
            <Card className="flex flex-col gap-4 p-6">
              <h2 className="text-card-title">{t('doc.detail.attention_title')}</h2>
              <ul className="flex flex-col gap-3">
                {detail.checks.map((check) => (
                  <li
                    key={`${check.key}-${JSON.stringify(check.params)}`}
                    className="flex flex-wrap items-center gap-2 text-body"
                  >
                    {check.severity === 'blocking' ? (
                      <Badge tone="warning">{t('status.badge.needs_review')}</Badge>
                    ) : null}
                    <span>{t(check.key, check.params)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : (
            <p className="text-body">{t('doc.detail.all_good')}</p>
          )}
          {auth.ok && (auth.role === 'owner' || auth.role === 'member') ? (
            <form action={moveToTrashAction} className="lg:col-span-2">
              <input type="hidden" name="id" value={id} />
              <Button type="submit" variant="secondary">
                {t('trash.move')}
              </Button>
            </form>
          ) : null}
        </>
      )}

      {pagesView && !processing ? (
        <PagesCard
          documentId={detail.id}
          view={pagesView}
          canFix={auth.ok && (auth.role === 'owner' || auth.role === 'member')}
          candidates={candidates}
        />
      ) : null}

      <div className="lg:sticky lg:top-6">
        {detail.file && fileUrl ? (
          detail.file.mimeType.startsWith('image/') ? (
            <img
              src={fileUrl}
              alt={t('doc.detail.preview_alt')}
              className="max-w-full rounded-control border border-border"
            />
          ) : (
            <>
              {detail.file.mimeType === 'application/pdf' ? <PdfViewer url={fileUrl} /> : null}
              <a
                href={fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-body underline"
              >
                {t('doc.detail.open_file')}
              </a>
            </>
          )
        ) : null}
      </div>
    </div>
  );
}
