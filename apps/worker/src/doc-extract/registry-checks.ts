import type { ProtoExtraction } from '@shoebox/extraction';
import {
  type CrpdphClient,
  type CrpdphPublishedAccount,
  type CrpdphSubject,
  createCrpdphClient,
  createViesClient,
  type ViesClient,
} from '@shoebox/registries';
import { czAccountToIban, ibanValid, type ValidationRow } from '@shoebox/validation';

export interface RegistryDeps {
  readonly crpdph: CrpdphClient;
  readonly vies: ViesClient;
}

/** Real registry clients with the 3000 ms timeout of 06 §2.2. */
export function defaultRegistryDeps(): RegistryDeps {
  return {
    crpdph: createCrpdphClient({ timeoutMs: 3000 }),
    vies: createViesClient({ timeoutMs: 3000 }),
  };
}

interface RegistryOrg {
  readonly ico: string | null;
  readonly dic: string | null;
}

const CZ_DIC_RE = /^CZ(\d{8,10})$/;
const FOREIGN_VAT_ID_RE = /^([A-Z]{2})([0-9A-Z]{2,13})$/;

function warning(ruleId: string, params: Record<string, unknown>): ValidationRow {
  return { ruleId, ruleVersion: 1, severity: 'warning', params };
}

/** `19-2000145399` becomes prefix `19` and number `2000145399`; a plain number has no prefix. */
function splitAccount(accountNumber: string): { prefix: string | null; number: string } {
  const parts = accountNumber.split('-');
  if (parts.length === 2) {
    return { prefix: parts[0] ?? null, number: parts[1] ?? '' };
  }
  return { prefix: null, number: accountNumber };
}

/** The IBAN the payer would pay to: the printed one when valid, else built from the account. */
function ibanToPay(x: ProtoExtraction): string | null {
  const printed = x.payment.iban ?? '';
  if (printed !== '' && ibanValid(printed)) {
    return printed.replace(/\s/g, '').toUpperCase();
  }
  const { account_number: account, bank_code: bank } = x.payment;
  if (!account || !bank) {
    return null;
  }
  const { prefix, number } = splitAccount(account);
  return czAccountToIban(prefix, number, bank);
}

function accountMatches(ucet: CrpdphPublishedAccount['ucet'], iban: string): boolean {
  if (ucet.kind === 'standard') {
    return czAccountToIban(ucet.predcisli, ucet.cislo, ucet.kodBanky) === iban;
  }
  return ucet.cislo.replace(/\s/g, '').toUpperCase() === iban;
}

async function czechRows(
  x: ProtoExtraction,
  org: RegistryOrg,
  deps: RegistryDeps,
): Promise<ValidationRow[]> {
  const supplierDic = x.supplier.dic;
  const match = supplierDic === null ? null : CZ_DIC_RE.exec(supplierDic);
  if (supplierDic === null || match === null || supplierDic === org.dic) {
    return [];
  }
  const digits = match[1] ?? '';
  let answer: Awaited<ReturnType<CrpdphClient['status']>>;
  try {
    answer = await deps.crpdph.status([digits]);
  } catch {
    return [];
  }
  if (answer.status !== 'ok') {
    return [];
  }
  const subject: CrpdphSubject | undefined = answer.data.subjects.find((s) => s.dic === digits);
  if (subject === undefined) {
    return [];
  }

  const rows: ValidationRow[] = [];
  if (subject.nespolehlivyPlatce === 'ANO') {
    rows.push(
      warning('PROTO_REG_UNRELIABLE', {
        dic: supplierDic,
        messageKey: 'proto.check.reg_unreliable.warn',
      }),
    );
  }
  if (subject.typSubjektu === 'NENALEZEN' && x.vat_recap.some((line) => /[1-9]/.test(line.vat))) {
    rows.push(
      warning('PROTO_REG_NOT_VAT_PAYER', {
        dic: supplierDic,
        messageKey: 'proto.check.reg_not_vat_payer.warn',
      }),
    );
  }
  if (x.payment.method === 'bank_transfer') {
    const iban = ibanToPay(x);
    const active = subject.zverejneneUcty.filter((a) => a.datumZverejneniUkonceni === null);
    if (iban !== null && active.length >= 1 && !active.some((a) => accountMatches(a.ucet, iban))) {
      rows.push(
        warning('PROTO_REG_ACCOUNT_UNPUBLISHED', {
          dic: supplierDic,
          iban,
          messageKey: 'proto.check.reg_account_unpublished.warn',
        }),
      );
    }
  }
  return rows;
}

async function vatIdRows(
  x: ProtoExtraction,
  org: RegistryOrg,
  deps: RegistryDeps,
): Promise<ValidationRow[]> {
  const vatId = x.supplier.vat_id;
  const match = vatId === null ? null : FOREIGN_VAT_ID_RE.exec(vatId);
  if (vatId === null || match === null || match[1] === 'CZ') {
    return [];
  }
  if (org.dic === null || !/^CZ\d+$/.test(org.dic)) {
    return [];
  }
  let answer: Awaited<ReturnType<ViesClient['check']>>;
  try {
    answer = await deps.vies.check(match[1] ?? '', match[2] ?? '', {
      countryCode: 'CZ',
      vatNumber: org.dic.slice(2),
    });
  } catch {
    return [];
  }
  if (answer.status === 'ok' && !answer.data.valid) {
    return [
      warning('PROTO_REG_VAT_ID_INVALID', {
        vatId,
        messageKey: 'proto.check.reg_vat_id_invalid.warn',
      }),
    ];
  }
  return [];
}

/** Warning rows from the VAT register and VIES. Never blocking; an outage or a throw adds nothing. */
export async function registryRows(
  x: ProtoExtraction,
  org: RegistryOrg,
  deps: RegistryDeps,
): Promise<ValidationRow[]> {
  const rows: ValidationRow[] = [];
  try {
    rows.push(...(await czechRows(x, org, deps)));
  } catch {
    // Registry lookups are best effort.
  }
  try {
    rows.push(...(await vatIdRows(x, org, deps)));
  } catch {
    // Registry lookups are best effort.
  }
  return rows;
}
