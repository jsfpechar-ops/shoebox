/**
 * Developer-facing errors (messages are not user copy; M11 maps error names through
 * `packages/i18n` before anything reaches a screen).
 */
export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

export class InvalidCurrencyError extends MoneyError {
  readonly value: string;

  constructor(value: string) {
    super(`Invalid currency code: "${value}" (expected three upper-case letters, ISO 4217)`);
    this.name = 'InvalidCurrencyError';
    this.value = value;
  }
}

export class MoneyParseError extends MoneyError {
  readonly value: string;

  constructor(value: string) {
    super(`Invalid money amount: "${value}" (expected a decimal literal such as -1234.56)`);
    this.name = 'MoneyParseError';
    this.value = value;
  }
}

export class CurrencyMismatchError extends MoneyError {
  readonly left: string;
  readonly right: string;

  constructor(left: string, right: string) {
    super(`Currency mismatch: ${left} vs ${right}`);
    this.name = 'CurrencyMismatchError';
    this.left = left;
    this.right = right;
  }
}

export class InvalidVatRateError extends MoneyError {
  readonly value: string;

  constructor(value: string) {
    super(
      `Invalid VAT rate: "${value}" (expected a percentage literal between 0 and 100, such as 21)`,
    );
    this.name = 'InvalidVatRateError';
    this.value = value;
  }
}
