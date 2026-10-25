import type { AresSubject } from '@shoebox/registries';
import { describe, expect, it } from 'vitest';
import { prefillFromAres, slugify, validFromFor } from '../src/onboarding/prefill';

const alza: AresSubject = {
  ico: '27082440',
  obchodniJmeno: 'Alza.cz  a.s.',
  sidlo: {
    kodStatu: 'CZ',
    nazevObce: 'Praha',
    nazevCastiObce: 'Holešovice',
    nazevUlice: 'Jankovcova',
    cisloDomovni: 1522,
    cisloOrientacni: 53,
    psc: 17000,
    textovaAdresa: 'Jankovcova 1522/53, Holešovice, 17000 Praha 7',
  },
  dic: 'CZ27082440',
  pravniForma: null,
  datumVzniku: '2003-08-26',
  datumZaniku: null,
  financniUrad: '013',
  dphAktivni: true,
};

describe('onboarding prefill (M11 §5.5)', () => {
  it('slugify: diacritics, punctuation and empty input', () => {
    expect(slugify('Josef Novák')).toBe('josef-novak');
    expect(slugify('Alza.cz a.s.')).toBe('alza-cz-a-s');
    expect(slugify('  ---  ')).toBe('firma');
  });

  it('validFromFor: 1 Jan, or a later founding date', () => {
    expect(validFromFor('2026-10-25', null)).toBe('2026-01-01');
    expect(validFromFor('2026-10-25', '2003-08-26')).toBe('2026-01-01');
    expect(validFromFor('2026-10-25', '2026-03-15')).toBe('2026-03-15');
  });

  it('prefillFromAres maps the Alza record', () => {
    const p = prefillFromAres(alza, '2026-10-25');
    expect(p.address).toEqual({
      street: 'Jankovcova',
      house_number: '1522',
      orientation_number: '53',
      city: 'Praha',
      zip: '17000',
      country: 'CZ',
    });
    expect(p.fuCode).toBe('013');
    expect(p.vatGuess).toBe('platce');
    expect(p.validFrom).toBe('2026-01-01');
    expect(p.slugBase).toBe('alza-cz-a-s');
    expect(p.name).toBe('Alza.cz  a.s.');
    expect(p.addressText).toBe('Jankovcova 1522/53, Holešovice, 17000 Praha 7');
  });

  it('pads a short postal code to 5 digits', () => {
    const p = prefillFromAres({ ...alza, sidlo: { ...alza.sidlo, psc: 1234 } }, '2026-10-25');
    expect(p.address.zip).toBe('01234');
  });

  it('falls back to the district name when the street is missing', () => {
    const p = prefillFromAres(
      { ...alza, sidlo: { ...alza.sidlo, nazevUlice: null } },
      '2026-10-25',
    );
    expect(p.address.street).toBe('Holešovice');
  });
});
