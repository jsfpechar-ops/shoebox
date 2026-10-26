import type { PathLike, PathOrFileDescriptor } from 'node:fs';
import { existsSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defaultExec,
  type ExecFn,
  readManifest,
  validateXml,
  validateXmlOrStructural,
  XmllintMissingError,
  xsdAvailable,
} from '../src/validate';

// Toggles the DPHDP3 03.01.04 XSD (schema file present or not) so both branches run.
// The stub delegates everything else to the real filesystem.
const state = vi.hoisted(() => ({ vendored: false }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: (p: PathLike) => {
      if (String(p).endsWith('/xsd/DPHDP3/03.01.04/dphdp3_epo2.xsd')) return state.vendored;
      return actual.existsSync(p);
    },
    readFileSync: (p: PathOrFileDescriptor, enc: BufferEncoding) => {
      if (state.vendored && String(p).endsWith('/xsd/DPHDP3/03.01.04/manifest.json')) {
        const manifest = JSON.parse(actual.readFileSync(p, 'utf8')) as Record<string, unknown>;
        return JSON.stringify({ ...manifest, sha256: 'a'.repeat(64) });
      }
      return actual.readFileSync(p, enc);
    },
  };
});

const VERSION = '03.01.04';
const AUG = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<Pisemnost nazevSW="Shoebox" verzeSW="0.0.0">',
  '  <DPHDP3 verzePis="03.01">',
  '    <VetaD dokument="DP3" k_uladis="DPH" dapdph_forma="B" typ_platce="I" rok="2026" mesic="8" trans="A" c_okec="552000" d_poddp="20.09.2026"/>',
  '    <VetaP c_ufo="451" c_pracufo="2003" dic="7801011229" typ_ds="F" jmeno="Jan" prijmeni="Novák" ulice="Vinohradská" c_pop="1" naz_obce="Praha" psc="13000" stat="ČESKÁ REPUBLIKA" email="jan@example.com"/>',
  '    <Veta1 p_sl23_e="13700" dan_psl23_e="2877"/>',
  '    <Veta6 dan_zocelk="2877" dano_da="2877"/>',
  '  </DPHDP3>',
  '</Pisemnost>',
  '',
].join('\n');

const enoent = () => Object.assign(new Error('spawn xmllint ENOENT'), { code: 'ENOENT' });

afterEach(() => {
  state.vendored = false;
});

describe('XSD availability', () => {
  it('needs a hash in the manifest and the schema file on disk', () => {
    expect(xsdAvailable('DPHDP3', VERSION)).toBe(false);
    state.vendored = true;
    expect(readManifest('DPHDP3', VERSION)?.sha256).toBe('a'.repeat(64));
    expect(xsdAvailable('DPHDP3', VERSION)).toBe(true);
  });
});

describe('validateXml with the XSD vendored', () => {
  beforeEach(() => {
    state.vendored = true;
  });

  it('reports structural errors without running xmllint', async () => {
    const exec = vi.fn<ExecFn>(async () => ({ code: 0, stderr: '' }));
    const bad = await validateXml(AUG.replace('mesic="8"', 'mesic="13"'), 'DPHDP3', VERSION, {
      exec,
    });
    expect(bad).toMatchObject({ valid: false, method: 'xsd', xsdAvailable: true });
    expect(bad.errors[0]).toMatchObject({ line: 4, element: 'VetaD' });
    expect(exec).not.toHaveBeenCalled();
  });

  it('passes the document to xmllint, returns valid on exit 0 and removes the temp file', async () => {
    const exec = vi.fn<ExecFn>(async () => ({ code: 0, stderr: '' }));
    const result = await validateXml(AUG, 'DPHDP3', VERSION, { exec });
    expect(result).toEqual({ valid: true, method: 'xsd', xsdAvailable: true, errors: [] });
    const [cmd, args] = exec.mock.calls[0] ?? [];
    expect(cmd).toBe('xmllint');
    expect(args?.slice(0, 3)).toEqual(['--noout', '--nonet', '--schema']);
    expect(String(args?.[3])).toMatch(/dphdp3_epo2\.xsd$/);
    const file = String(args?.[4]);
    expect(file).toMatch(/tax-xml-.*\.xml$/);
    expect(existsSync(file)).toBe(false);
  });

  it('uses a custom xmllint binary when given', async () => {
    const exec = vi.fn<ExecFn>(async () => ({ code: 0, stderr: '' }));
    await validateXml(AUG, 'DPHDP3', VERSION, { exec, xmllint: '/opt/custom/xmllint' });
    expect(exec.mock.calls[0]?.[0]).toBe('/opt/custom/xmllint');
  });

  it('parses xmllint schema errors into line, element and message', async () => {
    const stderr =
      "/tmp/dp3.xml:4: element Veta1: Schemas validity error : Element 'Veta1', attribute 'foo': The attribute 'foo' is not allowed.\n/tmp/dp3.xml fails to validate\n";
    const result = await validateXml(AUG, 'DPHDP3', VERSION, {
      exec: async () => ({ code: 1, stderr }),
    });
    expect(result.valid).toBe(false);
    expect(result.method).toBe('xsd');
    expect(result.errors).toEqual([
      {
        line: 4,
        element: 'Veta1',
        message: "Element 'Veta1', attribute 'foo': The attribute 'foo' is not allowed.",
      },
    ]);
  });

  it('falls back to the first non-empty stderr line when nothing parses', async () => {
    const result = await validateXml(AUG, 'DPHDP3', VERSION, {
      exec: async () => ({ code: 1, stderr: '\n\nxmllint: I/O error : boom\n' }),
    });
    expect(result.errors).toEqual([
      { line: null, element: null, message: 'xmllint: I/O error : boom' },
    ]);
  });

  it('reports the exit code when stderr is empty', async () => {
    const withCode = await validateXml(AUG, 'DPHDP3', VERSION, {
      exec: async () => ({ code: 4, stderr: '' }),
    });
    expect(withCode.errors).toEqual([
      { line: null, element: null, message: 'xmllint exited with 4' },
    ]);
    const noCode = await validateXml(AUG, 'DPHDP3', VERSION, {
      exec: async () => ({ code: null, stderr: '   ' }),
    });
    expect(noCode.errors).toEqual([
      { line: null, element: null, message: 'xmllint exited with null' },
    ]);
  });

  it('throws XmllintMissingError when the xmllint binary is not installed', async () => {
    await expect(
      validateXml(AUG, 'DPHDP3', VERSION, {
        exec: async () => ({ code: null, stderr: '', error: enoent() }),
      }),
    ).rejects.toBeInstanceOf(XmllintMissingError);
  });

  it('validateXmlOrStructural falls back to the structural result without xmllint', async () => {
    await expect(
      validateXmlOrStructural(AUG, 'DPHDP3', VERSION, {
        exec: async () => ({ code: null, stderr: '', error: enoent() }),
      }),
    ).resolves.toEqual({ valid: true, method: 'structural', xsdAvailable: false, errors: [] });
  });

  it('validateXmlOrStructural rethrows other errors', async () => {
    await expect(
      validateXmlOrStructural(AUG, 'DPHDP3', VERSION, {
        exec: async () => {
          throw new Error('boom');
        },
      }),
    ).rejects.toThrow('boom');
  });

  it('throws XmllintMissingError through the real exec when the binary path does not exist', async () => {
    await expect(
      validateXml(AUG, 'DPHDP3', VERSION, { xmllint: '/nonexistent/shoebox-xmllint' }),
    ).rejects.toBeInstanceOf(XmllintMissingError);
  });

  it('reports a parse failure with the xsd method and never calls xmllint', async () => {
    const result = await validateXml('<foo/>', 'DPHDP3', VERSION);
    expect(result).toMatchObject({ valid: false, method: 'xsd', xsdAvailable: true });
    expect(result.errors[0]?.message).toBe('tax-xml: not an EPO document');
  });
});

