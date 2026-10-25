import { t } from '@shoebox/i18n';
import { signOut, signOutEverywhere } from './actions';

// Server component (no @shoebox/ui import: the ui index pulls Radix, client only). Tokens only (07 §3).
const button =
  'min-h-11 rounded-control border border-input bg-card px-3 text-body text-foreground hover:opacity-80 transition-opacity duration-200 ease-out motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

/** "Odhlásit" and "Odhlásit všude" (M12 §4.5 V3.4). TODO(P1-UI): move into the avatar menu of M11 §3. */
export function LogoutButtons() {
  return (
    <form className="flex items-center gap-2" data-slot="logout">
      <button type="submit" formAction={signOut} className={button}>
        {t('auth.logout.cta')}
      </button>
      <button type="submit" formAction={signOutEverywhere} className={button}>
        {t('auth.logout.everywhere')}
      </button>
    </form>
  );
}
