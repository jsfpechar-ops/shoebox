import type { AresSubject, CnbDailyRates, CrpdphSubject, ViesResult } from '@shoebox/registries';
import { describe, expect, it } from 'vitest';
import { createFakeRegistries, fakeClock, type RegistryRecordings } from '../src/index';

// Fictitious subjects (valid IČO checksums, not real companies). No personal data.
const ACME: AresSubject = {
  ico: '12345679',
  obchodniJmeno: 'Testovací Dodavatel s.r.o.',
  sidlo: { textovaAdresa: 'Testovací 1, 110 00 Praha 1', kodStatu: 'CZ' },
  dic: 'CZ12345679',
  pravniForma: '112',
  datumVzniku: '2015-03-01',
  datumZaniku: null,
};

const UNRELIABLE: CrpdphSubject = {
  dic: '87654326',
  nespolehlivyPlatce: 'ANO',
  typSubjektu: 'NESPOLEHLIVA_OSOBA',
  datumZverejneniNespolehlivosti: '2025-06-01',
  cisloFu: '451',
  nazevSubjektu: 'Fiktivní Plátce a.s.',
  zverejneneUcty: [
    {
      datumZverejneni: '2024-01-15',
      datumZverejneniUkonceni: null,
      ucet: { kind: 'standard', predcisli: null, cislo: '123456789', kodBanky: '0100' },
    },
  ],
};

const VIES_DE: ViesResult = {
  countryCode: 'DE',
  vatNumber: '999999999',
  valid: true,
  requestDate: '2026-01-01T00:00:00.000Z',
  requestIdentifier: 'WAPIAAAAFAKE0001',
  name: 'Fiktive GmbH',
  address: 'Teststraße 1, 10115 Berlin',
};

const RATES: CnbDailyRates = {
  validFor: '2026-01-02',
  order: 1,
  rates: [
    { currencyCode: 'EUR', amount: 1, rate: '24.335' },
    { currencyCode: 'JPY', amount: 100, rate: '15.120' },
  ],
};

const RECORDINGS: RegistryRecordings = {
  ares: { [ACME.ico]: ACME },
  crpdph: { [UNRELIABLE.dic]: UNRELIABLE },
  vies: { DE999999999: VIES_DE },
  cnb: { '2026-01-02': RATES },
};

const ME = { countryCode: 'CZ', vatNumber: '12345679' };

