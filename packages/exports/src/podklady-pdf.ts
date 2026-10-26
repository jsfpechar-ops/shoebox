import { CZK, Money, type PodkladySummary, round0 } from '@shoebox/domain';
import { PDFDocument, type PDFFont, type PDFPage, StandardFonts } from 'pdf-lib';

export type Translate = (key: string, params?: Record<string, string | number>) => string;
export type PdfLine = {
  readonly kind: 'h1' | 'h2' | 'text' | 'row' | 'gap' | 'footer';
  readonly text: string;
  readonly value?: string;
}; // row: text + right-aligned value

export const PDF_MIME = 'application/pdf';

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;
const FLOOR = 90;
const WIDTH = PAGE_W - 2 * MARGIN;

const TRANSLIT: Readonly<Record<string, string>> = {
  č: 'c',
  ř: 'r',
  ě: 'e',
  š: 's',
  ž: 'z',
  ý: 'y',
  á: 'a',
  í: 'i',
  é: 'e',
  ó: 'o',
  ú: 'u',
  ů: 'u',
  ď: 'd',
  ť: 't',
  ň: 'n',
  Č: 'C',
  Ř: 'R',
  Ě: 'E',
  Š: 'S',
  Ž: 'Z',
  Ý: 'Y',
  Á: 'A',
  Í: 'I',
  É: 'E',
  Ó: 'O',
  Ú: 'U',
  Ů: 'U',
  Ď: 'D',
  Ť: 'T',
  Ň: 'N',
};

// WinAnsi code points above 0x7F that Helvetica can draw (the rest of 0x80-0x9F is not printable).
const WIN_ANSI_EXTRA = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152,
  0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x017e, 0x0178,
]);

