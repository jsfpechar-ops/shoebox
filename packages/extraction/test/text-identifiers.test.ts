import { describe, expect, it } from 'vitest';
import { findIdentifiers, foldText } from '../src/index';

// Synthetic values only (hard rule 4). 25596641 and 00006947 are valid IČOs.
const ORG = { ico: '00006947', dic: 'CZ00006947' };

const INVOICE = [
  'Faktura - daňový doklad č. 2026001',
  'Dodavatel: Testovací s.r.o., IČ: 255 96 641, DIČ: CZ25596641',
  'Odběratel: Já OSVČ, IČO 00006947 DIČ CZ00006947',
  'Bankovní spojení: 19-2000145399/0800  IBAN: CZ65 0800 0000 1920 0014 5399',
  'Variabilní symbol: 2026001',
].join('\n');

describe('foldText', () => {
  it('strips diacritics and lowercases', () => {
    expect(foldText('DIČ Číslo účtu')).toBe('dic cislo uctu');
  });
});

describe('findIdentifiers', () => {
  it('finds every identifier and picks the supplier', () => {
    expect(findIdentifiers(INVOICE, ORG)).toEqual({
      icos: ['25596641', '00006947'],
      dics: ['CZ25596641', 'CZ00006947'],
      ibans: ['CZ6508000000192000145399'],
      accounts: [{ prefix: '19', number: '2000145399', bankCode: '0800' }],
      variableSymbols: ['2026001'],
      supplierIco: '25596641',
      supplierDic: 'CZ25596641',
    });
  });

  it('works without háčky (Competitor-style PDFs lose them)', () => {
    const r = findIdentifiers('IC: 25596641 DIC: CZ25596641', ORG);
    expect(r.supplierIco).toBe('25596641');
    expect(r.supplierDic).toBe('CZ25596641');
  });

  it('drops checksum-invalid values and booking numbers', () => {
    const r = findIdentifiers('IČ: 25596642\nČíslo objednávky IČO 25596641\nDIČ: CZ25596642', ORG);
    expect(r.icos).toEqual([]);
    expect(r.dics).toEqual([]);
    expect(r.supplierIco).toBeNull();
  });

  it('keeps a foreign VAT ID and refuses "CZSL000D"-like junk', () => {
    const r = findIdentifiers('VAT ID: IE 6388047V\nDIČ: CZSL000D', ORG);
    expect(r.dics).toEqual(['IE6388047V']);
    expect(r.supplierDic).toBe('IE6388047V');
  });

  it('has no supplier winner when two other IČOs appear', () => {
    const r = findIdentifiers('IČ: 25596641\nIČ: 27074358', ORG);
    expect(r.icos).toEqual(['25596641', '27074358']);
    expect(r.supplierIco).toBeNull();
  });

  it('ignores dates and invalid accounts', () => {
    const r = findIdentifiers('Datum 12/2026, účet 19-2000145398/0800', ORG);
    expect(r.accounts).toEqual([]);
  });
});
