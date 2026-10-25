import { parseProtoExtraction } from '@shoebox/extraction';
import { describe, expect, it } from 'vitest';
import {
  buildProtoReport,
  classGroupOf,
  fieldVerdict,
  flattenProtoExtraction,
  PROTO_VERDICT_RULES_VERSION,
  type ProtoFieldKey,
  type ProtoLabelRecord,
  type ProtoResultRecord,
  type ProtoRunRecord,
  parseProtoResults,
  renderProtoReport,
} from '../src/index';

// Invented values only (hard rule 4).
const KEYS: ProtoFieldKey[] = [
  'class',
  'supplier_name',
  'supplier_ico',
  'supplier_dic',
  'document_number',
  'variable_symbol',
  'issue_date',
  'duzp',
  'due_date',
  'currency',
  'total_gross',
  'vat_lines',
  'not_tax_document',
];
const SHA = (n: number): string => n.toString(16).padStart(64, '0');
const UUID = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function values(cls: string, over: Partial<Record<ProtoFieldKey, string | null>> = {}) {
  return KEYS.map((key) => ({
    key,
    value: key === 'class' ? cls : key in over ? (over[key] ?? null) : '',
  }));
}

function run(n: number, doc: number, over: Partial<ProtoRunRecord> = {}): ProtoRunRecord {
  return {
    schema: 'proto-results-v2',
    kind: 'run',
    run_id: UUID(n),
    doc_id: SHA(doc),
    batch_id: UUID(900),
    file_name: `doc${doc}.pdf`,
    media_type: 'application/pdf',
    size_bytes: 1000,
    channel: 'upload',
    page_count: null,
    has_text_layer: null,
    provider: 'anthropic',
    model_requested: 'claude-haiku-5-5',
    model: 'claude-haiku-5-5',
    prompt_version: 'm02-proto-v2',
    schema_version: 'm02-proto-v2',
    effort: null,
    input_mode: 'pdf',
    attempt: 1,
    ok: true,
    error: null,
    stop_reason: 'end_turn',
    input_tokens: 1000,
    output_tokens: 100,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    cost_usd: '0.0030',
    latency_ms: 1000,
    extracted_at: `2026-10-19T10:00:0${n % 10}.000Z`,
    parse_issues: [],
    checks: [],
    fields: values('received_invoice'),
    raw_response: null,
    ...over,
  };
}

function label(
  n: number,
  doc: number,
  cls: string,
  over: Partial<Record<ProtoFieldKey, string>> = {},
  extra: Partial<ProtoLabelRecord> = {},
): ProtoLabelRecord {
  return {
    schema: 'proto-results-v2',
    kind: 'label',
    label_id: UUID(100 + n),
    doc_id: SHA(doc),
    rev: 1,
    supersedes: null,
    basis_run_id: null,
    labeled_by: 'owner',
    labeled_at: '2026-10-19T11:00:00.000Z',
    fields: values(cls, over).map((field) => ({ key: field.key, value: field.value ?? '' })),
    note: '',
    ...extra,
  };
}

describe('fieldVerdict', () => {
  it('tells correct, missing and hallucinated apart; null counts as empty', () => {
    expect(fieldVerdict('supplier_ico', '', '')).toBe('correct');
    expect(fieldVerdict('supplier_ico', '', null)).toBe('correct');
    expect(fieldVerdict('supplier_ico', '', '12345678')).toBe('hallucinated');
    expect(fieldVerdict('supplier_ico', '12345678', null)).toBe('missing');
    expect(fieldVerdict('supplier_ico', '12345678', '12345678')).toBe('correct');
    expect(fieldVerdict('supplier_ico', '12345678', '12345679')).toBe('wrong');
    expect(fieldVerdict('issue_date', '2026-09-01', '2026-09-02')).toBe('wrong');
  });

  it('calls a same-value, different-spelling answer format', () => {
    expect(fieldVerdict('supplier_ico', '123 456 78', '12345678')).toBe('format');
    expect(fieldVerdict('supplier_name', 'Alza.cz a.s.', 'ALZA.CZ')).toBe('format');
    expect(fieldVerdict('total_gross', '1 210,00', '1210.00')).toBe('format');
    expect(fieldVerdict('total_gross', '1210.00', '1210.50')).toBe('wrong');
    expect(
      fieldVerdict(
        'vat_lines',
        '21:1000:210 12.00:100.00:12.00',
        '12.00:100.00:12.00 21.00:1000.00:210.00',
      ),
    ).toBe('format');
    expect(fieldVerdict('not_tax_document', 'ano', 'true')).toBe('format');
    expect(fieldVerdict('not_tax_document', 'false', 'true')).toBe('wrong');
  });
});

