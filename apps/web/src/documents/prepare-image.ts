export const MAX_EDGE = 2400;
export const JPEG_QUALITY = 0.88;

const HEIC_EXT = /\.(heic|heif)$/i;
const HEIC_TYPES = ['image/heic', 'image/heif'];

export function isHeic(name: string, type: string): boolean {
  return HEIC_TYPES.includes(type.toLowerCase()) || HEIC_EXT.test(name);
}

/** 'jpeg' = re-encode, 'keep' = send as is, 'measure' = a PNG whose size is not known yet. Width/height null = not decoded yet. */
export function planImage(
  name: string,
  type: string,
  width: number | null,
  height: number | null,
): 'jpeg' | 'keep' | 'measure' {
  if (isHeic(name, type) || type === 'image/jpeg' || type === 'image/webp') return 'jpeg';
  if (type === 'image/png') {
    if (width === null || height === null) return 'measure';
    return Math.max(width, height) > MAX_EDGE ? 'jpeg' : 'keep';
  }
  return 'keep';
}

export function scaledSize(
  width: number,
  height: number,
  max: number = MAX_EDGE,
): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= max) return { width, height };
  const ratio = max / longEdge;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

export function jpegName(name: string): string {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}.jpg`;
}

/** Browser only. Returns the file to upload, or null for a HEIC this browser cannot open. */
export async function prepareFile(file: File): Promise<File | null> {
  const heic = isHeic(file.name, file.type);
  const first = planImage(file.name, file.type, null, null);
  if (first === 'keep') return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return heic ? null : file;
  }

  try {
    const plan = planImage(file.name, file.type, bitmap.width, bitmap.height);
    if (plan === 'keep') return file;

    const size = scaledSize(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return heic ? null : file;
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    );
    if (!blob) return heic ? null : file;

    return new File([blob], jpegName(file.name), {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    });
  } finally {
    bitmap.close();
  }
}
