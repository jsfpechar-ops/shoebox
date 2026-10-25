import type { TaxRegime, VatStatus } from '../enums/index';
import { Money } from '../money/index';
import type { createCzRules } from '../rules/index';

export type MeterLevel = 'ok' | 'warn' | 'alert' | 'exceeded';
export type MeterId =
  | 'vat_calendar_year'
  | 'vat_immediate'
  | 'pausalni_dan_band'
  | 'pausalni_dan_eligibility'
  | 'pausalni_vydaje_cap';
/** Product config (M09 §4.4), not law. */
export const METER_RATIOS = { warn: '0.80', alert: '0.95' } as const;
/** Product config (M09 §4.4.2, Competitor C's warning). */
export const PAUSAL_BAND_WARN_CZK = '100000';

export interface MeterProfile {
  readonly vatStatus: VatStatus;
  readonly taxRegime: TaxRegime;
  readonly pausalRate: 80 | 60 | 40 | 30 | null;
  readonly pausalDanBand: 1 | 2 | 3 | null;
}

export interface LimitMeter {
  readonly id: MeterId;
  readonly current: Money;
  readonly limit: Money;
  readonly percent: number; // floor(current / limit × 100), an integer for display only
  readonly level: MeterLevel;
  readonly hint: 'set_activity_type' | null;
}

type RulesAt = ReturnType<ReturnType<typeof createCzRules>['at']>;

export function meterLevel(current: Money, limit: Money, extraWarn?: boolean): MeterLevel {
  if (current.compare(limit) > 0) return 'exceeded';
  const ratio = current.toDecimal().div(limit.toDecimal());
  if (ratio.gte(METER_RATIOS.alert)) return 'alert';
  if (ratio.gte(METER_RATIOS.warn) || extraWarn === true) return 'warn';
  return 'ok';
}

function buildMeter(
  id: MeterId,
  current: Money,
  limit: Money,
  extraWarn: boolean | undefined,
  hint: LimitMeter['hint'],
): LimitMeter {
  const percent = current.toDecimal().div(limit.toDecimal()).mul(100).floor().toNumber();
  return { id, current, limit, percent, level: meterLevel(current, limit, extraWarn), hint };
}

export function computeLimitMeters(
  profile: MeterProfile,
  totals: { readonly incomeYtd: Money; readonly turnoverYtd: Money },
  rules: RulesAt,
): LimitMeter[] {
  const meters: LimitMeter[] = [];

  if (profile.vatStatus !== 'platce') {
    const registration = rules.get('vat.registration_thresholds');
    meters.push(
      buildMeter(
        'vat_calendar_year',
        totals.turnoverYtd,
        Money.parse(String(registration.calendar_year), 'CZK'),
        undefined,
        null,
      ),
      buildMeter(
        'vat_immediate',
        totals.turnoverYtd,
        Money.parse(String(registration.immediate), 'CZK'),
        undefined,
        null,
      ),
    );
  }

  if (profile.taxRegime === 'pausalni_dan') {
    const band = profile.pausalDanBand ?? 1;
    const bands = rules.get('pausalni_dan.bands');
    const bandRow = bands.find((row) => row.band === band);
    const qualifying = (bandRow?.ceilings ?? []).filter((ceiling) => {
      const required = ceiling.requires_dominant_rate_in;
      if (required === undefined) return true;
      return profile.pausalRate !== null && required.includes(profile.pausalRate);
    });
    const ceilingValue = Math.max(...qualifying.map((ceiling) => ceiling.max_income));
    const ceiling = Money.parse(String(ceilingValue), 'CZK');
    const remaining = ceiling.subtract(totals.incomeYtd);
    const extraWarn = remaining.compare(Money.parse(PAUSAL_BAND_WARN_CZK, 'CZK')) <= 0;
    meters.push(
      buildMeter(
        'pausalni_dan_band',
        totals.incomeYtd,
        ceiling,
        extraWarn,
        profile.pausalRate === null ? 'set_activity_type' : null,
      ),
    );

    const eligibility = rules.get('pausalni_dan.eligibility');
    meters.push(
      buildMeter(
        'pausalni_dan_eligibility',
        totals.incomeYtd,
        Money.parse(String(eligibility.max_income), 'CZK'),
        undefined,
        null,
      ),
    );
  }

  if (profile.taxRegime === 'pausalni_vydaje' && profile.pausalRate !== null) {
    const caps = rules.get('pausalni_vydaje.rates_caps');
    const cap = caps[String(profile.pausalRate) as keyof typeof caps];
    if (cap !== undefined) {
      const limit = Money.parse(String(cap), 'CZK').divide(String(profile.pausalRate / 100));
      meters.push(buildMeter('pausalni_vydaje_cap', totals.incomeYtd, limit, undefined, null));
    }
  }

  return meters;
}