describe('classGroupOf', () => {
  it('folds 04 classes into invoice / receipt / spam / other', () => {
    expect(classGroupOf('received_invoice')).toBe('invoice');
    expect(classGroupOf('received_credit_note')).toBe('invoice');
    expect(classGroupOf('received_proforma')).toBe('invoice');
    expect(classGroupOf('received_receipt')).toBe('receipt');
    expect(classGroupOf('non_document')).toBe('spam');
    expect(classGroupOf('unknown')).toBe('other');
    expect(classGroupOf('order_confirmation')).toBe('other');
  });
});

describe('flattenProtoExtraction', () => {
  it('returns one observation per key in scorer formats, keeping null for "not printed"', () => {
    const extraction = parseProtoExtraction({
      kind_hint: 'tax_invoice',
      supplier: { name: 'Firma s.r.o.', ico: '12345678', dic: '', vat_id: 'DE123', country: 'DE' },
      document: { number: 'F1', variable_symbol: '' },
      dates: { issue_date: '2026-09-12', duzp: '', due_date: '2026-09-26' },
      currency: 'CZK',
      vat_recap: [{ rate_pct: '21.0', base: '100', vat: '21' }],
      totals: { net: '100', vat: '21', gross: '121' },
      payment: { account_number: '', bank_code: '', iban: '' },
      flags: {
        not_tax_document_text: false,
        non_vat_payer_text: false,
        reverse_charge_text: false,
      },
    });
    expect(flattenProtoExtraction(extraction)).toEqual([
      { key: 'class', value: 'received_invoice' },
      { key: 'supplier_name', value: 'Firma s.r.o.' },
      { key: 'supplier_ico', value: '12345678' },
      { key: 'supplier_dic', value: 'DE123' },
      { key: 'document_number', value: 'F1' },
      { key: 'variable_symbol', value: null },
      { key: 'issue_date', value: '2026-09-12' },
      { key: 'duzp', value: null },
      { key: 'due_date', value: '2026-09-26' },
      { key: 'currency', value: 'CZK' },
      { key: 'total_gross', value: '121.00' },
      { key: 'vat_lines', value: '21.00:100.00:21.00' },
      { key: 'not_tax_document', value: 'false' },
    ]);
  });
});

describe('parseProtoResults', () => {
  it('reads both kinds, skips blank lines, dedupes by run_id and label_id', () => {
    const lines = [run(1, 1), label(1, 1, 'received_invoice'), run(1, 1), run(2, 2)]
      .map((record) => JSON.stringify(record))
      .join('\n\n');
    const records = parseProtoResults(lines);
    expect(records.map((record) => record.kind)).toEqual(['run', 'label', 'run']);
  });

  it('names the bad line', () => {
    expect(() =>
      parseProtoResults(`${JSON.stringify(run(1, 1))}\n{"schema":"proto-results-v2","kind":"run"}`),
    ).toThrow(/line 2/);
  });
});

