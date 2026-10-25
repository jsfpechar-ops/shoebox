'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Refreshes the server data every 4 s while documents are still being read; renders nothing. */
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [active, router]);
  return null;
}
