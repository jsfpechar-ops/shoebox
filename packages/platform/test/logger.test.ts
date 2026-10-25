import { describe, expect, it } from 'vitest';
import { createLogger, LOG_FIELD_ALLOWLIST, pickAllowed, withContext } from '../src/logger/index';

type Line = Record<string, unknown>;

function capture() {
  const raw: string[] = [];
  const destination = {
    write(chunk: string) {
      raw.push(chunk);
    },
  };
  const log = createLogger({ service: 'worker', env: 'test', release: 'abc123', destination });
  const lines = (): Line[] => raw.map((r) => JSON.parse(r) as Line);
  const text = (): string => raw.join('');
  return { log, lines, text };
}

const fakeDocument = {
  partnerName: 'Pekárna Novák s.r.o.',
  text: 'Faktura č. 2026001 za pečivo',
  iban: 'CZ6508000000192000145399',
  amount: '1210.00',
  fileName: 'faktura-novak.pdf',
  email: 'jan.novak@example.cz',
  documentId: 'doc-1',
  durationMs: 12,
};

describe('logger: mandatory fields', () => {
  it('every line has ts, level, msg, service, env, release', () => {
    const { log, lines } = capture();
    log.info('started');
    const line = lines()[0];
    expect(line).toBeDefined();
    expect(typeof line?.ts).toBe('string');
    expect(Number.isNaN(Date.parse(String(line?.ts)))).toBe(false);
    expect(line).toMatchObject({
      level: 'info',
      msg: 'started',
      service: 'worker',
      env: 'test',
      release: 'abc123',
    });
  });

  it('withContext adds requestId, traceId and the optional ids', () => {
    const { log, lines } = capture();
    withContext(log, {
      requestId: 'req-1',
      traceId: 'trace-1',
      orgId: 'org-1',
      stage: 'extract',
    }).info('stage done');
    expect(lines()[0]).toMatchObject({
      requestId: 'req-1',
      traceId: 'trace-1',
      orgId: 'org-1',
      stage: 'extract',
      service: 'worker',
    });
  });
});

describe('logger: allowlist serializer (M12 AC-9)', () => {
  it('drops partnerName, text, iban and amount, keeps allowlisted keys', () => {
    const { log, lines, text } = capture();
    log.info(fakeDocument, 'extracted');
    const line = lines()[0];
    for (const key of ['partnerName', 'text', 'iban', 'amount', 'fileName', 'email']) {
      expect(line).not.toHaveProperty(key);
    }
    expect(line).toMatchObject({ documentId: 'doc-1', durationMs: 12, msg: 'extracted' });
    for (const secret of ['Novák', 'Faktura', 'CZ65', '1210', 'faktura-novak', 'example.cz']) {
      expect(text()).not.toContain(secret);
    }
  });

  it('drops non-allowlisted keys in child bindings too', () => {
    const { log, lines, text } = capture();
    log.child({ partnerName: 'Pekárna Novák s.r.o.', jobId: 'job-7' }).info('child');
    log.child({ jobId: 'job-8' }).child({ text: 'Faktura č. 1', stage: 'ocr' }).info('grandchild');
    expect(lines()[1]).toMatchObject({ jobId: 'job-8', stage: 'ocr' });
    expect(text()).not.toContain('Faktura');
    expect(lines()[0]).toMatchObject({ jobId: 'job-7' });
    expect(text()).not.toContain('Novák');
  });

  it('drops nested objects even under an allowlisted key', () => {
    const { log, lines } = capture();
    log.info({ orgId: { name: 'Pekárna Novák s.r.o.' } }, 'nested');
    expect(lines()[0]).not.toHaveProperty('orgId');
  });

  it('ignores a msg key inside the object', () => {
    const { log, text } = capture();
    log.info({ msg: 'Pekárna Novák s.r.o.' });
    expect(text()).not.toContain('Novák');
  });

  it('never interpolates printf-style arguments', () => {
    const { log, lines, text } = capture();
    log.info('saved %s', 'Pekárna Novák s.r.o.');
    expect(lines()[0]?.msg).toBe('saved %s');
    expect(text()).not.toContain('Novák');
  });

  it('logs an Error as errorCode only, without message or stack', () => {
    const { log, lines, text } = capture();
    log.error(new Error('IBAN CZ6508000000192000145399 invalid'));
    log.error(
      Object.assign(new Error('Pekárna Novák s.r.o.'), { code: 'E_PARSE' }),
      'parse failed',
    );
    log.error({ err: new Error('Pekárna Novák s.r.o.'), jobId: 'job-7' }, 'job failed');
    const [plain, coded, nested] = lines();
    expect(plain).toMatchObject({ level: 'error', errorCode: 'Error', msg: 'Error' });
    expect(coded).toMatchObject({ errorCode: 'E_PARSE', msg: 'parse failed' });
    expect(nested).toMatchObject({ jobId: 'job-7', msg: 'job failed' });
    expect(nested).not.toHaveProperty('err');
    for (const secret of ['CZ65', 'Novák', 'stack']) {
      expect(text()).not.toContain(secret);
    }
  });
});

describe('pickAllowed', () => {
  it('keeps exactly the M12 §4.7 field list', () => {
    expect([...LOG_FIELD_ALLOWLIST]).toEqual([
      'service',
      'env',
      'release',
      'requestId',
      'traceId',
      'orgId',
      'userId',
      'jobName',
      'jobId',
      'documentId',
      'stage',
      'durationMs',
      'errorCode',
      'httpStatus',
    ]);
  });

  it('keeps primitives under allowlisted keys and drops everything else', () => {
    expect(
      pickAllowed({
        jobId: 'j',
        durationMs: 5,
        stage: null,
        amount: 1,
        orgId: ['x'],
        userId: Number.NaN,
      }),
    ).toEqual({ jobId: 'j', durationMs: 5, stage: null });
  });
});