/** Czech diacritics to ASCII; any other character outside WinAnsi becomes `?`. */
export function transliterate(text: string): string {
  let out = '';
  for (const ch of text) {
    const mapped = TRANSLIT[ch];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    const cp = ch.codePointAt(0) ?? 0;
    const printable =
      (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || WIN_ANSI_EXTRA.has(cp);
    out += printable ? ch : '?';
  }
  return out;
}

/** Whole Kč, half-up, space-separated thousands: `141 540 Kč`. */
export function formatKc(m: Money): string {
  const whole = round0(m).toFixed2().split('.')[0] ?? '0';
  const negative = whole.startsWith('-');
  const digits = whole.replace('-', '');
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const sign = negative && digits !== '0' ? '-' : '';
  return `${sign}${grouped} Kč`;
}

/** Pure text content of the Podklady PDF (M06 §4.9 order); the renderer draws these lines. */
export function podkladyPdfLines(s: PodkladySummary, t: Translate): PdfLine[] {
  const lines: PdfLine[] = [];
  const push = (line: PdfLine): void => {
    lines.push(line);
  };
  const row = (text: string, value: string): void => push({ kind: 'row', text, value });
  const para = (text: string): void => push({ kind: 'text', text });
  const h2 = (key: string): void => {
    push({ kind: 'gap', text: '' });
    push({ kind: 'h2', text: t(key) });
  };
  const sum = (items: readonly Money[]): Money => Money.sum(items, CZK);

  // (1) header
  push({ kind: 'h1', text: t('podklady.title', { year: s.year }) });
  row(t('podklady.header.name'), transliterate(s.taxpayer.legalName));
  row(t('podklady.header.ico'), s.taxpayer.ico ?? '-');
  row(t('podklady.header.regime'), t(`podklady.regime.${s.regime}`));
  row(t('podklady.header.generated'), s.generatedOn);
  if (s.watermark) para(t('podklady.watermark'));
  if (s.empty) para(t('podklady.empty'));

  // (2) headline
  h2('podklady.section.headline');
  row(t('podklady.headline.income'), formatKc(s.headline.income));
  if (s.headline.label === 'flat') {
    row(
      t('podklady.headline.flat_expenses', { rate: s.flatRate?.rate ?? '-' }),
      formatKc(s.headline.expenses),
    );
  } else {
    row(t('podklady.headline.expenses'), formatKc(s.headline.expenses));
  }
  row(t('podklady.headline.base'), formatKc(s.headline.base));
  row(t('podklady.headline.advances'), formatKc(s.advancesPaid));

  // (3) categories
  h2('podklady.section.categories');
  for (const c of s.totals.income) {
    row(t(`podklady.category.${c.categoryCode}`), formatKc(c.amount));
  }
  for (const c of s.totals.deductible) {
    row(t(`podklady.category.${c.categoryCode}`), formatKc(c.businessAmount));
  }
  for (const c of s.totals.nonDeductible) {
    row(t(`podklady.category.${c.categoryCode}`), formatKc(c.amount));
  }
  row(t('podklady.categories.private_part'), formatKc(s.totals.privatePart));

  // (4) comparison or paušální daň box
  if (s.flatRate !== null) {
    const fr = s.flatRate;
    h2('podklady.section.comparison');
    const cmp = fr.baseFlat.compare(fr.baseActual);
    const direction =
      cmp < 0 ? 'podklady.flat.lower' : cmp > 0 ? 'podklady.flat.higher' : 'podklady.flat.equal';
    row(
      t('podklady.flat.result', {
        rate: fr.rate,
        difference: formatKc(fr.difference.abs()),
        direction: t(direction),
      }),
      formatKc(fr.baseFlat),
    );
    if (fr.capReached) row(t('podklady.flat.cap', { cap: formatKc(fr.capKc) }), formatKc(fr.capKc));
    for (const key of fr.caveatKeys) para(t(key));
  }
  if (s.pausalniDan !== null) {
    const pd = s.pausalniDan;
    h2('podklady.section.pausalni_dan');
    const bandBlocked = pd.warnings.some(
      (w) => w.code === 'pd.band_exceeded' || w.code === 'pd.regime_limit_exceeded',
    );
    if (!bandBlocked) {
      para(t('pd.band_ok', { band: pd.fitBand ?? '-', limit: formatKc(pd.limit) }));
    }
    for (const w of pd.warnings) para(t(w.code, w.params));
    para(
      t(`pd.advances_${pd.advancesState}`, {
        expected: formatKc(pd.expected),
        paid: formatKc(pd.paid),
      }),
    );
    para(t('pd.notice', { date: pd.noticeDue }));
    if (s.noReturnKey !== null) para(t(s.noReturnKey));
  }

  // (5) assets, private use, pass-through, VAT
  h2('podklady.section.assets');
  para(t('podklady.assets.note'));
  for (const a of s.assets.assets) {
    const label = [
      a.date ?? '-',
      transliterate(a.partnerName ?? ''),
      transliterate(a.description ?? ''),
    ]
      .filter((part) => part !== '')
      .join(' ');
    row(label, formatKc(a.price));
  }
  if (s.assets.smallAssets.length > 0) {
    row(
      t('podklady.assets.small', { count: s.assets.smallAssets.length }),
      formatKc(sum(s.assets.smallAssets.map((a) => a.price))),
    );
  }
  row(
    t('podklady.private.personal', { count: s.privateUse.personalCount }),
    formatKc(s.privateUse.personalSum),
  );
  for (const p of s.privateUse.partialShares) {
    row(
      t('podklady.private.partial', {
        description: transliterate(p.description ?? ''),
        share: p.businessSharePct,
      }),
      formatKc(p.privatePart),
    );
  }
  row(
    t('podklady.private.car', { regime: s.privateUse.carRegime }),
    s.privateUse.carBusinessSharePct ?? '-',
  );
  for (const c of s.totals.passThrough) {
    row(t(`podklady.category.${c.categoryCode}`), formatKc(c.amount));
  }
  para(t(s.vatNote.textKey));
  row(t('podklady.vat.paid'), formatKc(s.vatNote.vatPaid));
  if (s.vatNote.registrationWarning) {
    para(
      t('podklady.vat.registration_warning', {
        threshold: formatKc(s.vatNote.registrationThreshold),
      }),
    );
  }

  // (6) warnings
  h2('podklady.section.warnings');
  if (s.readiness.length === 0) para(t('podklady.readiness.none'));
  for (const c of s.readiness) para(t(`podklady.readiness.${c.code}`, c.params));
  for (const w of s.assets.warnings) para(t(w.code, w.params));

  // (7) checklist
  h2('podklady.section.checklist');
  for (const key of s.checklistKeys) para(t(key));

  // (8) footer, repeated on every page by the renderer
  push({ kind: 'footer', text: t(s.disclaimerKey) });
  return lines;
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter((w) => w !== '');
  if (words.length === 0) return [''];
  const out: string[] = [];
  let cur = '';
  for (const word of words) {
    const candidate = cur === '' ? word : `${cur} ${word}`;
    if (cur === '' || font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      cur = candidate;
    } else {
      out.push(cur);
      cur = word;
    }
  }
  out.push(cur);
  return out;
}

/** A4 PDF of the Podklady summary, at most a few pages; Helvetica (WinAnsi) with transliterated text. */
export async function buildPodkladyPdf(s: PodkladySummary, t: Translate): Promise<Uint8Array> {
  const lines = podkladyPdfLines(s, t);
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const footerText = lines
    .filter((l) => l.kind === 'footer')
    .map((l) => transliterate(l.text))
    .join(' ');
  const footerLines = wrapText(footerText, regular, 8, WIDTH);

  const newPage = (): PDFPage => {
    const p = doc.addPage([PAGE_W, PAGE_H]);
    footerLines.forEach((ln, i) => {
      p.drawText(ln, {
        x: MARGIN,
        y: 30 + (footerLines.length - 1 - i) * 10,
        size: 8,
        font: regular,
      });
    });
    return p;
  };
  let page = newPage();
  let y = PAGE_H - MARGIN;
  const startPage = (): void => {
    page = newPage();
    y = PAGE_H - MARGIN;
  };

  for (const line of lines) {
    if (line.kind === 'footer') continue;
    if (line.kind === 'gap') {
      y -= 8;
      continue;
    }
    const isHeading = line.kind === 'h1' || line.kind === 'h2';
    const size = isHeading ? 14 : 10;
    const font = isHeading ? bold : regular;
    const lineHeight = size * 1.4;
    if (line.kind === 'h2') y -= 6;

    const text = transliterate(line.text);
    const value = line.value !== undefined ? transliterate(line.value) : undefined;
    const valueWidth = value !== undefined ? regular.widthOfTextAtSize(value, size) : 0;
    const maxWidth = value !== undefined ? WIDTH - valueWidth - 12 : WIDTH;
    const parts = wrapText(text, font, size, maxWidth);

    parts.forEach((part, i) => {
      if (y - lineHeight < FLOOR) startPage();
      y -= lineHeight;
      page.drawText(part, { x: MARGIN, y, size, font });
      if (i === 0 && value !== undefined) {
        page.drawText(value, { x: PAGE_W - MARGIN - valueWidth, y, size, font: regular });
      }
    });
  }

  return doc.save();
}
