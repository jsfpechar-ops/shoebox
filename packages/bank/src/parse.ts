import { type DetectionResult, decodeText } from './detect';
import { parseCamt053 } from './parsers/camt053';
import { type GpcProfile, parseGpc } from './parsers/gpc';
import { parseMt940 } from './parsers/mt940';
import type { ParsedStatement } from './types';

export class StatementFormatNeededError extends Error {
  readonly code = 'bank.import.format_needed';
}

/** Decodes with detection.encoding and calls the parser of detection.format; any other format throws StatementFormatNeededError. */
export function parseStatement(
  bytes: Uint8Array,
  detection: DetectionResult,
  options?: { currency?: string; gpcProfile?: GpcProfile },
): ParsedStatement {
  const text = decodeText(bytes, detection.encoding);
  const currencyOpt = options?.currency === undefined ? {} : { currency: options.currency };
  switch (detection.format) {
    case 'gpc': {
      const profile = options?.gpcProfile;
      return parseGpc(text, {
        ...currencyOpt,
        ...(profile === undefined ? {} : { profile }),
      });
    }
    case 'camt053':
      return parseCamt053(text, currencyOpt);
    case 'mt940':
      return parseMt940(text, currencyOpt);
    default:
      throw new StatementFormatNeededError();
  }
}
