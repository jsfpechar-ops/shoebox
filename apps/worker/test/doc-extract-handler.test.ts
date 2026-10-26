import type { DocumentForRead, ReadingWrite, TenantTx } from '@shoebox/db';
import { fixedClock } from '@shoebox/domain';
import { AnthropicHttpError, type LlmClient, type LlmRequest } from '@shoebox/extraction';
import { describe, expect, it } from 'vitest';
import { createDocExtractHandler, type ReadingStore } from '../src/doc-extract/handler';
import type { RegistryDeps } from '../src/doc-extract/registry-checks';

const ORG = '11111111-1111-4111-8111-111111111111';
const DOC = '22222222-2222-4222-8222-222222222222';
const offline: RegistryDeps = {
  crpdph: { status: async () => ({ status: 'unavailable', reason: 'timeout' }) },
  vies: { check: async () => ({ status: 'unavailable', reason: 'vies_unavailable' }) },
};

function wire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind_hint: 'tax_invoice',
    supplier: {
      name: 'Synthetic s.r.o.',
      ico: '27082440',
      dic: 'CZ27082440',
      vat_id: '',
      country: 'CZ',
    },
    buyer: { name: '', ico: '', dic: '' },
    document: { number: 'SYN-1', variable_symbol: '1' },
    dates: { issue_date: '2026-09-12', duzp: '2026-09-12', due_date: '2026-09-26' },
    currency: 'CZK',
    vat_recap: [{ rate_pct: '21', base: '100.00', vat: '21.00' }],
    totals: { net: '100.00', vat: '21.00', gross: '121.00' },
    payment: { account_number: '123', bank_code: '0100', iban: '', method: 'bank_transfer' },
    flags: {
      not_tax_document_text: false,
      non_vat_payer_text: false,
      reverse_charge_text: false,
      paid_text: false,
    },
    ...overrides,
  };
}

function fakeStore(doc: Partial<DocumentForRead> | null = {}) {
  const calls: string[] = [];
  const saved: ReadingWrite[] = [];
  const failures: Array<{ error: string; final: boolean }> = [];
  const store: ReadingStore = {
    load: async () =>
      doc === null
        ? null
        : {
            id: DOC,
            orgId: ORG,
            status: 'received',
            storagePath: `org/${ORG}/files/x`,
            mimeType: 'application/pdf',
            orgIco: null,
            orgDic: null,
            ...doc,
          },
    setStatus: async (_tx, _id, status) => {
      calls.push(`status:${status}`);
    },
    save: async (_tx, write) => {
      saved.push(write);
      return 'run-1';
    },
    fail: async (_tx, f) => {
      failures.push({ error: f.error, final: f.final });
    },
  };
  return { store, calls, saved, failures };
}

function llmReturning(json: unknown | Error): LlmClient & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    requests,
    async complete(request) {
      requests.push(request);
      if (json instanceof Error) throw json;
      return {
        model: 'claude-haiku-5-5',
        stopReason: 'end_turn',
        text: JSON.stringify(json),
        json,
        latencyMs: 900,
        usage: {
          inputTokens: 1500,
          outputTokens: 300,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      };
    },
  };
}

const blobs = { get: async () => new Uint8Array([37, 80, 68, 70]) };
const clock = fixedClock('2026-10-25T10:00:00Z');
const tx = {} as TenantTx;
const ctx = (attempt = 1) => ({
  tx,
  attempt,
  jobId: 'job-1',
  signal: new AbortController().signal,
});

