import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPohodaDataPack, type PohodaDocument } from '../src/index';
import { doc, NEPLATCE_PROFILE, PROFILE } from './fixtures/pohoda-fixtures';

const XSD = join(import.meta.dirname, '..', 'xsd', 'pohoda', 'version_2', 'data.xsd');

function validate(xml: string): string {
  const file = join(mkdtempSync(join(tmpdir(), 'pohoda-')), 'pack.xml');
  writeFileSync(file, xml);
  try {
    return execFileSync('xmllint', ['--noout', '--schema', XSD, file], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const e = error as { stderr?: string };
    throw new Error(`xmllint failed: ${e.stderr ?? String(error)}`);
  }
}

function build(docs: PohodaDocument[], profile = PROFILE) {
  const result = buildPohodaDataPack(
    { periodLabel: '2026-09', version: 1, documents: docs },
    profile,
  );
  // An empty dataPack is not valid per the XSD (dataPackItem is required), so only validate non-empty packs.
  if (result.items.length > 0) validate(result.xml);
  return result;
}

describe('buildPohodaDataPack', () => {
  it('received invoice for a neplatce org is nonSubsume and validates (117.00, not a tax document)', () => {
    const d = doc({
      lines: [
        {
          net: '117.00',
          vat: '0.00',
          gross: '117.00',
          vatRateType: 'none',
          vatRatePct: null,
          vatTreatment: 'rcv_domestic_vat',
          categoryCode: 'exp_material',
        },
      ],
      vatSummary: [{ vatRateType: 'none', base: '117.00', vat: '0.00' }],
    });
    const { xml, items, warnings } = build([d], NEPLATCE_PROFILE);
    expect(xml).toContain('<inv:invoiceType>receivedInvoice</inv:invoiceType>');
    expect(xml).toContain('<typ:classificationVATType>nonSubsume</typ:classificationVATType>');
    expect(xml).not.toContain('dateKHDPH');
    expect(xml).toContain('<typ:priceNone>117.00</typ:priceNone>');
    expect(items[0]?.agenda).toBe('invoice');
    expect(warnings).toEqual([]);
  });

  it('platce received invoice carries VAT dates, mapped codes and the summary', () => {
    const { xml, warnings } = build([doc()]);
    expect(xml).toContain('<inv:dateKHDPH>2026-09-12</inv:dateKHDPH>');
    expect(xml).toContain('<inv:dateApplicationVAT>2026-09-12</inv:dateApplicationVAT>');
    expect(xml).toContain('<typ:ids>UDA5</typ:ids>');
    expect(xml).toContain('<typ:ids>NAKL</typ:ids>');
    expect(xml).toContain('<typ:priceHighSum>121.00</typ:priceHighSum>');
    expect(xml).toContain('<inv:symVar>2026001</inv:symVar>');
    expect(xml).toContain('<typ:paymentType>draft</typ:paymentType>');
    expect(xml).toContain('<typ:accountNo>19-2000145399</typ:accountNo>');
    expect(warnings).toEqual([]);
  });

  it('issued invoice', () => {
    const d = doc({
      class: 'issued_invoice',
      lines: [
        {
          net: '1000.00',
          vat: '210.00',
          gross: '1210.00',
          vatRateType: 'standard',
          vatRatePct: '21',
          vatTreatment: 'iss_domestic_vat',
          categoryCode: 'income_services',
        },
      ],
      vatSummary: [{ vatRateType: 'standard', base: '1000.00', vat: '210.00' }],
    });
    const { xml } = build([d]);
    expect(xml).toContain('<inv:invoiceType>issuedInvoice</inv:invoiceType>');
    expect(xml).toContain('<typ:ids>VYNOS</typ:ids>');
    expect(xml).toContain('<typ:ids>UD</typ:ids>');
  });

  it('mixed invoice yields two items with their own accounting codes', () => {
    const base = doc().lines[0];
    if (!base) throw new Error('fixture');
    const d = doc({
      lines: [
        base,
        { ...base, categoryCode: 'exp_software_saas', net: '50.00', vat: '10.50', gross: '60.50' },
        { ...base, net: '20.00', vat: '4.20', gross: '24.20' },
      ],
      vatSummary: [{ vatRateType: 'standard', base: '170.00', vat: '35.70' }],
    });
    const { xml } = build([d]);
    expect(xml.match(/<inv:invoiceItem>/g)).toHaveLength(2);
    expect(xml).toContain('<typ:ids>SOFT</typ:ids>');
    expect(xml).toContain('<typ:price>120.00</typ:price>');
    expect(xml).toContain('<typ:priceVAT>25.20</typ:priceVAT>');
  });

  it('warns about unmapped accounting and classification, and omits the elements', () => {
    const { xml, warnings } = build([doc()], {
      ...PROFILE,
      classificationVAT: {},
      accounting: {},
    });
    expect(xml).not.toContain('<inv:accounting>');
    expect(xml).not.toContain('classificationVAT');
    expect(warnings.map((w) => w.code).sort()).toEqual([
      'unmapped_accounting',
      'unmapped_classification',
    ]);
  });

  it('cash receipt becomes a voucher with a cash account, else an intDoc with a warning', () => {
    const d = doc({ class: 'received_receipt', paymentMethod: 'cash', payToAccount: null });
    const withCash = build([d], { ...PROFILE, cashAccount: 'HP' });
    expect(withCash.items[0]?.agenda).toBe('voucher');
    expect(withCash.xml).toContain('<vch:voucherType>expense</vch:voucherType>');
    expect(withCash.xml).toContain('<vch:cashAccount><typ:ids>HP</typ:ids></vch:cashAccount>');
    expect(withCash.warnings).toEqual([]);

    const without = build([d]);
    expect(without.items[0]?.agenda).toBe('intDoc');
    expect(without.warnings).toEqual([{ code: 'cash_account_missing', documentId: d.id }]);
  });

  it('card receipt is an intDoc', () => {
    const { xml, items } = build([doc({ class: 'received_receipt', paymentMethod: 'card' })]);
    expect(items[0]?.agenda).toBe('intDoc');
    expect(xml).toContain('<int:intDocHeader>');
  });

  it('platform statement and advance tax doc are intDocs', () => {
    const { items } = build([
      doc({ class: 'platform_statement' }),
      doc({ id: '2f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9', class: 'received_advance_tax_doc' }),
    ]);
    expect(items.map((i) => i.agenda)).toEqual(['intDoc', 'intDoc']);
  });

  it('skips a EUR invoice with a warning', () => {
    const d = doc({ currency: 'EUR' });
    const { items, warnings } = build([d]);
    expect(items).toEqual([]);
    expect(warnings).toEqual([{ code: 'foreign_currency', documentId: d.id }]);
  });

  it('skips a non_document silently', () => {
    const { items, warnings } = build([doc({ class: 'non_document' })]);
    expect(items).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('item ids are deterministic across runs', () => {
    const a = build([doc()]);
    const b = build([doc()]);
    expect(a.xml).toBe(b.xml);
    expect(a.items[0]?.itemId).toBe('SB1f2e3d4c5b6a-r1');
    expect(a.xml).toContain('id="SB-25596641-2026-09-v1"');
  });

  it('escapes special characters', () => {
    const { xml } = build([doc()]);
    expect(xml).toContain('Test &amp; syn s.r.o.');
    expect(xml).toContain('Test &amp; syn &lt;&quot;služby&quot;&gt;');
  });

  it('truncates a long document number with a warning', () => {
    const d = doc({ documentNumber: 'A'.repeat(40), variableSymbol: null });
    const { xml, warnings } = build([d]);
    expect(xml).toContain(`<inv:originalDocument>${'A'.repeat(32)}</inv:originalDocument>`);
    expect(warnings).toEqual([{ code: 'truncated', documentId: d.id, detail: 'documentNumber' }]);
  });

  it('omits symVar when neither source fits in 10 digits', () => {
    const { xml } = build([doc({ variableSymbol: '12345678901', documentNumber: 'ABC' })]);
    expect(xml).not.toContain('symVar');
  });
});
