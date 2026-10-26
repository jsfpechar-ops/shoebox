import { pragueToday } from '@shoebox/domain';
import { t } from '@shoebox/i18n';
import { Card, formatLegalDate } from '@shoebox/ui';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { requireActiveRole } from '../../../src/auth/org-context';
import { HelpTip } from '../../../src/overview/help-tip';
import { loadSettings } from '../../../src/settings/settings-data';
import { createSupabaseServerClient } from '../../../src/supabase/server';

export const metadata: Metadata = { title: t('settings.title') };

function Row({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <dt className="flex items-center gap-1 text-body">
        {label}
        {help === undefined ? null : <HelpTip term={label} text={help} />}
      </dt>
      <dd className="text-body">{children}</dd>
    </div>
  );
}

export default async function SettingsPage() {
  const auth = await requireActiveRole(['owner', 'member', 'accountant', 'viewer']);
  const supabase = auth.ok ? await createSupabaseServerClient() : null;
  const view =
    auth.ok && supabase
      ? await loadSettings(
          supabase,
          auth.orgId,
          auth.userId,
          pragueToday({ now: () => Date.now() }),
        )
      : null;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-title">{t('settings.title')}</h1>
      {view === null ? (
        <Card className="p-6">
          <p className="text-body">{t('settings.empty')}</p>
        </Card>
      ) : (
        <>
          <Card className="flex flex-col gap-4 p-6">
            <h2 className="text-card-title">{t('settings.firm.title')}</h2>
            <dl className="flex flex-col gap-4">
              <Row label={t('settings.firm.name')}>{view.firm.name}</Row>
              <Row label={t('settings.firm.ico')} help={t('settings.help.ico')}>
                {view.firm.ico}
              </Row>
              <Row label={t('settings.firm.dic')} help={t('settings.help.dic')}>
                {view.firm.dic ?? t('settings.firm.dic_none')}
              </Row>
              {view.firm.address === null ? null : (
                <Row label={t('settings.firm.address')}>{view.firm.address}</Row>
              )}
            </dl>
            <p className="text-body">{t('settings.firm.source')}</p>
          </Card>

          {view.tax === null ? null : (
            <Card className="flex flex-col gap-4 p-6">
              <h2 className="text-card-title">{t('settings.tax.title')}</h2>
              <dl className="flex flex-col gap-4">
                <Row label={t('settings.tax.vat')} help={t('settings.help.vat')}>
                  {t(view.tax.vat)}
                </Row>
                <Row label={t('settings.tax.regime')} help={t('settings.help.regime')}>
                  {view.tax.flatRate === null
                    ? t(view.tax.regime)
                    : `${t(view.tax.regime)} · ${t('settings.tax.flat_rate', { rate: String(view.tax.flatRate) })}`}
                </Row>
              </dl>
              <p className="text-body">
                {t('settings.tax.since', { date: formatLegalDate(view.tax.since) })}
              </p>
            </Card>
          )}

          <Card className="flex flex-col gap-4 p-6">
            <h2 className="text-card-title">{t('settings.team.title')}</h2>
            <dl className="flex flex-col gap-4">
              {view.team.map((member) => (
                <Row key={member.userId} label={t(member.role)}>
                  {member.isYou ? t('settings.team.you') : null}
                </Row>
              ))}
            </dl>
          </Card>
        </>
      )}
    </div>
  );
}
