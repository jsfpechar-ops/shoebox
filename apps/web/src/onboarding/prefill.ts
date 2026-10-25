import type { AresSubject } from '@shoebox/registries';

export interface FirmAddress {
  street: string;
  house_number: string | null;
  orientation_number: string | null;
  city: string;
  zip: string;
  country: string;
}

export interface OnboardingPrefill {
  ico: string;
  name: string;
  dic: string | null;
  address: FirmAddress;
  /** One line for the confirmation card. */
  addressText: string;
  fuCode: string | null;
  /** From `dphAktivni`; the user confirms with a chip. */
  vatGuess: 'platce' | 'neplatce';
  /** YYYY-MM-DD. */
  validFrom: string;
  slugBase: string;
}

/** Lower-case ASCII slug, max 30 chars; empty → `firma`. */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/g, '');
  return slug === '' ? 'firma' : slug;
}

/** M11 §5.5: 1 Jan of the current year, or the ARES `datumVzniku` when it is later. */
export function validFromFor(today: string, datumVzniku: string | null): string {
  const jan1 = `${today.slice(0, 4)}-01-01`;
  const founded = datumVzniku === null ? null : datumVzniku.slice(0, 10);
  return founded !== null && founded > jan1 ? founded : jan1;
}

export function prefillFromAres(subject: AresSubject, today: string): OnboardingPrefill {
  const sidlo = subject.sidlo;
  const name = subject.obchodniJmeno;
  return {
    ico: subject.ico,
    name,
    dic: subject.dic,
    address: {
      street: sidlo.nazevUlice ?? sidlo.nazevCastiObce ?? sidlo.nazevObce ?? '',
      house_number: sidlo.cisloDomovni != null ? String(sidlo.cisloDomovni) : null,
      orientation_number: sidlo.cisloOrientacni != null ? String(sidlo.cisloOrientacni) : null,
      city: sidlo.nazevObce ?? '',
      zip: sidlo.psc != null ? String(sidlo.psc).padStart(5, '0') : '',
      country: sidlo.kodStatu ?? 'CZ',
    },
    addressText: sidlo.textovaAdresa ?? '',
    fuCode: subject.financniUrad ?? null,
    vatGuess: subject.dphAktivni === true ? 'platce' : 'neplatce',
    validFrom: validFromFor(today, subject.datumVzniku),
    slugBase: slugify(name),
  };
}
