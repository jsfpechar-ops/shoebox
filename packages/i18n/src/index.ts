import cs from '../messages/cs.json' with { type: 'json' };
import en from '../messages/en.json' with { type: 'json' };
import { type IcuNode, type Params, parse, render } from './icu';

export const packageName = '@shoebox/i18n' as const;

export type { IcuNode, Params } from './icu';
export { formatMessage, IcuSyntaxError, parse } from './icu';

/**
 * English is the source of truth for now (owner 2026-10-25): it defines the keys and is the default.
 * Czech is kept dormant: it may miss keys, and a missing Czech key falls back to English.
 */
export type Locale = 'cs' | 'en';
export type MessageKey = keyof typeof en;
export type Catalog = Readonly<Record<MessageKey, string>>;

export const DEFAULT_LOCALE: Locale = 'en';

// Assigning `en` to Catalog keeps it complete; Czech is partial until it comes back.
export const catalogs: Readonly<{ en: Catalog; cs: Partial<Catalog> }> = { cs, en };

export type Translate = (key: MessageKey, params?: Params) => string;

/** Returns `t` for one locale. Pure (no Node or DOM API), so it runs on the server and in the browser. */
export function createT(locale: Locale): Translate {
  const catalog = catalogs[locale];
  const cache = new Map<MessageKey, IcuNode[]>();
  return (key, params = {}) => {
    let nodes = cache.get(key);
    if (nodes === undefined) {
      nodes = parse(catalog[key] ?? catalogs.en[key]);
      cache.set(key, nodes);
    }
    return render(nodes, locale, params);
  };
}

/** English translator, the default for server code and tests (DEFAULT_LOCALE). */
export const t: Translate = createT(DEFAULT_LOCALE);
