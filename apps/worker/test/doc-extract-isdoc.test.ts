import type { DocumentForRead, ReadingWrite, TenantTx } from '@shoebox/db';
import { fixedClock } from '@shoebox/domain';
import type { LlmClient, LlmRequest } from '@shoebox/extraction';
import { describe, expect, it } from 'vitest';
import { createDocExtractHandler, type ReadingStore } from '../src/doc-extract/handler';

// Synthetic data only: IČO 12345679 is a made-up number with a valid check digit.
const ORG = '11111111-1111-4111-8111-111111111111';
const DOC = '22222222-2222-4222-8222-222222222222';

const ISDOC = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="http://isdoc.cz/namespace/2013" version="6.0.2">
  <DocumentType>1</DocumentType>
  <ID>FV-2026-0042</ID>
  <IssueDate>2026-09-12</IssueDate>
  <TaxPointDate>2026-09-12</TaxPointDate>
  <VATApplicable>true</VATApplicable>
  <LocalCurrencyCode>CZK</LocalCurrencyCode>
  <AccountingSupplierParty><Party>
    <PartyIdentification><ID>12345679</ID></PartyIdentification>
    <PartyName><Name>Example Supplier s.r.o.</Name></PartyName>
    <PostalAddress><Country><IdentificationCode>CZ</IdentificationCode></Country></PostalAddress>
    <PartyTaxScheme><CompanyID>CZ12345679</CompanyID><TaxScheme>VAT</TaxScheme></PartyTaxScheme>
  </Party></AccountingSupplierParty>
  <TaxTotal>
    <TaxSubTotal><TaxableAmount>100.00</TaxableAmount><TaxAmount>21.00</TaxAmount><TaxCategory><Percent>21</Percent></TaxCategory></TaxSubTotal>
    <TaxAmount>21.00</TaxAmount>
  </TaxTotal>
  <LegalMonetaryTotal><TaxExclusiveAmount>100.00</TaxExclusiveAmount><TaxInclusiveAmount>121.00</TaxInclusiveAmount><PayableAmount>121.00</PayableAmount></LegalMonetaryTotal>
  <PaymentMeans><Payment><PaymentMeansCode>42</PaymentMeansCode>
    <Details><PaymentDueDate>2026-09-26</PaymentDueDate><ID>123</ID><BankCode>0100</BankCode><VariableSymbol>20260042</VariableSymbol></Details>
  </Payment></PaymentMeans>
</Invoice>`;

const enc = (s: string) => new TextEncoder().encode(s);

/** A tiny PDF whose only stream is an uncompressed embedded ISDOC (or a page content stream). */
function pdfWith(embedded: string | null): Uint8Array {
  const body = embedded ?? 'BT (Faktura) Tj ET';
  const type = embedded === null ? '' : '/Type /EmbeddedFile ';
  return enc(
    `%PDF-1.7\n5 0 obj\n<< ${type}/Length ${enc(body).length} >>\nstream\n${body}\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`,
  );
}

function fakeStore(doc: Partial<DocumentForRead>) {
  const saved: ReadingWrite[] = [];
  const failures: Array<{ error: string; final: boolean }> = [];
  const store: ReadingStore = {
    load: async () => ({
      id: DOC,
      orgId: ORG,
      status: 'received',
      revision: 1,
      storagePath: `org/${ORG}/files/x`,
      mimeType: 'application/pdf',
      orgIco: null,
      orgDic: null,
      ...doc,
    }),
    setStatus: async () => {},
    save: async (_tx, write) => {
      saved.push(write);
      return 'run-1';
    },
    fail: async (_tx, f) => {
      failures.push({ error: f.error, final: f.final });
    },
  };
  return { store, saved, failures };
}

/** A model that must not be called for ISDOC files; when it is, it answers with an empty object. */
function spyLlm(): LlmClient & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    requests,
    async complete(request) {
      requests.push(request);
      return {
        model: 'claude-haiku-5-5',
        stopReason: 'end_turn',
        text: '{}',
        json: {},
        latencyMs: 1,
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      };
    },
  };
}

const clock = fixedClock('2026-10-25T10:00:00Z');
const ctx = {
  tx: {} as TenantTx,
  attempt: 1,
  jobId: 'job-1',
  signal: new AbortController().signal,
};

async function run(mimeType: string, bytes: Uint8Array) {
  const { store, saved, failures } = fakeStore({ mimeType });
  const llm = spyLlm();
  await createDocExtractHandler({
    llm,
    blobs: { get: async () => bytes },
    model: 'm',
    clock,
    store,
  })({ orgId: ORG, documentId: DOC }, ctx);
  return { saved, failures, llm };
}

describe('doc.extract with ISDOC data', () => {
  it('reads a PDF with an embedded ISDOC exactly, without calling the model', async () => {
    const { saved, llm } = await run('application/pdf', pdfWith(ISDOC));
    expect(llm.requests).toEqual([]);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      status: 'ready',
      patch: { class: 'received_invoice', documentNumber: 'FV-2026-0042', totalGross: '121.00' },
      run: {
        method: 'isdoc',
        model: null,
        promptVersion: 'isdoc-6-v1',
        inputTokens: 0,
        outputTokens: 0,
      },
    });
    expect(saved[0]?.fields.length).toBeGreaterThan(0);
    expect(saved[0]?.fields.every((f) => f.source === 'isdoc')).toBe(true);
  });

  it('reads a plain .isdoc upload (stored as application/xml) without the model', async () => {
    const { saved, llm } = await run('application/xml', enc(ISDOC));
    expect(llm.requests).toEqual([]);
    expect(saved[0]?.run.method).toBe('isdoc');
  });

  it('still asks the model for a PDF without ISDOC', async () => {
    const { llm } = await run('application/pdf', pdfWith(null));
    expect(llm.requests).toHaveLength(1);
  });

  it('fails an XML file without readable ISDOC at once, without the model', async () => {
    const { saved, failures, llm } = await run(
      'application/xml',
      enc('<Invoice xmlns="urn:other"/>'),
    );
    expect(llm.requests).toEqual([]);
    expect(saved).toEqual([]);
    expect(failures).toEqual([{ error: 'isdoc_unreadable', final: true }]);
  });

  it('falls back to the model when a PDF carries a broken ISDOC', async () => {
    const { llm } = await run('application/pdf', pdfWith(ISDOC.replace('</Invoice>', '')));
    expect(llm.requests).toHaveLength(1);
  });
});