describe('validateXml without the XSD', () => {
  it('turns a parse failure into a structural error', async () => {
    const result = await validateXml('<foo/>', 'DPHDP3', VERSION);
    expect(result).toEqual({
      valid: false,
      method: 'structural',
      xsdAvailable: false,
      errors: [{ line: null, element: null, message: 'tax-xml: not an EPO document' }],
    });
  });

  it('stays structural and never calls xmllint when the document is valid', async () => {
    const exec = vi.fn<ExecFn>(async () => ({ code: 0, stderr: '' }));
    const result = await validateXml(AUG, 'DPHDP3', VERSION, { exec });
    expect(result).toEqual({ valid: true, method: 'structural', xsdAvailable: false, errors: [] });
    expect(exec).not.toHaveBeenCalled();
  });
});

describe('defaultExec', () => {
  it('resolves code 0 on success', async () => {
    const run = await defaultExec(process.execPath, ['-e', ''], { timeoutMs: 10_000 });
    expect(run.code).toBe(0);
    expect(run.error).toBeUndefined();
  });

  it('returns the exit code and stderr of a failing command', async () => {
    const run = await defaultExec(
      process.execPath,
      ['-e', "process.stderr.write('boom\\n'); process.exit(3)"],
      { timeoutMs: 10_000 },
    );
    expect(run.code).toBe(3);
    expect(run.stderr).toContain('boom');
    expect(run.error).toBeDefined();
  });

  it('reports ENOENT for a missing binary', async () => {
    const run = await defaultExec('/nonexistent/shoebox-xmllint', [], { timeoutMs: 10_000 });
    expect(run.code).toBeNull();
    expect(run.error?.code).toBe('ENOENT');
  });

  it('reports a null code when the process is killed on timeout', async () => {
    const run = await defaultExec(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], {
      timeoutMs: 50,
    });
    expect(run.code).toBeNull();
    expect(run.error).toBeDefined();
  });
});

// Real xmllint against the vendored official schema: exercises the non-stubbed exec path.
const hasXmllint = existsSync('/usr/bin/xmllint');
describe.skipIf(!hasXmllint)('validateXml with the real xmllint binary', () => {
  it('validates against the vendored official schema', async () => {
    state.vendored = true;
    const result = await validateXml(AUG, 'DPHDP3', VERSION, { xmllint: '/usr/bin/xmllint' });
    expect(result).toEqual({ valid: true, method: 'xsd', xsdAvailable: true, errors: [] });
  });

  it('reports schema violations through the xsd method', async () => {
    state.vendored = true;
    const bad = AUG.replace(/ rok="\d{4}"/, ' rok="20x6"');
    expect(bad).not.toBe(AUG);
    const result = await validateXml(bad, 'DPHDP3', VERSION, { xmllint: '/usr/bin/xmllint' });
    expect(result.method).toBe('xsd');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
