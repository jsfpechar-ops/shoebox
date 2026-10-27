import type { ProtoCheckInput, ProtoCheckResult } from './checks';

/** A check result as a `validation_results` row (pass results are dropped; `info` rows are quiet notes). */
export interface ValidationRow {
  readonly ruleId: string;
  readonly ruleVersion: number;
  readonly severity: 'blocking' | 'warning' | 'info';
  readonly params: Record<string, unknown>;
}

export function validationRowsOf(results: readonly ProtoCheckResult[]): ValidationRow[] {
  const rows: ValidationRow[] = [];
  for (const r of results) {
    if (r.severity === 'pass') {
      continue;
    }
    rows.push({
      ruleId: `PROTO_${String(r.id).toUpperCase()}`,
      ruleVersion: 1,
      severity: r.severity === 'fail' ? 'blocking' : r.severity === 'info' ? 'info' : 'warning',
      params: { ...(r.params as Record<string, unknown>), messageKey: r.key },
    });
  }
  return rows;
}

/**
 * The check input rebuilt from the current `document_fields` values (M02 key grammar), so the
 * checks can run again after a user correction. Parser issues are gone by then, so `issues` is empty.
 */
export function checkInputFromFields(
  fields: Readonly<Record<string, string>>,
  documentClass?: string,
): ProtoCheckInput {
  const v = (k: string): string | null => fields[k] ?? null;

  const recapIndexes = new Set<number>();
  for (const k of Object.keys(fields)) {
    const m = /^vat_recap\[(\d+)\]\./.exec(k);
    if (m) {
      recapIndexes.add(Number(m[1]));
    }
  }
  const vat_recap = [...recapIndexes]
    .sort((a, b) => a - b)
    .filter(
      (n) =>
        fields[`vat_recap[${n}].rate_pct`] !== undefined &&
        fields[`vat_recap[${n}].base`] !== undefined &&
        fields[`vat_recap[${n}].vat`] !== undefined,
    )
    .map((n) => ({
      rate_pct: v(`vat_recap[${n}].rate_pct`) as string,
      base: v(`vat_recap[${n}].base`) as string,
      vat: v(`vat_recap[${n}].vat`) as string,
    }));

  const hasFlags =
    fields['flags.non_vat_payer_text'] !== undefined ||
    fields['flags.reverse_charge_text'] !== undefined ||
    fields['flags.paid_text'] !== undefined;

  const input: Record<string, unknown> = {
    supplier: { ico: v('supplier.ico'), dic: v('supplier.dic'), country: v('supplier.country') },
    buyer: { ico: v('buyer.ico'), dic: v('buyer.dic') },
    dates: {
      issue_date: v('dates.issue_date'),
      duzp: v('dates.duzp'),
      due_date: v('dates.due_date'),
    },
    currency: v('currency'),
    totals: { gross: v('totals.gross'), vat: v('totals.vat'), net: v('totals.net') },
    vat_recap,
    payment: { method: v('payment.method') },
    issues: [],
  };
  if (documentClass !== undefined) {
    input.document_class = documentClass;
  }
  if (hasFlags) {
    input.flags = {
      non_vat_payer_text: fields['flags.non_vat_payer_text'] === 'true',
      reverse_charge_text: fields['flags.reverse_charge_text'] === 'true',
      paid_text: fields['flags.paid_text'] === 'true',
    };
  }
  if (fields['qr.amount'] !== undefined) {
    input.qr = { amount: v('qr.amount') };
  }
  return input as unknown as ProtoCheckInput;
}
