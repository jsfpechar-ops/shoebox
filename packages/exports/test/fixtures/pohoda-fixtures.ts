import type { PohodaDocument, PohodaProfile } from '../../src/index';

// Synthetic values only (hard rule 4).
export const PROFILE: PohodaProfile = {
  vatStatus: 'platce',
  ico: '25596641',
  classificationVAT: { rcv_domestic_vat: 'UDA5', iss_domestic_vat: 'UD' },
  accounting: { expense: 'NAKL', exp_software_saas: 'SOFT', income: 'VYNOS' },
  categoryLabel: (code) => `Label ${code}`,
};

export const NEPLATCE_PROFILE: PohodaProfile = { ...PROFILE, vatStatus: 'neplatce' };

export function doc(overrides: Partial<PohodaDocument> = {}): PohodaDocument {
  return {
    id: '1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9',
    revision: 1,
    class: 'received_invoice',
    issueDate: '2026-09-12',
    duzp: '2026-09-12',
    receivedDate: '2026-09-14',
    vatPointDate: '2026-09-12',
    dueDate: '2026-09-26',
    documentNumber: 'FV-2026/001',
    variableSymbol: '2026001',
    summary: 'Test & syn <"služby">',
    currency: 'CZK',
    paymentMethod: 'bank_transfer',
    payToAccount: { accountNumber: '19-2000145399', bankCode: '0800' },
    partner: {
      name: 'Test & syn s.r.o.',
      ico: '25596641',
      dic: 'CZ25596641',
      street: 'Testovací 1',
      city: 'Praha',
      zip: '11000',
      country: 'CZ',
    },
    lines: [
      {
        net: '100.00',
        vat: '21.00',
        gross: '121.00',
        vatRateType: 'standard',
        vatRatePct: '21',
        vatTreatment: 'rcv_domestic_vat',
        categoryCode: 'exp_material',
      },
    ],
    vatSummary: [{ vatRateType: 'standard', base: '100.00', vat: '21.00' }],
    ...overrides,
  };
}
