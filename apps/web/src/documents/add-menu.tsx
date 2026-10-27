'use client';

import { t } from '@shoebox/i18n';
import { cn, focusRing, motion, toast } from '@shoebox/ui';
import { Camera, FileUp, PenLine } from 'lucide-react';
import Link from 'next/link';
import { type ChangeEvent, useRef, useState } from 'react';
import { useUploadSend } from './upload-send';

const ACCEPT_FILES =
  'application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,.isdoc,.isdocx,.xml,.gpc,.abo,.sta,.mt940';
const ACCEPT_CAMERA = 'image/jpeg,image/png,image/webp';

/**
 * The "+" on the mobile bottom bar (07 §5): a bottom sheet with the three ways to add.
 * Upload and Snap send straight to the upload API and toast the result; Add by hand is a link.
 */
export function AddMenu({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const { busy, send } = useUploadSend();
  const filesRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [busyItem, setBusyItem] = useState<'files' | 'camera' | null>(null);

  async function sendFrom(which: 'files' | 'camera', event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (files.length === 0) return;
    setBusyItem(which);
    const result = await send(files);
    setBusyItem(null);
    if (result.message) toast(result.message);
    if (result.ok) onOpenChange(false);
  }

  const row = 'flex min-h-14 w-full items-center gap-4 rounded-control px-4 text-left';
  return (
    <div className="grid gap-2">
      <label
        className={cn(row, 'text-body text-foreground hover:bg-muted', motion, focusRing)}
        data-testid="add-upload"
      >
        <input
          ref={filesRef}
          type="file"
          multiple
          accept={ACCEPT_FILES}
          disabled={busy}
          onChange={(event) => void sendFrom('files', event)}
          className="sr-only"
        />
        <FileUp size={22} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-primary" />
        <span className="flex-1">{t('shell.nav.add_upload')}</span>
        {busyItem === 'files' && (
          <span className="text-meta text-muted-foreground">{t('shell.loading')}</span>
        )}
      </label>
      <label
        className={cn(row, 'text-body text-foreground hover:bg-muted', motion, focusRing)}
        data-testid="add-snap"
      >
        <input
          ref={cameraRef}
          type="file"
          accept={ACCEPT_CAMERA}
          capture="environment"
          disabled={busy}
          onChange={(event) => void sendFrom('camera', event)}
          className="sr-only"
        />
        <Camera size={22} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-primary" />
        <span className="flex-1">{t('shell.nav.add_snap')}</span>
        {busyItem === 'camera' && (
          <span className="text-meta text-muted-foreground">{t('shell.loading')}</span>
        )}
      </label>
      <Link
        href="/inbox/new"
        onClick={() => onOpenChange(false)}
        className={cn(row, 'text-body text-foreground hover:bg-muted', motion, focusRing)}
        data-testid="add-manual"
      >
        <PenLine size={22} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-primary" />
        <span className="flex-1">{t('shell.nav.add_manual')}</span>
      </Link>
    </div>
  );
}
