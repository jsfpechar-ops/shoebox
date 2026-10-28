import { CZK, Money } from '@shoebox/domain';
import { czAccountToIban } from '@shoebox/validation';
import { type PayToAccount, payToIban } from './account';
import { bicForBankCode } from './bic';

export type CheckSeverity = 'ok' | 'info' | 'warning' | 'blocking';
export type CheckCode =
  | 'ALREADY_PAID'
  | 'NO_ACCOUNT'
  | 'ACCOUNT_INVALID'
  | 'UNRELIABLE_PAYER'
  | 'ACCOUNT_NOT_PUBLISHED'
  | 'ACCOUNT_CHANGED'
  | 'REGISTRY_UNAVAILABLE'
  | 'FOREIGN_CURRENCY'
  | 'REGISTRY_OK';

export interface PaymentCheck {
  readonly code: CheckCode;
  readonly severity: CheckSeverity;
}

export type RegistryLookup =
  | {
      readonly status: 'ok';
      readonly fetchedAt: string;
      readonly subject: {
        readonly unreliable: boolean;
        readonly vatPayer: boolean;
        readonly publishedIbans: readonly string[];
      } | null;
    }
  | { readonly status: 'unavailable' }
  | { readonly status: 'skipped' };

/** Structural mirror of @shoebox/registries CrpdphSubject (no package dependency). */
export interface CrpdphSubjectLike {
  readonly nespolehlivyPlatce: 'ANO' | 'NE' | 'NENALEZEN';
  readonly typSubjektu: string;
  readonly zverejneneUcty: readonly {
    readonly datumZverejneniUkonceni: string | null;
    readonly ucet:
      | { kind: 'standard'; predcisli: string | null; cislo: string; kodBanky: string }
      | { kind: 'nonstandard'; cislo: string };
  }[];
}

/** Active published accounts only (no end date); standard → czAccountToIban (skip nulls), nonstandard → cislo without spaces, upper. */
export function toRegistryLookup(
  subject: CrpdphSubjectLike | undefined,
  fetchedAt: string,
): RegistryLookup {
  if (subject === undefined) return { status: 'ok', fetchedAt, subject: null };
  const publishedIbans: string[] = [];
  for (const u of subject.zverejneneUcty) {
    if (u.datumZverejneniUkonceni !== null) continue;
    if (u.ucet.kind === 'standard') {
      const iban = czAccountToIban(u.ucet.predcisli, u.ucet.cislo, u.ucet.kodBanky);
      if (iban !== null) publishedIbans.push(iban);
    } else {
      publishedIbans.push(u.ucet.cislo.replace(/\s+/g, '').toUpperCase());
    }
  }
  return {
    status: 'ok',
    fetchedAt,
    subject: {
      unreliable: subject.nespolehlivyPlatce === 'ANO',
      vatPayer: subject.typSubjektu === 'PLATCE_DPH',
      publishedIbans,
    },
  };
}

export interface PrePaymentInput {
  readonly paidAt: string | null;
  readonly openAmount: Money;
  readonly totalGross: Money;
  readonly payTo: PayToAccount | null;
  readonly orgVatStatus: 'neplatce' | 'identifikovana_osoba' | 'platce';
  readonly registry: RegistryLookup;
  readonly earlierIbans: readonly string[];
  readonly thresholdCzk: number;
  readonly toleranceCzk: string;
}

export interface PrePaymentResult {
  readonly checks: readonly PaymentCheck[];
  readonly blocking: boolean;
  readonly iban: string | null;
  readonly bic: string | undefined;
  readonly qrAllowed: boolean;
}

export function prePaymentChecks(i: PrePaymentInput): PrePaymentResult {
  const checks: PaymentCheck[] = [];
  if (i.openAmount.currency !== 'CZK') checks.push({ code: 'FOREIGN_CURRENCY', severity: 'info' });
  const paid =
    i.paidAt !== null ||
    i.openAmount.compare(Money.parse(i.toleranceCzk, i.openAmount.currency)) <= 0;
  if (paid) checks.push({ code: 'ALREADY_PAID', severity: 'blocking' });
  const account = payToIban(i.payTo);
  const iban = account.kind === 'ok' ? account.iban : null;
  if (account.kind === 'none') checks.push({ code: 'NO_ACCOUNT', severity: 'blocking' });
  if (account.kind === 'invalid') checks.push({ code: 'ACCOUNT_INVALID', severity: 'blocking' });
  if (i.registry.status === 'unavailable')
    checks.push({ code: 'REGISTRY_UNAVAILABLE', severity: 'warning' });
  const subject = i.registry.status === 'ok' ? i.registry.subject : null;
  if (subject?.unreliable) {
    checks.push({
      code: 'UNRELIABLE_PAYER',
      severity: i.orgVatStatus === 'platce' ? 'blocking' : 'warning',
    });
  }
  const notPublished =
    subject?.vatPayer === true &&
    i.orgVatStatus === 'platce' &&
    iban !== null &&
    !subject.publishedIbans.includes(iban);
  if (notPublished) {
    // TODO(decision-TA-16): compare the total incl. VAT (22 §A default).
    const overThreshold =
      i.totalGross.currency === 'CZK' &&
      i.totalGross.compare(Money.parse(`${i.thresholdCzk}.00`, CZK)) > 0;
    checks.push({
      code: 'ACCOUNT_NOT_PUBLISHED',
      severity: overThreshold ? 'blocking' : 'warning',
    });
  }
  if (
    subject?.vatPayer &&
    !subject.unreliable &&
    iban !== null &&
    subject.publishedIbans.includes(iban)
  ) {
    checks.push({ code: 'REGISTRY_OK', severity: 'ok' });
  }
  if (iban !== null && i.earlierIbans.length > 0 && !i.earlierIbans.includes(iban)) {
    checks.push({ code: 'ACCOUNT_CHANGED', severity: 'warning' });
  }
  const blocking = checks.some((c) => c.severity === 'blocking');
  return {
    checks,
    blocking,
    iban,
    bic: account.kind === 'ok' ? bicForBankCode(account.bankCode) : undefined,
    qrAllowed: !blocking && iban !== null && i.openAmount.currency === 'CZK',
  };
}
