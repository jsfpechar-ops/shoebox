'use client';

import { type MessageKey, t } from '@shoebox/i18n';
import { cn, focusRing, motion } from '@shoebox/ui';
import { Briefcase, Inbox, LayoutDashboard, type LucideIcon, Plus, Settings } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

type NavItem = { href: string; label: MessageKey; icon: LucideIcon };

/** The four screens of the app shell (07 §5, M11 §3), in this order on every device. */
export const navItems: readonly NavItem[] = [
  { href: '/inbox', label: 'inbox.title', icon: Inbox },
  { href: '/prehled', label: 'overview.title', icon: LayoutDashboard },
  { href: '/ucetni', label: 'accountant.title', icon: Briefcase },
  { href: '/nastaveni', label: 'settings.title', icon: Settings },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const label = t(item.label);
  const Icon = item.icon;
  return (
    <li className="flex flex-1 md:flex-none">
      <Link
        href={item.href}
        data-nav-item=""
        aria-current={active ? 'page' : undefined}
        title={label}
        className={cn(
          'flex min-h-14 w-full flex-col items-center justify-center gap-1 rounded-control px-1 text-center text-meta text-muted-foreground',
          'hover:text-foreground aria-[current=page]:bg-muted aria-[current=page]:text-primary',
          'md:size-11 md:min-h-11 xl:w-full xl:flex-row xl:justify-start xl:gap-3 xl:px-3',
          motion,
          focusRing,
        )}
      >
        <Icon size={20} strokeWidth={1.5} aria-hidden="true" className="shrink-0" />
        <span className="md:sr-only xl:not-sr-only">{label}</span>
      </Link>
    </li>
  );
}

/**
 * Mobile (< 768 px): bottom bar with the four screens and a central "+" (07 §5).
 * Desktop: left rail, 64 px with icons (label as tooltip), 200 px with labels from 1440 px. No hamburger.
 */
export function AppNav() {
  const pathname = usePathname();
  const [first, second, third, fourth] = navItems;
  const link = (item: NavItem | undefined) =>
    item ? <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} /> : null;

  return (
    <nav
      aria-label={t('shell.nav.label')}
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)]',
        'md:sticky md:top-0 md:h-dvh md:w-16 md:shrink-0 md:border-t-0 md:border-r md:pb-0 xl:w-50',
      )}
    >
      <ul className="flex items-stretch gap-1 px-1 md:flex-col md:items-center md:gap-2 md:px-0 md:pt-4 xl:items-stretch xl:px-3">
        {link(first)}
        {link(second)}
        <li className="flex flex-1 items-center justify-center md:hidden">
          {/* TODO(P1-UI-02): the "+" opens the menu Nahrát · Vyfotit · Přidat ručně. */}
          <Link
            href="/inbox"
            aria-label={t('shell.nav.add')}
            className={cn(
              'flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground hover:opacity-90',
              motion,
              focusRing,
            )}
          >
            <Plus size={24} strokeWidth={1.5} aria-hidden="true" />
          </Link>
        </li>
        {link(third)}
        {link(fourth)}
      </ul>
    </nav>
  );
}
