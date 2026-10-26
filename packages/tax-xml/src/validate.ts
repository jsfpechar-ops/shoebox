import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkStructure, type EpoForm, parseEpoXml } from './forms';

export interface XsdManifest {
  readonly form: EpoForm;
  readonly version: string;
  readonly verze_pis: string;
  readonly main: string;
  readonly source_url: string;
  readonly sha256: string | null;
  readonly fetched_at: string | null;
  readonly valid_for_periods_from: string;
}

export interface XsdError {
  readonly line: number | null;
  readonly element: string | null;
  readonly message: string;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly method: 'xsd' | 'structural';
  readonly xsdAvailable: boolean;
  readonly errors: readonly XsdError[];
}

export class XmllintMissingError extends Error {}

export type ExecFn = (
  cmd: string,
  args: readonly string[],
  opts: { readonly timeoutMs: number },
) => Promise<{
  readonly code: number | null;
  readonly stderr: string;
  readonly error?: NodeJS.ErrnoException;
}>;

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function xsdDir(form: EpoForm, version: string): string {
  return path.join(PACKAGE_ROOT, 'xsd', form, version);
}

export function readManifest(form: EpoForm, version: string): XsdManifest | null {
  const file = path.join(xsdDir(form, version), 'manifest.json');
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8')) as XsdManifest;
}

// TODO(decision-xsd): the official XSDs are not vendored yet (owner step); until then this is false.
export function xsdAvailable(form: EpoForm, version: string): boolean {
  const manifest = readManifest(form, version);
  if (!manifest || manifest.sha256 === null) return false;
  return existsSync(path.join(xsdDir(form, version), manifest.main));
}

const XMLLINT_LINE = /:(\d+): element ([^:]+): Schemas (?:validity|parser) error\s*:\s*(.*)$/;

export function parseXmllintStderr(stderr: string): XsdError[] {
  const errors: XsdError[] = [];
  for (const raw of stderr.split('\n')) {
    const m = XMLLINT_LINE.exec(raw);
    if (m)
      errors.push({
        line: Number.parseInt(m[1] ?? '', 10),
        element: (m[2] ?? '').trim(),
        message: (m[3] ?? '').trim(),
      });
  }
  return errors;
}

export const defaultExec: ExecFn = (cmd, args, opts) =>
  new Promise((resolve) => {
    execFile(
      cmd,
      [...args],
      { timeout: opts.timeoutMs, encoding: 'utf8' },
      (error, _stdout, stderr) => {
        if (!error) {
          resolve({ code: 0, stderr: String(stderr) });
          return;
        }
        const e = error as NodeJS.ErrnoException;
        if (e.code === 'ENOENT') {
          resolve({ code: null, stderr: '', error: e });
          return;
        }
        resolve({
          code: typeof e.code === 'number' ? e.code : null,
          stderr: String(stderr ?? ''),
          error: e,
        });
      },
    );
  });

export async function validateXml(
  xml: string,
  form: EpoForm,
  version: string,
  opts?: { readonly exec?: ExecFn; readonly xmllint?: string },
): Promise<ValidationResult> {
  let structural: XsdError[];
  try {
    structural = checkStructure(parseEpoXml(xml), form);
  } catch (e) {
    structural = [
      { line: null, element: null, message: e instanceof Error ? e.message : String(e) },
    ];
  }
  const manifest = readManifest(form, version);
  const available = manifest !== null && xsdAvailable(form, version);
  if (structural.length > 0) {
    return {
      valid: false,
      method: available ? 'xsd' : 'structural',
      xsdAvailable: available,
      errors: structural,
    };
  }
  if (!manifest || !available) {
    // TODO(decision-xsd): structural only until the official XSD is vendored.
    return { valid: true, method: 'structural', xsdAvailable: false, errors: [] };
  }

  const exec = opts?.exec ?? defaultExec;
  const file = path.join(os.tmpdir(), `tax-xml-${randomUUID()}.xml`);
  await writeFile(file, xml, 'utf8');
  try {
    const run = await exec(
      opts?.xmllint ?? 'xmllint',
      ['--noout', '--nonet', '--schema', path.join(xsdDir(form, version), manifest.main), file],
      {
        timeoutMs: 10_000,
      },
    );
    if (run.error?.code === 'ENOENT') throw new XmllintMissingError('xmllint not installed');
    if (run.code === 0) return { valid: true, method: 'xsd', xsdAvailable: true, errors: [] };
    const parsed = parseXmllintStderr(run.stderr);
    const firstLine = run.stderr.split('\n').find((l) => l.trim() !== '') ?? '';
    const errors: XsdError[] =
      parsed.length > 0
        ? parsed
        : [
            {
              line: null,
              element: null,
              message: firstLine || `xmllint exited with ${String(run.code)}`,
            },
          ];
    return { valid: false, method: 'xsd', xsdAvailable: true, errors };
  } finally {
    await rm(file, { force: true });
  }
}

/** Like validateXml, but a host without xmllint gets the structural result (filings stay drafts) instead of an error. */
export async function validateXmlOrStructural(
  xml: string,
  form: EpoForm,
  version: string,
  opts?: { readonly exec?: ExecFn; readonly xmllint?: string },
): Promise<ValidationResult> {
  try {
    return await validateXml(xml, form, version, opts);
  } catch (e) {
    if (!(e instanceof XmllintMissingError)) throw e;
    return { valid: true, method: 'structural', xsdAvailable: false, errors: [] };
  }
}
