import { t } from '@shoebox/i18n';
import Link from 'next/link';
import {
  type AssetRowModel,
  assetsBlock,
  type CategoryGroup,
  comparisonBlock,
  pausalniBlock,
} from './summary-blocks';

const card = 'grid gap-3 rounded-card border border-border bg-card p-6 text-foreground';

export function CategoryBlocks({ groups }: { groups: CategoryGroup[] }) {
  if (groups.length === 0) return null;
  return (
    <section className={card}>
      <h2 className="text-body font-semibold">{t('podklady.section.categories')}</h2>
      {groups.map((group) => (
        <div key={group.title} className="grid gap-2">
          <h3 className="text-body font-semibold">{group.title}</h3>
          {group.rows.map((row) => (
            <details key={row.label} className="text-body">
              <summary className="min-h-11 cursor-pointer">
                {[row.label, row.amount, t('podklady.documents_count', { count: row.count })].join(
                  ' · ',
                )}
              </summary>
              <ul className="grid gap-1 pl-4">
                {row.entries.map((e) => (
                  <li key={e.key}>
                    <Link href={`/inbox/${e.documentId}`} className="underline">
                      {[e.date, e.amount].filter((x) => x !== null).join(' · ') || e.documentId}
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      ))}
    </section>
  );
}

export function ComparisonBlock({ summary }: { summary: unknown }) {
  const model = comparisonBlock(summary);
  if (model === null) return null;
  return (
    <section className={card}>
      <h2 className="text-body font-semibold">{t('podklady.section.comparison')}</h2>
      <p className="text-body">{model.text}</p>
      {model.cap !== null ? <p className="text-body">{model.cap}</p> : null}
      {model.caveats.length > 0 ? (
        <ul className="grid gap-1 text-body">
          {model.caveats.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function PausalniBlock({ summary }: { summary: unknown }) {
  const model = pausalniBlock(summary);
  if (model === null) return null;
  return (
    <section className={card}>
      <h2 className="text-body font-semibold">{t('podklady.section.pausalni_dan')}</h2>
      <ul className="grid gap-1 text-body">
        {model.lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {model.warnings.length > 0 ? (
        <ul className="grid gap-1 text-body">
          {model.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function AssetTable({ caption, rows }: { caption: string; rows: AssetRowModel[] }) {
  if (rows.length === 0) return null;
  return (
    <table className="w-full text-body">
      <caption className="text-left font-semibold">{caption}</caption>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <th scope="row" className="text-left font-normal">
              {r.title}
            </th>
            <td>{r.date}</td>
            <td className="num text-right">{r.price}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function AssetsBlock({ summary }: { summary: unknown }) {
  const m = assetsBlock(summary);
  const empty =
    m.assets.length === 0 && m.small.length === 0 && m.personal === null && m.shares.length === 0;
  if (empty) return null;
  return (
    <section className={card}>
      <h2 className="text-body font-semibold">{t('podklady.section.assets')}</h2>
      <AssetTable caption={t('podklady.assets.list')} rows={m.assets} />
      <AssetTable caption={t('podklady.assets.small')} rows={m.small} />
      <p className="text-body">{m.note}</p>
      {m.shares.length > 0 ? (
        <table className="w-full text-body">
          <caption className="text-left font-semibold">{t('podklady.private.shares')}</caption>
          <tbody>
            {m.shares.map((s) => (
              <tr key={s.key}>
                <th scope="row" className="text-left font-normal">
                  {s.description}
                </th>
                <td className="num text-right">{s.total}</td>
                <td className="num text-right">{`${s.pct} %`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {m.personal !== null ? <p className="text-body">{m.personal}</p> : null}
    </section>
  );
}
