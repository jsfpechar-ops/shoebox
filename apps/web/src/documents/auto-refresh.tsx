'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Delay before refresh number `n` (0-based): 4 s, growing by half each time, never over 20 s. */
export function refreshDelayMs(n: number): number {
  return Math.min(20_000, Math.round(4000 * 1.5 ** n));
}

/** Stops after this long, so a forgotten tab does not keep reading the database (Supabase egress). */
export const AUTO_REFRESH_MAX_MS = 5 * 60_000;

/** Refreshes the server data while documents are still being read, with backoff; renders nothing. */
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    let n = 0;
    let elapsed = 0;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      const delay = refreshDelayMs(n++);
      if (elapsed + delay > AUTO_REFRESH_MAX_MS) return;
      timer = setTimeout(() => {
        elapsed += delay;
        if (document.visibilityState === 'visible') router.refresh();
        next();
      }, delay);
    };
    next();
    return () => clearTimeout(timer);
  }, [active, router]);
  return null;
}