describe('buildProtoReport', () => {
  const records: ProtoResultRecord[] = [
    // doc1: an older v1 run (class unknown), then the v2 run: VS missing, DUZP hallucinated, date check fired
    run(5, 1, {
      prompt_version: 'm02-proto-v1',
      fields: values('unknown'),
      extracted_at: '2026-10-18T09:00:00.000Z',
    }),
    run(1, 1, {
      fields: values('received_invoice', {
        supplier_ico: '12345678',
        duzp: '2026-09-01',
        variable_symbol: null,
      }),
      checks: [{ id: 'date', severity: 'fail' }],
    }),
    label(
      1,
      1,
      'received_invoice',
      { supplier_ico: '12345678', variable_symbol: '77' },
      { basis_run_id: UUID(1) },
    ),
    // doc2: receipt read as an invoice, total right in another spelling; label revised once
    run(2, 2, {
      fields: values('received_invoice', { total_gross: '121.00' }),
      cost_usd: '0.0010',
      latency_ms: 2000,
      parse_issues: ['total_vat'],
    }),
    label(2, 2, 'received_invoice', { total_gross: '121' }),
    label(3, 2, 'received_receipt', { total_gross: '121' }, { rev: 2, supersedes: UUID(102) }),
    // doc3: spam caught from a photo; only the class is scored
    run(3, 3, {
      input_mode: 'image',
      media_type: 'image/png',
      stop_reason: 'max_tokens',
      fields: values('non_document', { supplier_ico: '99999999' }),
      checks: [{ id: 'ico_checksum', severity: 'fail' }],
    }),
    label(4, 3, 'non_document'),
    // doc4: one failed attempt, then a good run; not labeled yet
    run(6, 4, {
      ok: false,
      attempt: 2,
      error: 'anthropic: HTTP 529',
      fields: [],
      cost_usd: '0.0000',
      extracted_at: '2026-10-19T09:59:00.000Z',
    }),
    run(4, 4),
  ];
  const report = buildProtoReport(records);

  it('summarizes runs, labels, spend and failures', () => {
    expect(report.verdictRules).toBe(PROTO_VERDICT_RULES_VERSION);
    expect(report.runs).toBe(6);
    expect(report.failedRuns).toBe(1);
    expect(report.retries).toBe(1);
    expect(report.documents).toBe(4);
    expect(report.labeled).toBe(3);
    expect(report.labelRevisions).toBe(4);
    expect(report.models).toEqual(['claude-haiku-5-5']);
    expect(report.promptVersions).toEqual(['m02-proto-v2']);
    expect(report.costUsd).toBe('0.0130');
    expect(report.meanLatencyMs).toBe(1250);
    expect(report.parseIssueRatePct).toBe(25);
    expect(report.notEndTurn).toBe(1);
  });

  it('builds the class confusion matrix from the latest run and the latest label revision', () => {
    expect(report.confusion.invoice.invoice).toBe(1);
    expect(report.confusion.receipt.invoice).toBe(1);
    expect(report.confusion.spam.spam).toBe(1);
    expect(report.confusion.receipt.receipt).toBe(0);
    expect(report.classAccuracyPct).toBe(67);
  });

  it('scores fields of non-spam labeled documents only', () => {
    const field = (key: string) => report.fields.find((row) => row.field === key);
    expect(field('supplier_ico')).toMatchObject({
      scored: 2,
      correct: 2,
      hallucinated: 0,
      accuracyPct: 100,
    });
    expect(field('variable_symbol')).toMatchObject({
      scored: 2,
      correct: 1,
      missing: 1,
      accuracyPct: 50,
    });
    expect(field('duzp')).toMatchObject({ hallucinated: 1 });
    expect(field('total_gross')).toMatchObject({ format: 1, accuracyPct: 100 });
  });

  it('lists errors, worst documents, what the checks caught and accuracy by input mode', () => {
    expect(report.errors).toEqual([
      {
        file_name: 'doc1.pdf',
        field: 'variable_symbol',
        verdict: 'missing',
        labeled: '77',
        predicted: '',
      },
      {
        file_name: 'doc1.pdf',
        field: 'duzp',
        verdict: 'hallucinated',
        labeled: '',
        predicted: '2026-09-01',
      },
      {
        file_name: 'doc2.pdf',
        field: 'class',
        verdict: 'wrong',
        labeled: 'received_receipt',
        predicted: 'received_invoice',
      },
    ]);
    expect(report.worst).toEqual([
      { file_name: 'doc1.pdf', errors: 2 },
      { file_name: 'doc2.pdf', errors: 1 },
    ]);
    expect(report.checks).toEqual([
      { id: 'date', fired: 1, withError: 1 },
      { id: 'ico_checksum', fired: 1, withError: 0 },
    ]);
    expect(report.byInputMode).toEqual([
      { mode: 'image', labeled: 1, classAccuracyPct: 100, fieldAccuracyPct: null },
      { mode: 'pdf', labeled: 2, classAccuracyPct: 50, fieldAccuracyPct: 92 },
    ]);
  });

  it('compares two run selections on the same labeled documents', () => {
    const compared = buildProtoReport(records, {
      run: { promptVersion: 'm02-proto-v2' },
      compareRun: { promptVersion: 'm02-proto-v1' },
    });
    expect(compared.compare).toMatchObject({
      matched: 1,
      classAccuracyBeforePct: 0,
      classAccuracyAfterPct: 100,
    });
    expect(buildProtoReport(records).compare).toBeNull();
  });

  it('renders a Markdown report', () => {
    const text = renderProtoReport(report);
    expect(text).toContain('# Prototype results');
    expect(text).toContain(`Verdict rules: ${PROTO_VERDICT_RULES_VERSION}`);
    expect(text).toContain('| receipt | 1 | 0 | 0 | 0 |');
    expect(text).toContain('Class accuracy: 67 %');
    expect(text).toContain('| variable_symbol | 2 | 1 | 0 | 0 | 1 | 0 | 50 % |');
    expect(text).toContain('| doc1.pdf | duzp | hallucinated |  | 2026-09-01 |');
    expect(text).toContain('| pdf | 2 | 50 % | 92 % |');
    expect(text).toContain('| image | 1 | 100 % | n/a |');
    expect(text).not.toContain('Compared with');
  });
});
