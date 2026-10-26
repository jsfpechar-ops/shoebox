import { CATEGORIES } from '@shoebox/domain';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/migrate';

// 0040_categories_seed: the global categories table holds exactly the 56 categories of 04 §3.1 as
// packages/domain/src/taxonomy/categories.ts defines them (brief 0301). Migrates forward only.
const DATABASE_URL = process.env.DATABASE_URL;

interface CategoryRow {
  code: string;
  direction: string;
  tax_effect: string;
  label_cs: string;
  label_en: string;
  explanation_cs: string;
  icon: string | null;
  sort: number;
  replaced_by: string | null;
  valid_from: string;
  valid_to: string | null;
}

describe.skipIf(DATABASE_URL === undefined)('0040: categories seed', () => {
  const url = DATABASE_URL ?? '';
  let sql: Sql;
  let rows: CategoryRow[];

  beforeAll(async () => {
    await runMigrations(url);
    sql = postgres(url, { max: 1, onnotice: () => undefined });
    rows = await sql<CategoryRow[]>`select code, direction, tax_effect, label_cs, label_en,
      explanation_cs, icon, sort, replaced_by, valid_from::text, valid_to::text
      from categories order by sort`;
  });

  afterAll(async () => {
    await sql?.end();
  });

  it('holds the 56 domain categories, same codes in the same order', () => {
    expect(rows.map((r) => r.code)).toEqual(CATEGORIES.map((c) => c.code));
  });

  it('tax_effect, label_en, icon, sort and validity equal the domain list; direction maps both → in', () => {
    for (const c of CATEGORIES) {
      const row = rows.find((r) => r.code === c.code);
      expect(row, c.code).toBeDefined();
      if (row === undefined) {
        continue;
      }
      expect(row.tax_effect, c.code).toBe(c.taxEffect);
      expect(row.label_en, c.code).toBe(c.labelEn);
      expect(row.icon, c.code).toBe(c.icon);
      expect(row.sort, c.code).toBe(c.sort);
      expect(row.direction, c.code).toBe(c.direction === 'both' ? 'in' : c.direction);
      expect(row.replaced_by, c.code).toBeNull();
      expect(row.valid_from, c.code).toBe('2000-01-01');
      expect(row.valid_to, c.code).toBeNull();
      // English only (owner 2026-10-25): the Czech columns carry the English label and no explanation.
      expect(row.label_cs, c.code).toBe(c.labelEn);
      expect(row.explanation_cs, c.code).toBe('');
    }
  });

  it('is re-runnable: a second insert of a seeded code is a no-op', async () => {
    const first = CATEGORIES[0];
    if (first === undefined) {
      throw new Error('no categories');
    }
    await sql`insert into categories (code, direction, tax_effect, label_cs, label_en, explanation_cs, icon, sort)
      values (${first.code}, 'in', ${first.taxEffect}, 'x', 'x', '', null, 9999)
      on conflict (code) do nothing`;
    const [row] = await sql<CategoryRow[]>`select * from categories where code = ${first.code}`;
    expect(row?.label_en).toBe(first.labelEn);
    expect(row?.sort).toBe(first.sort);
  });

  it('authenticated users can read the seed (05 §10.3 global read)', async () => {
    const count = await sql.begin(async (tx) => {
      await tx`set local role authenticated`;
      const [r] = await tx<{ n: number }[]>`select count(*)::int as n from categories`;
      return r?.n;
    });
    expect(count).toBe(CATEGORIES.length);
  });
});
