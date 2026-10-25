import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createLlmClientFromEnv,
  LlmKeyMissingError,
  LlmProviderError,
  loadDotEnvFile,
  parseDotEnv,
  resolveLlmEnv,
} from '../src/index';

// Placeholders only: never a real key (hard rule 4, .gitleaks).
const KEY = 'gemini-key-placeholder';

describe('resolveLlmEnv', () => {
  it('defaults to gemini-3.8-flash with GEMINI_API_KEY', () => {
    expect(resolveLlmEnv({})).toEqual({
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      keyEnv: 'GEMINI_API_KEY',
      hasKey: false,
    });
    expect(resolveLlmEnv({ GEMINI_API_KEY: KEY, SHOEBOX_LLM_MODEL: ' gemini-x ' })).toMatchObject({
      model: 'gemini-x',
      hasKey: true,
    });
  });

  it('switches to anthropic and rejects an unknown provider', () => {
    expect(resolveLlmEnv({ SHOEBOX_LLM_PROVIDER: 'anthropic' })).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      keyEnv: 'ANTHROPIC_API_KEY',
      hasKey: false,
    });
    expect(() => resolveLlmEnv({ SHOEBOX_LLM_PROVIDER: 'openai' })).toThrow(LlmProviderError);
  });
});

describe('createLlmClientFromEnv', () => {
  it('needs the gemini key and uses the injected fetch', async () => {
    expect(() => createLlmClientFromEnv({})).toThrow(LlmKeyMissingError);
    const urls: string[] = [];
    const fetchFn = ((url: string | URL | Request) => {
      urls.push(String(url));
      return Promise.resolve(
        Response.json({
          candidates: [{ content: { parts: [{ text: 'x' }] }, finishReason: 'STOP' }],
        }),
      );
    }) as typeof fetch;
    const { client, config } = createLlmClientFromEnv({ GEMINI_API_KEY: KEY }, { fetch: fetchFn });
    expect(config.provider).toBe('gemini');
    const response = await client.complete({
      model: 'gemini-3.8-flash',
      promptVersion: 'p',
      maxTokens: 10,
      system: [],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    });
    expect(response.text).toBe('x');
    expect(urls[0]).toContain('/models/gemini-3.8-flash:generateContent');
  });

  it('builds the anthropic client and requires its key', async () => {
    expect(() => createLlmClientFromEnv({ SHOEBOX_LLM_PROVIDER: 'anthropic' })).toThrow(
      LlmKeyMissingError,
    );
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({
          model: 'claude-sonnet-5-5',
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'hi' }],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const { client, config } = createLlmClientFromEnv(
      { SHOEBOX_LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' },
      { fetch: fetchFn },
    );
    expect(config.model).toBe('claude-sonnet-5-5');
    const res = await client.complete({
      model: config.model,
      promptVersion: 'v',
      maxTokens: 10,
      system: [],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
    });
    expect(res.text).toBe('hi');
  });
});

describe('dotenv', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('parses KEY=value, quotes, export and comments', () => {
    const text = [
      '# comment',
      '',
      'A=1',
      'export B = two words # trailing',
      'C="quoted # not a comment"',
      "D='single'",
      'not a pair',
    ].join('\n');
    expect(parseDotEnv(text)).toEqual({
      A: '1',
      B: 'two words',
      C: 'quoted # not a comment',
      D: 'single',
    });
  });

  it('loads a file without overriding set variables, and ignores a missing file', async () => {
    dir = await mkdtemp(join(tmpdir(), 'shoebox-dotenv-'));
    const path = join(dir, '.env.local');
    await writeFile(path, `GEMINI_API_KEY=${KEY}\nSHOEBOX_LLM_MODEL=from-file\n`, 'utf8');
    const env: Record<string, string | undefined> = { SHOEBOX_LLM_MODEL: 'from-shell' };
    expect(loadDotEnvFile(path, env)).toEqual(['GEMINI_API_KEY']);
    expect(env).toEqual({ SHOEBOX_LLM_MODEL: 'from-shell', GEMINI_API_KEY: KEY });
    expect(loadDotEnvFile(join(dir, 'missing'), env)).toEqual([]);
  });
});
