import { describe, expect, it } from 'vitest';
import { crc32, createZip } from '../src';

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Reads the stored entries back by walking the local headers. */
function readZip(zip: Uint8Array): Array<{ name: string; text: string; crc: number }> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const out: Array<{ name: string; text: string; crc: number }> = [];
  let p = 0;
  while (view.getUint32(p, true) === 0x04034b50) {
    const crc = view.getUint32(p + 14, true);
    const size = view.getUint32(p + 18, true);
    const nameLength = view.getUint16(p + 26, true);
    const name = dec.decode(zip.subarray(p + 30, p + 30 + nameLength));
    const data = zip.subarray(p + 30 + nameLength, p + 30 + nameLength + size);
    out.push({ name, text: dec.decode(data), crc });
    p += 30 + nameLength + size;
  }
  return out;
}

describe('crc32', () => {
  it('matches the reference values', () => {
    expect(crc32(enc.encode('hello'))).toBe(0x3610a686);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe('createZip', () => {
  const at = new Date(Date.UTC(2026, 9, 26, 10, 30, 0));
  const zip = createZip(
    [
      { name: 'register.xlsx', data: enc.encode('sheet') },
      { name: 'doklady/2026-09 Účtenka.pdf', data: enc.encode('%PDF-1.7') },
    ],
    at,
  );

  it('stores every entry with its UTF-8 name, data and CRC', () => {
    const entries = readZip(zip);
    expect(entries.map((e) => e.name)).toEqual(['register.xlsx', 'doklady/2026-09 Účtenka.pdf']);
    expect(entries[1]?.text).toBe('%PDF-1.7');
    expect(entries[0]?.crc).toBe(crc32(enc.encode('sheet')));
  });

  it('ends with an end-of-central-directory record that counts the entries', () => {
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const end = zip.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    const centralOffset = view.getUint32(end + 16, true);
    expect(view.getUint32(centralOffset, true)).toBe(0x02014b50);
  });

  it('an empty archive is just the end record', () => {
    expect(createZip([], at).length).toBe(22);
  });
});
