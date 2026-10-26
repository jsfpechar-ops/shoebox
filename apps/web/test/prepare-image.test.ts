import { describe, expect, it } from 'vitest';
import { isHeic, jpegName, MAX_EDGE, planImage, scaledSize } from '../src/documents/prepare-image';

describe('isHeic', () => {
  it('knows HEIC by type or by extension', () => {
    expect(isHeic('IMG_1.HEIC', '')).toBe(true);
    expect(isHeic('a.heif', 'application/octet-stream')).toBe(true);
    expect(isHeic('photo', 'image/heic')).toBe(true);
    expect(isHeic('a.jpg', 'image/jpeg')).toBe(false);
  });
});

describe('planImage', () => {
  it('re-encodes photos, keeps small PNGs, never touches PDFs or ISDOC', () => {
    expect(planImage('a.jpg', 'image/jpeg', 1000, 800)).toBe('jpeg');
    expect(planImage('a.webp', 'image/webp', 1000, 800)).toBe('jpeg');
    expect(planImage('a.heic', '', 4032, 3024)).toBe('jpeg');
    expect(planImage('s.png', 'image/png', 1170, 2532)).toBe('jpeg');
    expect(planImage('s.png', 'image/png', 1000, 2000)).toBe('keep');
    expect(planImage('f.pdf', 'application/pdf', 0, 0)).toBe('keep');
    expect(planImage('f.isdoc', 'application/xml', 0, 0)).toBe('keep');
  });
});

describe('needsDecode via planImage before size is known', () => {
  it('a PNG of unknown size is decoded only to measure it', () => {
    expect(planImage('s.png', 'image/png', null, null)).toBe('measure');
    expect(planImage('a.jpg', 'image/jpeg', null, null)).toBe('jpeg');
    expect(planImage('f.pdf', 'application/pdf', null, null)).toBe('keep');
  });
});

describe('scaledSize', () => {
  it('fits the long edge into MAX_EDGE and keeps the ratio', () => {
    expect(MAX_EDGE).toBe(2400);
    expect(scaledSize(4032, 3024)).toEqual({ width: 2400, height: 1800 });
    expect(scaledSize(3024, 4032)).toEqual({ width: 1800, height: 2400 });
  });
  it('never enlarges', () => {
    expect(scaledSize(800, 600)).toEqual({ width: 800, height: 600 });
  });
  it('rounds and keeps at least 1 px', () => {
    expect(scaledSize(4801, 3)).toEqual({ width: 2400, height: 1 });
  });
});

describe('jpegName', () => {
  it('swaps the extension for .jpg', () => {
    expect(jpegName('IMG_0042.HEIC')).toBe('IMG_0042.jpg');
    expect(jpegName('receipt.photo.png')).toBe('receipt.photo.jpg');
    expect(jpegName('scan')).toBe('scan.jpg');
  });
});
