'use client';

import { t } from '@shoebox/i18n';
import { Button } from '@shoebox/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** "Forget" for one remembered supplier: resets its memory and re-sorts its open documents. */
export function ForgetVendorButton({ id, supplier }: { id: string; supplier: string }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle');

  async function forget() {
    setState('busy');
    try {
      const res = await fetch(`/api/vendor-profiles/${encodeURIComponent(id)}/memory?reprocess=true`, {
        method: 'DELETE',
      });
      setState(res.ok ? 'done' : 'failed');
      if (res.ok) router.refresh();
    } catch {
      setState('failed');
    }
  }

  if (state === 'done') return <p role="status" className="text-body">{t('settings.vendors.forgotten')}</p>;
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="secondary"
        disabled={state === 'busy'}
        aria-label={`${t('settings.vendors.forget')}: ${supplier}`}
        onClick={forget}
      >
        {t('settings.vendors.forget')}
      </Button>
      {state === 'failed' ? <p role="alert" className="text-body">{t('settings.vendors.failed')}</p> : null}
    </div>
  );
}