describe('doc.extract handler', () => {
  it('reads, checks and saves a clean invoice as ready', async () => {
    const { store, calls, saved } = fakeStore();
    const llm = llmReturning(wire());
    await createDocExtractHandler({
      registries: offline,
      llm,
      blobs,
      model: 'claude-haiku-5-5',
      clock,
      store,
    })({ orgId: ORG, documentId: DOC }, ctx());
    expect(calls).toEqual(['status:extracting']);
    expect(llm.requests[0]?.model).toBe('claude-haiku-5-5');
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      orgId: ORG,
      documentId: DOC,
      status: 'ready',
      patch: {
        class: 'received_invoice',
        totalGross: '121.00',
        partnerSnapshot: { ico: '27082440' },
      },
      vatSummary: [{ vatRateType: 'standard', vatRatePct: '21', base: '100', vat: '21' }],
      run: {
        model: 'claude-haiku-5-5',
        promptVersion: 'm02-proto-v3',
        attempt: 1,
        inputTokens: 1500,
        outputTokens: 300,
        latencyMs: 900,
      },
    });
  });

  it('sends a document with wrong VAT math to review', async () => {
    const { store, saved } = fakeStore();
    const llm = llmReturning(
      wire({
        vat_recap: [{ rate_pct: '21', base: '100.00', vat: '30.00' }],
        totals: { net: '100.00', vat: '30.00', gross: '130.00' },
      }),
    );
    await createDocExtractHandler({ registries: offline, llm, blobs, model: 'm', clock, store })(
      { orgId: ORG, documentId: DOC },
      ctx(),
    );
    expect(saved[0]?.status).toBe('needs_review');
    expect(saved[0]?.validations.some((v) => v.severity === 'blocking')).toBe(true);
  });

  it('skips a document that was already read', async () => {
    const { store, calls, saved } = fakeStore({ status: 'ready' });
    const llm = llmReturning(wire());
    await createDocExtractHandler({ registries: offline, llm, blobs, model: 'm', clock, store })(
      { orgId: ORG, documentId: DOC },
      ctx(),
    );
    expect(calls).toEqual([]);
    expect(saved).toEqual([]);
    expect(llm.requests).toEqual([]);
  });

  it('does nothing for a missing document', async () => {
    const { store, saved } = fakeStore(null);
    await createDocExtractHandler({
      registries: offline,
      llm: llmReturning(wire()),
      blobs,
      model: 'm',
      clock,
      store,
    })({ orgId: ORG, documentId: DOC }, ctx());
    expect(saved).toEqual([]);
  });

  it('re-throws a model error before the last attempt, records it on the last', async () => {
    const error = new AnthropicHttpError(529, '');
    const first = fakeStore();
    await expect(
      createDocExtractHandler({
        registries: offline,
        llm: llmReturning(error),
        blobs,
        model: 'm',
        clock,
        store: first.store,
      })({ orgId: ORG, documentId: DOC }, ctx(1)),
    ).rejects.toBe(error);
    expect(first.failures).toEqual([]);
    const last = fakeStore();
    await createDocExtractHandler({
      registries: offline,
      llm: llmReturning(error),
      blobs,
      model: 'm',
      clock,
      store: last.store,
    })({ orgId: ORG, documentId: DOC }, ctx(99));
    expect(last.failures).toEqual([{ error: 'http_529', final: true }]);
  });

  it('fails an unsupported file type at once', async () => {
    const { store, failures } = fakeStore({ mimeType: 'text/plain' });
    const llm = llmReturning(wire());
    await createDocExtractHandler({ registries: offline, llm, blobs, model: 'm', clock, store })(
      { orgId: ORG, documentId: DOC },
      ctx(),
    );
    expect(failures).toEqual([{ error: 'unsupported_type', final: true }]);
    expect(llm.requests).toEqual([]);
  });

  it('reads a sorted document from its chosen pages in one call', async () => {
    const { store, saved } = fakeStore({ mimeType: 'image/jpeg' });
    const llm = llmReturning(wire());
    const sorted: ReadingStore = {
      ...store,
      loadPages: async () => [
        {
          position: 1,
          sourceFileId: 'f1',
          storagePath: 'a',
          mimeType: 'image/jpeg',
          filePage: 1,
          region: '',
        },
        {
          position: 2,
          sourceFileId: 'f2',
          storagePath: 'b',
          mimeType: 'image/png',
          filePage: 1,
          region: '',
        },
      ],
    };
    await createDocExtractHandler({ llm, blobs, model: 'claude-haiku-5-5', clock, store: sorted })(
      { orgId: ORG, documentId: DOC },
      ctx(),
    );
    const content = llm.requests[0]?.messages[0]?.content ?? [];
    expect(content.map((b) => b.type)).toEqual(['image', 'image', 'text', 'text']);
    expect(saved).toHaveLength(1);
  });

  it('checks the total against the payment QR amount and stores it as a field', async () => {
    const { store, saved } = fakeStore();
    await createDocExtractHandler({
      registries: offline,
      llm: llmReturning(wire()),
      blobs,
      model: 'm',
      clock,
      store,
      scan: async () => ({ text: null, textGood: false, qrTexts: ['SPD*1.0*AM:999.00'] }),
    })({ orgId: ORG, documentId: DOC }, ctx());
    expect(saved[0]?.status).toBe('needs_review');
    expect(saved[0]?.validations).toContainEqual(
      expect.objectContaining({ ruleId: 'PROTO_QR_AMOUNT', severity: 'blocking' }),
    );
    expect(saved[0]?.fields).toContainEqual({
      fieldKey: 'qr.amount',
      valueText: '999.00',
      source: 'qr',
    });
  });

  it('saves the reading as before when the scan throws', async () => {
    const { store, saved } = fakeStore();
    await createDocExtractHandler({
      registries: offline,
      llm: llmReturning(wire()),
      blobs,
      model: 'm',
      clock,
      store,
      scan: async () => {
        throw new Error('scan failed');
      },
    })({ orgId: ORG, documentId: DOC }, ctx());
    expect(saved[0]?.status).toBe('ready');
  });

  it('repairs a misread supplier IČO to the one saved supplier one digit away', async () => {
    const { store, saved } = fakeStore();
    const memory: ReadingStore = { ...store, knownSupplierIcos: async () => ['25596641'] };
    await createDocExtractHandler({
      registries: offline,
      llm: llmReturning(
        wire({
          supplier: {
            name: 'Synthetic s.r.o.',
            ico: '25596614',
            dic: 'CZ25596614',
            vat_id: '',
            country: 'CZ',
          },
        }),
      ),
      blobs,
      model: 'm',
      clock,
      store: memory,
    })({ orgId: ORG, documentId: DOC }, ctx());
    expect(saved[0]?.fields).toContainEqual(
      expect.objectContaining({
        fieldKey: 'supplier.ico',
        valueText: '25596641',
        source: 'vendor_memory',
      }),
    );
    expect(saved[0]?.validations).toContainEqual(
      expect.objectContaining({ ruleId: 'PROTO_ICO_REPAIRED', severity: 'warning' }),
    );
    expect(saved[0]?.validations.some((v) => v.ruleId === 'PROTO_ICO_CHECKSUM')).toBe(false);
  });

  it('keeps a bad supplier IČO when no saved supplier is one digit away', async () => {
    const { store, saved } = fakeStore();
    const memory: ReadingStore = { ...store, knownSupplierIcos: async () => [] };
    await createDocExtractHandler({
      registries: offline,
      llm: llmReturning(
        wire({
          supplier: {
            name: 'Synthetic s.r.o.',
            ico: '25596614',
            dic: 'CZ25596614',
            vat_id: '',
            country: 'CZ',
          },
        }),
      ),
      blobs,
      model: 'm',
      clock,
      store: memory,
    })({ orgId: ORG, documentId: DOC }, ctx());
    expect(saved[0]?.fields).toContainEqual(
      expect.objectContaining({ fieldKey: 'supplier.ico', valueText: '25596614' }),
    );
    expect(saved[0]?.validations).toContainEqual(
      expect.objectContaining({ ruleId: 'PROTO_ICO_CHECKSUM', severity: 'blocking' }),
    );
  });

  it('remembers a valid supplier IČO after saving the reading', async () => {
    const { store, saved } = fakeStore();
    const remembered: Array<{ ico: string; orgId: string }> = [];
    const memory: ReadingStore = {
      ...store,
      rememberSupplier: async (_tx, s) => {
        remembered.push(s);
        return 'partner-1';
      },
    };
    // Savepoint stub: runs the callback on the same fake transaction.
    const savepointTx = {
      transaction: async (fn: (sp: unknown) => unknown) => fn(savepointTx),
    } as unknown as TenantTx;
    await createDocExtractHandler({
      registries: offline,
      llm: llmReturning(wire()),
      blobs,
      model: 'm',
      clock,
      store: memory,
    })({ orgId: ORG, documentId: DOC }, { ...ctx(), tx: savepointTx });
    expect(saved).toHaveLength(1);
    expect(remembered).toHaveLength(1);
    expect(remembered[0]).toMatchObject({ ico: '27082440', orgId: ORG });
  });

  it('fails a parse error at once, without a retry', async () => {
    const failed = fakeStore();
    await createDocExtractHandler({
      registries: offline,
      llm: llmReturning(null),
      blobs,
      model: 'm',
      clock,
      store: failed.store,
    })({ orgId: ORG, documentId: DOC }, ctx(1));
    expect(failed.failures).toEqual([{ error: 'parse', final: true }]);
  });

  it('fails a 400 at once', async () => {
    const failed = fakeStore();
    await createDocExtractHandler({
      registries: offline,
      llm: llmReturning(new AnthropicHttpError(400, '')),
      blobs,
      model: 'm',
      clock,
      store: failed.store,
    })({ orgId: ORG, documentId: DOC }, ctx(1));
    expect(failed.failures).toEqual([{ error: 'http_400', final: true }]);
  });

  it('still retries a 529 on attempt 1 and records it on attempt 3', async () => {
    const error = new AnthropicHttpError(529, '');
    const first = fakeStore();
    await expect(
      createDocExtractHandler({
        registries: offline,
        llm: llmReturning(error),
        blobs,
        model: 'm',
        clock,
        store: first.store,
      })({ orgId: ORG, documentId: DOC }, ctx(1)),
    ).rejects.toBe(error);
    expect(first.failures).toEqual([]);
    const last = fakeStore();
    await createDocExtractHandler({
      registries: offline,
      llm: llmReturning(error),
      blobs,
      model: 'm',
      clock,
      store: last.store,
    })({ orgId: ORG, documentId: DOC }, ctx(3));
    expect(last.failures).toEqual([{ error: 'http_529', final: true }]);
  });

  it('fails a cut-off answer at once', async () => {
    const cutOff: LlmClient = {
      async complete() {
        return {
          model: 'claude-haiku-5-5',
          stopReason: 'max_tokens',
          text: '',
          json: null,
          latencyMs: 900,
          usage: {
            inputTokens: 1500,
            outputTokens: 8000,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
          },
        };
      },
    };
    const failed = fakeStore();
    await createDocExtractHandler({
      registries: offline,
      llm: cutOff,
      blobs,
      model: 'm',
      clock,
      store: failed.store,
    })({ orgId: ORG, documentId: DOC }, ctx(1));
    expect(failed.failures).toEqual([{ error: 'max_tokens', final: true }]);
    expect(failed.saved).toEqual([]);
  });

  it('skips a bank statement without a model call', async () => {
    const { store, saved } = fakeStore();
    const llm = llmReturning(wire());
    await createDocExtractHandler({
      registries: offline,
      llm,
      blobs,
      model: 'm',
      clock,
      store,
      scan: async () => ({
        text: 'VÝPIS Z ÚČTU 1. 9. 2026 - 30. 9. 2026 12345678901',
        textGood: true,
        qrTexts: [],
      }),
      countPages: async () => 2,
    })({ orgId: ORG, documentId: DOC }, ctx());
    expect(llm.requests).toEqual([]);
    expect(saved[0]).toMatchObject({
      status: 'supporting',
      patch: { class: 'bank_statement', classSource: 'rule' },
      run: { method: 'rule', inputTokens: 0 },
      validations: [
        { ruleId: 'PRECHECK_SKIPPED', params: { messageKey: 'precheck.bank_statement' } },
      ],
    });
  });

  it('skips a 21-page PDF without a model call', async () => {
    const { store, saved } = fakeStore();
    const llm = llmReturning(wire());
    await createDocExtractHandler({
      registries: offline,
      llm,
      blobs,
      model: 'm',
      clock,
      store,
      countPages: async () => 21,
    })({ orgId: ORG, documentId: DOC }, ctx());
    expect(llm.requests).toEqual([]);
    expect(saved[0]?.status).toBe('needs_review');
    expect(saved[0]?.validations[0]?.params).toMatchObject({
      messageKey: 'precheck.too_many_pages',
    });
  });

  it('still reads an invoice', async () => {
    const { store, saved } = fakeStore();
    const llm = llmReturning(wire());
    await createDocExtractHandler({
      registries: offline,
      llm,
      blobs,
      model: 'm',
      clock,
      store,
      scan: async () => ({
        text: 'FAKTURA - DAŇOVÝ DOKLAD 2026001 12345678901',
        textGood: true,
        qrTexts: [],
      }),
      countPages: async () => 1,
    })({ orgId: ORG, documentId: DOC }, ctx());
    expect(llm.requests).toHaveLength(1);
    expect(saved[0]?.run.method).not.toBe('rule');
  });
});