describe('fake ARES', () => {
  it('returns the recorded subject for a known IČO', async () => {
    const fakes = createFakeRegistries(RECORDINGS);
    expect(await fakes.ares.subject('12345679')).toEqual({
      status: 'ok',
      data: ACME,
      fetchedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('returns not_found for an unknown IČO', async () => {
    const fakes = createFakeRegistries(RECORDINGS);
    expect(await fakes.ares.subject('87654326')).toEqual({
      status: 'not_found',
      fetchedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('stamps fetchedAt from the given clock', async () => {
    const clock = fakeClock('2026-05-04T10:00:00.000Z');
    const fakes = createFakeRegistries(RECORDINGS, { clock });
    clock.advance(1000);
    const result = await fakes.ares.subject('12345679');
    expect(result.status === 'ok' && result.fetchedAt).toBe('2026-05-04T10:00:01.000Z');
  });
});

describe('simulate', () => {
  it("simulate('unavailable') makes every source answer unavailable", async () => {
    const fakes = createFakeRegistries(RECORDINGS);
    fakes.simulate('unavailable');
    expect(await fakes.ares.subject('12345679')).toEqual({
      status: 'unavailable',
      reason: 'http_error',
    });
    expect((await fakes.crpdph.status(['87654326'])).status).toBe('unavailable');
    expect((await fakes.vies.check('DE', '999999999', ME)).status).toBe('unavailable');
    expect((await fakes.cnb.daily('2026-01-02')).status).toBe('unavailable');
  });

  it("simulate('timeout', source) affects only that source", async () => {
    const fakes = createFakeRegistries(RECORDINGS);
    fakes.simulate('timeout', 'ares');
    expect(await fakes.ares.subject('12345679')).toEqual({
      status: 'unavailable',
      reason: 'timeout',
    });
    expect((await fakes.cnb.daily('2026-01-02')).status).toBe('ok');
  });

  it("simulate('recorded') restores replay", async () => {
    const fakes = createFakeRegistries(RECORDINGS);
    fakes.simulate('unavailable');
    fakes.simulate('recorded');
    expect((await fakes.ares.subject('12345679')).status).toBe('ok');
  });

  it('records every call in order, outages included', async () => {
    const fakes = createFakeRegistries(RECORDINGS);
    await fakes.ares.subject('12345679');
    fakes.simulate('unavailable', 'vies');
    await fakes.vies.check('DE', '999999999', ME);
    expect(fakes.calls).toEqual([
      { source: 'ares', key: '12345679' },
      { source: 'vies', key: 'DE999999999' },
    ]);
  });
});

describe('fake CRPDPH', () => {
  it('returns recorded subjects and NENALEZEN for unknown DIČ, in request order', async () => {
    const fakes = createFakeRegistries(RECORDINGS);
    const result = await fakes.crpdph.status(['11111111', '87654326']);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.data.statusCode).toBe(0);
    expect(result.data.subjects[1]).toEqual(UNRELIABLE);
    expect(result.data.subjects[0]).toMatchObject({
      dic: '11111111',
      nespolehlivyPlatce: 'NENALEZEN',
      typSubjektu: 'NENALEZEN',
      zverejneneUcty: [],
    });
  });

  it('status code 1 is an ok answer that carries statusCode 1', async () => {
    const fakes = createFakeRegistries(RECORDINGS);
    fakes.simulateCrpdphStatus(1);
    const result = await fakes.crpdph.status(['87654326']);
    expect(result.status === 'ok' && result.data.statusCode).toBe(1);
  });

  it('status code 2 is the nightly outage', async () => {
    const fakes = createFakeRegistries(RECORDINGS);
    fakes.simulateCrpdphStatus(2);
    expect(await fakes.crpdph.status(['87654326'])).toEqual({
      status: 'unavailable',
      reason: 'crpdph_outage',
    });
  });

  it('status code 3 is service unavailable', async () => {
    const fakes = createFakeRegistries(RECORDINGS);
    fakes.simulateCrpdphStatus(3);
    expect(await fakes.crpdph.status(['87654326'])).toEqual({
      status: 'unavailable',
      reason: 'crpdph_unavailable',
    });
  });

  it('rejects a DIČ with the CZ prefix and more than 100 DIČ', async () => {
    const fakes = createFakeRegistries(RECORDINGS);
    await expect(fakes.crpdph.status(['CZ87654326'])).rejects.toThrow(RangeError);
    const tooMany = Array.from({ length: 101 }, (_, i) => String(10000000 + i));
    await expect(fakes.crpdph.status(tooMany)).rejects.toThrow(RangeError);
    await expect(fakes.crpdph.status([])).rejects.toThrow(RangeError);
  });
});

describe('fake VIES and ČNB', () => {
  it('VIES replays a recorded valid number and answers valid:false for an unknown one', async () => {
    const fakes = createFakeRegistries(RECORDINGS);
    expect(await fakes.vies.check('DE', '999999999', ME)).toEqual({
      status: 'ok',
      data: VIES_DE,
      fetchedAt: '2026-01-01T00:00:00.000Z',
    });
    const unknown = await fakes.vies.check('AT', 'U00000000', ME);
    expect(unknown.status === 'ok' && unknown.data.valid).toBe(false);
  });

  it('ČNB replays a recorded fixing with string rates and answers not_found otherwise', async () => {
    const fakes = createFakeRegistries(RECORDINGS);
    const result = await fakes.cnb.daily('2026-01-02');
    expect(result.status === 'ok' && result.data.rates[0]?.rate).toBe('24.335');
    expect((await fakes.cnb.daily('2026-01-03')).status).toBe('not_found');
  });
});
