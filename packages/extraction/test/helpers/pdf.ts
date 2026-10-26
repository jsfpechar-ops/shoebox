/** A one-page PDF with Helvetica text lines and an optional 8-bit gray image. Test-only. */
export function buildPdf(
  lines: readonly string[],
  image?: { width: number; height: number; gray: Uint8Array },
): Uint8Array {
  const content =
    lines.map((l, i) => `BT /F1 11 Tf 50 ${780 - i * 16} Td (${l}) Tj ET`).join('\n') +
    (image ? '\nq 150 0 0 150 50 300 cm /Im1 Do Q' : '');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >>${image ? ' /XObject << /Im1 6 0 R >>' : ''} >> /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n')];
  let len = chunks[0]?.length ?? 0;
  const offsets: number[] = [];
  const push = (b: Buffer): void => {
    chunks.push(b);
    len += b.length;
  };
  objs.forEach((o, i) => {
    offsets.push(len);
    push(Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`));
  });
  if (image) {
    offsets.push(len);
    push(
      Buffer.from(
        `6 0 obj\n<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Length ${image.gray.length} >>\nstream\n`,
      ),
    );
    push(Buffer.from(image.gray));
    push(Buffer.from('\nendstream\nendobj\n'));
  }
  const xref = len;
  const n = offsets.length + 1;
  push(
    Buffer.from(
      `xref\n0 ${n}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${n} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
    ),
  );
  return new Uint8Array(Buffer.concat(chunks));
}
