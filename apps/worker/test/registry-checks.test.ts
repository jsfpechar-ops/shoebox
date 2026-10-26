import type { ProtoExtraction } from '@shoebox/extraction';
import type {
  CrpdphClient,
  CrpdphPublishedAccount,
  CrpdphSubject,
  ViesClient,
} from '@shoebox/registries';
import { czAccountToIban } from '@shoebox/validation';
import { describe, expect, it, vi } from 'vitest';
import { type RegistryDeps, registryRows } from '../src/doc-extract/registry-checks';

// Synthetic values only.
const ORG = { ico: '25596641', dic: 'CZ25596641' };
// Built at runtime: the PII guard allowlists sample IBANs only under packages/*/test.
const PAID_IBAN = czAccountToIban('19', '2000145399', '0800') as string;

function reading(
  supplier: Partial<ProtoExtraction['supplier']>,
  payment: Partial<ProtoExtraction['payment']> = {},
  vatRecap: ProtoExtraction['vat_recap'] = [{ rate_pct: '21', base: '100.00', vat: '21.00' }],
): ProtoExtraction {
  return {
    schema_version: 'm02-proto-v3',
    kind_hint: 'tax_invoice',
    supplier: {
      name: 'Synthetic s.r.o.',
      ico: '00006947',
      dic: 'CZ00006947',
      vat_id: null,
      country: 'CZ',
      ...supplier,
    },
    payment: {
      account_number: null,
      bank_code: null,
      iban: null,
      method: 'bank_transfer',
      ...payment,
    },
    vat_recap: vatRecap,
  } as ProtoExtraction;
}

function subject(overrides: Partial<CrpdphSubject> = {}): CrpdphSubject {
  return {
    dic: '00006947',
    nespolehlivyPlatce: 'NE',
    typSubjektu: 'PLATCE_DPH',
    datumZverejneniNespolehlivosti: null,
    cisloFu: '451',
    nazevSubjektu: 'Synthetic s.r.o.',
    zverejneneUcty: [],
    ...overrides,
  };
}

function published(
  predcisli: string | null,
  cislo: string,
  kodBanky: string,
): CrpdphPublishedAccount {
  return {
    datumZverejneni: '2024-01-01',
    datumZverejneniUkonceni: null,
    ucet: { kind: 'standard', predcisli, cislo, kodBanky },
  };
}

function crpdphWith(subjects: CrpdphSubject[]): CrpdphClient {
  return {
    status: async () => ({
      status: 'ok',
      data: { statusCode: 0, statusText: 'OK', odpovedGenerovana: '2026-10-26T08:00:00', subjects },
      fetchedAt: '2026-10-26T08:00:00Z',
    }),
  };
}

function viesWith(valid: boolean): ViesClient {
  return {
    check: async (countryCode, vatNumber) => ({
      status: 'ok',
      data: {
        countryCode,
        vatNumber,
        valid,
        requestDate: '2026-10-26',
        requestIdentifier: null,
        name: null,
        address: null,
      },
      fetchedAt: '2026-10-26T08:00:00Z',
    }),
  };
}

const offlineCrpdph: CrpdphClient = {
  status: async () => ({ status: 'unavailable', reason: 'timeout' }),
};
const offlineVies: ViesClient = {
  check: async () => ({ status: 'unavailable', reason: 'vies_unavailable' }),
};

function ruleIds(rows: { ruleId: string }[]): string[] {
  return rows.map((r) => r.ruleId);
}

describe('registry warnings', () => {
  it('warns that the supplier is an unreliable VAT payer', async () => {
    const deps: RegistryDeps = {
      crpdph: crpdphWith([
        subject({ nespolehlivyPlatce: 'ANO', datumZverejneniNespolehlivosti: '2026-01-01' }),
      ]),
      vies: offlineVies,
    };
    const rows = await registryRows(reading({}), ORG, deps);
    expect(ruleIds(rows)).toEqual(['PROTO_REG_UNRELIABLE']);
    expect(rows[0]?.severity).toBe('warning');
  });

  it('warns when a VAT-charging supplier is not in the VAT register, but not at zero VAT', async () => {
    const deps: RegistryDeps = {
      crpdph: crpdphWith([subject({ typSubjektu: 'NENALEZEN', nespolehlivyPlatce: 'NENALEZEN' })]),
      vies: offlineVies,
    };
    expect(ruleIds(await registryRows(reading({}), ORG, deps))).toEqual([
      'PROTO_REG_NOT_VAT_PAYER',
    ]);
    const zeroVat = [{ rate_pct: '0', base: '100.00', vat: '0.00' }];
    expect(await registryRows(reading({}, {}, zeroVat), ORG, deps)).toEqual([]);
  });

  it('warns when the account to pay is not published for the supplier', async () => {
    const deps: RegistryDeps = {
      crpdph: crpdphWith([subject({ zverejneneUcty: [published('19', '2000145399', '0100')] })]),
      vies: offlineVies,
    };
    const rows = await registryRows(reading({}, { iban: PAID_IBAN }), ORG, deps);
    expect(ruleIds(rows)).toEqual(['PROTO_REG_ACCOUNT_UNPUBLISHED']);
    expect(rows[0]?.params.iban).toBe(PAID_IBAN);
  });

  it('does not warn when the paid account is published, even when the IBAN is built from the account', async () => {
    const deps: RegistryDeps = {
      crpdph: crpdphWith([subject({ zverejneneUcty: [published('19', '2000145399', '0800')] })]),
      vies: offlineVies,
    };
    expect(await registryRows(reading({}, { iban: PAID_IBAN }), ORG, deps)).toEqual([]);
    const built = reading({}, { account_number: '19-2000145399', bank_code: '0800', iban: null });
    expect(await registryRows(built, ORG, deps)).toEqual([]);
  });

  it('warns when the EU VAT ID is invalid in VIES, and not when it is valid', async () => {
    const foreign = reading({ dic: null, vat_id: 'DE123456789', country: 'DE' });
    const invalid: RegistryDeps = { crpdph: offlineCrpdph, vies: viesWith(false) };
    expect(ruleIds(await registryRows(foreign, ORG, invalid))).toEqual([
      'PROTO_REG_VAT_ID_INVALID',
    ]);
    const valid: RegistryDeps = { crpdph: offlineCrpdph, vies: viesWith(true) };
    expect(await registryRows(foreign, ORG, valid)).toEqual([]);
  });

  it('adds nothing when the registries are unavailable', async () => {
    const deps: RegistryDeps = { crpdph: offlineCrpdph, vies: offlineVies };
    expect(
      await registryRows(
        reading({ vat_id: 'DE123456789', country: 'DE' }, { iban: PAID_IBAN }),
        ORG,
        deps,
      ),
    ).toEqual([]);
  });

  it('adds nothing when a client throws', async () => {
    const throwing: RegistryDeps = {
      crpdph: {
        status: async () => {
          throw new Error('boom');
        },
      },
      vies: {
        check: async () => {
          throw new Error('boom');
        },
      },
    };
    expect(
      await registryRows(reading({ vat_id: 'DE123456789', country: 'DE' }), ORG, throwing),
    ).toEqual([]);
  });

  it('never looks up the organization own DIČ', async () => {
    const status = vi.fn<CrpdphClient['status']>(async () => ({
      status: 'unavailable',
      reason: 'timeout',
    }));
    const deps: RegistryDeps = { crpdph: { status }, vies: offlineVies };
    await registryRows(reading({ dic: 'CZ25596641' }), ORG, deps);
    expect(status).not.toHaveBeenCalled();
  });
});
