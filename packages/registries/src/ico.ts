/** IČO check (mod 11): 8 ASCII digits, the 8th is the check digit of the first seven. */
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2] as const;

export function isValidIco(value: string): boolean {
  if (!/^[0-9]{8}$/.test(value)) return false;
  const digits = value.split('').map(Number);
  let sum = 0;
  for (let i = 0; i < WEIGHTS.length; i++) {
    sum += (digits[i] ?? 0) * (WEIGHTS[i] ?? 0);
  }
  const r = sum % 11;
  const check = r === 0 ? 1 : r === 1 ? 0 : 11 - r;
  return check === digits[7];
}
