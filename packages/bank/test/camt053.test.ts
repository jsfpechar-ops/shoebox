import { describe, expect, it } from 'vitest';
import { parseCamt053 } from '../src/parsers/camt053';

const bal = (cd: string, amt: string) =>
  `<Bal><Tp><CdOrPrtry><Cd>${cd}</Cd></CdOrPrtry></Tp><Amt Ccy="CZK">${amt}</Amt><CdtDbtInd>CRDT</CdtDbtInd></Bal>`;

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
 <BkToCstmrStmt>
  <GrpHdr><MsgId>M1</MsgId></GrpHdr>
  <Stmt>
   <Id>7</Id>
   <FrToDt><FrDtTm>2026-09-15T00:00:00</FrDtTm><ToDtTm>2026-09-30T23:59:59</ToDtTm></FrToDt>
   <Acct><Id><IBAN>CZ8720100000002400123455</IBAN></Id><Ccy>CZK</Ccy></Acct>
   ${bal('OPBD', '10000.00')}
   ${bal('CLBD', '21289.50')}
   <Ntry>
    <NtryRef>A1</NtryRef><Amt Ccy="CZK">12100.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts>
    <BookgDt><Dt>2026-09-15</Dt></BookgDt><ValDt><Dt>2026-09-15</Dt></ValDt>
    <AcctSvcrRef>12345678</AcctSvcrRef>
    <NtryDtls><TxDtls>
     <Refs><EndToEndId>2026001</EndToEndId></Refs>
     <RltdPties><Dbtr><Pty><Nm>ODBERATEL SRO</Nm></Pty></Dbtr><DbtrAcct><Id><IBAN>CZ4608000010031234567899</IBAN></Id></DbtrAcct></RltdPties>
     <RmtInf><Ustrd>/VS/2026001/KS/0308</Ustrd></RmtInf>
    </TxDtls></NtryDtls>
   </Ntry>
   <Ntry>
    <Amt Ccy="CZK">1210.50</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts>
    <BookgDt><DtTm>2026-09-16T10:00:00</DtTm></BookgDt>
    <AcctSvcrRef>12345679</AcctSvcrRef>
    <BkTxCd><Domn><Cd>PMNT</Cd><Fmly><Cd>MCRD</Cd><SubFmlyCd>POSD</SubFmlyCd></Fmly></Domn></BkTxCd>
    <NtryDtls><TxDtls>
     <AmtDtls><InstdAmt><Amt Ccy="EUR">48.00</Amt></InstdAmt></AmtDtls>
     <RmtInf><Ustrd>NAKUP: KAVARNA PRAHA *1234</Ustrd></RmtInf>
    </TxDtls></NtryDtls>
   </Ntry>
   <Ntry>
    <Amt Ccy="CZK">100.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><RvslInd>true</RvslInd><Sts><Cd>BOOK</Cd></Sts>
    <BookgDt><Dt>2026-09-17</Dt></BookgDt><AcctSvcrRef>12345680</AcctSvcrRef>
   </Ntry>
   <Ntry>
    <Amt Ccy="CZK">50.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts><Cd>PDNG</Cd></Sts>
    <BookgDt><Dt>2026-09-18</Dt></BookgDt>
   </Ntry>
   <Ntry>
    <Amt Ccy="CZK">300.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts>
    <BookgDt><Dt>2026-09-19</Dt></BookgDt><AcctSvcrRef>B1</AcctSvcrRef>
    <NtryDtls>
     <TxDtls><Refs><TxId>T1</TxId></Refs><Amt Ccy="CZK">100.00</Amt></TxDtls>
     <TxDtls><Refs><TxId>T2</TxId></Refs><Amt Ccy="CZK">200.00</Amt></TxDtls>
    </NtryDtls>
   </Ntry>
  </Stmt>
 </BkToCstmrStmt>
</Document>`;

describe('parseCamt053', () => {
  const s = parseCamt053(XML);

  it('reads the statement header and balances', () => {
    expect(s.warnings).toEqual([]);
    expect(s.format).toBe('camt053');
    expect(s.statementNumber).toBe('7');
    expect(s.periodFrom).toBe('2026-09-15');
    expect(s.periodTo).toBe('2026-09-30');
    expect(s.account).toEqual({
      account: '2400123455',
      bankCode: '2010',
      iban: 'CZ8720100000002400123455',
      currency: 'CZK',
    });
    expect(s.openingBalance?.toString()).toBe('10000');
    expect(s.closingBalance?.toString()).toBe('21289.5');
    expect(s.balanceCheck).toBe('ok');
  });

  it('skips the pending entry and splits the batch entry', () => {
    expect(s.txs.map((t) => t.amount.toString())).toEqual(['12100', '-1210.5', '100', '100', '200']);
    expect(s.txs.map((t) => t.externalId)).toEqual([
      'camt:12345678',
      'camt:12345679',
      'camt:12345680',
      'camt:T1',
      'camt:T2',
    ]);
  });

  it('reads counterparty and symbols of an incoming payment', () => {
    const inc = s.txs[0];
    expect(inc?.bookedOn).toBe('2026-09-15');
    expect(inc?.valueDate).toBe('2026-09-15');
    expect(inc?.vs).toBe('2026001');
    expect(inc?.ks).toBe('308');
    expect(inc?.message).toBe('/VS/2026001/KS/0308');
    expect(inc?.counterparty).toEqual({
      account: '1003-1234567899',
      bankCode: '0800',
      iban: 'CZ4608000010031234567899',
      name: 'ODBERATEL SRO',
    });
  });

  it('reads a card payment with its original currency', () => {
    const card = s.txs[1];
    expect(card?.bookedOn).toBe('2026-09-16');
    expect(card?.cardMerchant).toBe('NAKUP: KAVARNA PRAHA *1234');
    expect(card?.cardLast4).toBe('1234');
    expect(card?.amountOriginal?.toString()).toBe('-48');
    expect(card?.amountOriginal?.currency).toBe('EUR');
  });

  it('marks a reversal', () => {
    expect(s.txs[2]?.isReversal).toBe(true);
  });

  it('flags a balance mismatch', () => {
    expect(parseCamt053(XML.replace('21289.50', '21289.51')).balanceCheck).toBe('mismatch');
  });

  it('refuses a DOCTYPE and broken XML with a warning', () => {
    const evil = '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><Document/>';
    expect(parseCamt053(evil).warnings.map((w) => w.code)).toEqual(['camt.bad_xml']);
    expect(parseCamt053('<Document>').txs).toEqual([]);
  });
});
