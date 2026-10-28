/** BIC codes for the bank codes we know (research §6.3 [O]; Fio 2010 [I]). */
export const BANK_BIC: Readonly<Record<string, string>> = {
  '0100': 'KOMBCZPP',
  '0300': 'CEKOCZPP',
  '0600': 'AGBACZPP',
  '0800': 'GIBACZPX',
  '2010': 'FIOBCZPP',
};

/** BIC for a bank code, or undefined when the code is not in the table. */
export function bicForBankCode(code: string): string | undefined {
  return BANK_BIC[code];
}
