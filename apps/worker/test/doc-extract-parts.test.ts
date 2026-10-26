import type { DocumentPageForRead } from '@shoebox/db';
import { describe, expect, it } from 'vitest';
import { partsOf } from '../src/doc-extract/parts';

function row(over: Partial<DocumentPageForRead>): DocumentPageForRead {
  return {
    position: 1,
    sourceFileId: 'f1',
    storagePath: 'p/f1',
    mimeType: 'application/pdf',
    filePage: 1,
    region: '',
    ...over,
  };
}

function fakeBlobs() {
  const gets: string[] = [];
  return {
    gets,
    blobs: {
      async get(path: string) {
        gets.push(path);
        return new TextEncoder().encode(path);
      },
    },
  };
}

const picks: string[] = [];
const pick = async (bytes: Uint8Array, pages: readonly number[]) => {
  picks.push(`${new TextDecoder().decode(bytes)}:${pages.join(',')}`);
  return new Uint8Array([pages.length]);
};

describe('partsOf', () => {
  it('cuts the chosen PDF pages and keeps photos whole, in order', async () => {
    picks.length = 0;
    const { blobs, gets } = fakeBlobs();
    const parts = await partsOf(
      [
        row({ position: 1, filePage: 3 }),
        row({ position: 2, filePage: 4 }),
        row({ position: 3, sourceFileId: 'f2', storagePath: 'p/f2', mimeType: 'image/jpeg' }),
        row({ position: 4, filePage: 7 }),
      ],
      blobs,
      pick,
    );
    expect(parts.map((p) => p.mediaType)).toEqual(['application/pdf', 'image/jpeg', 'application/pdf']);
    expect(picks).toEqual(['p/f1:3,4', 'p/f1:7']);
    expect(gets).toEqual(['p/f1', 'p/f2']);
  });

  it('keeps two regions of one photo as two parts', async () => {
    const { blobs } = fakeBlobs();
    const parts = await partsOf(
      [row({ mimeType: 'image/png', region: 'top' })],
      blobs,
      pick,
    );
    expect(parts).toEqual([
      { bytes: new TextEncoder().encode('p/f1'), mediaType: 'image/png', region: 'top' },
    ]);
  });

  it('rejects a file the model cannot read', async () => {
    const { blobs } = fakeBlobs();
    await expect(partsOf([row({ mimeType: 'application/xml' })], blobs, pick)).rejects.toThrow(TypeError);
  });
});
