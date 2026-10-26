# 0415: Settings lists the suppliers Sysel remembers, with "Forget"

Status: todo
Ticket: lane D, M04 §4.7 vendor memory (lane C PR #25 route) | Depends on: none | Branch: claude/project-thread-yn56ih | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 25 tool calls, 50k tokens

## 1. Objective

Settings gets a card "Suppliers Sysel remembers": each supplier with the category Sysel now picks for it on its own. An owner or member can press "Forget". Sysel then drops that memory and sorts the supplier's open documents again. This is the way out when Sysel learned something wrong.

## 2. Context

- Route (lane C): `DELETE /api/vendor-profiles/{id}/memory?reprocess=true` → `{ reset: true, reprocessed: n }`; 403 on a foreign origin or wrong role, 404 when unknown. The browser sends the right `Origin` itself.
- `vendor_profiles` (0004): `id, org_id, partner_id → partners(name), default_category_code → categories(code, label_en), confirmations, pinned, last_confirmed_at`. RLS scopes reads to the org; still filter by `org_id` (hard rule 3).
- Settings page `apps/web/app/(app)/nastaveni/page.tsx` has a `Row` helper and cards; another lane added a bank card, so keep your edit additive. `auth.role` is on the `requireActiveRole` result.

## 3. Files

| Path | Action |
|---|---|
| `apps/web/src/settings/vendor-memory-data.ts` | new (below) |
| `apps/web/test/vendor-memory-data.test.ts` | new (below) |
| `apps/web/src/settings/forget-vendor-button.tsx` | new (below) |
| `apps/web/app/(app)/nastaveni/page.tsx` | edit: one card |
| `packages/i18n/messages/en.json` | edit: keys |

## 4. Steps

1. `en.json`, after the last `settings.bank.*` key:
   ```
     "settings.vendors.title": "Suppliers Sysel remembers",
     "settings.vendors.help": "When you confirm a category for a supplier, Sysel uses it for that supplier's next documents. Press Forget if it learned something wrong.",
     "settings.vendors.none": "Nothing yet. Sysel starts remembering once you confirm a category for a supplier.",
     "settings.vendors.always": "{category} · always",
     "settings.vendors.forget": "Forget",
     "settings.vendors.forgotten": "Forgotten. Sysel is sorting this supplier's open documents again.",
     "settings.vendors.failed": "That did not work. Please try again.",
   ```
2. New `apps/web/src/settings/vendor-memory-data.ts`:
   ```ts
   import type { createSupabaseServerClient } from '../supabase/server';

   type SupabaseLike = Awaited<ReturnType<typeof createSupabaseServerClient>>;

   export const VENDOR_MEMORY_LIMIT = 50;

   export interface VendorMemoryRow {
     readonly id: string;
     readonly supplier: string;
     readonly category: string;
     readonly pinned: boolean;
   }

   const one = (value: unknown): Record<string, unknown> | null => {
     const v = Array.isArray(value) ? value[0] : value;
     return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
   };

   /** One remembered supplier, or null when the row has no category or no supplier name. */
   export function vendorMemoryRowOf(raw: Record<string, unknown>): VendorMemoryRow | null {
     const supplier = one(raw.partners)?.name;
     const category = one(raw.categories)?.label_en;
     if (typeof raw.id !== 'string' || typeof supplier !== 'string' || typeof category !== 'string')
       return null;
     return { id: raw.id, supplier, category, pinned: raw.pinned === true };
   }

   /** The org's remembered suppliers, last confirmed first; null on a read error. */
   export async function loadVendorMemory(
     supabase: SupabaseLike,
     orgId: string,
   ): Promise<VendorMemoryRow[] | null> {
     const { data, error } = await supabase
       .from('vendor_profiles')
       .select('id, pinned, partners(name), categories(label_en)')
       .eq('org_id', orgId)
       .not('default_category_code', 'is', null)
       .order('last_confirmed_at', { ascending: false, nullsFirst: false })
       .limit(VENDOR_MEMORY_LIMIT);
     if (error || !data) return null;
     return (data as Record<string, unknown>[])
       .map(vendorMemoryRowOf)
       .filter((row): row is VendorMemoryRow => row !== null);
   }
   ```
   If the typecheck rejects the `data` cast, cast through `unknown`. Test `apps/web/test/vendor-memory-data.test.ts` (do not edit):
   ```ts
   import { describe, expect, it } from 'vitest';
   import { vendorMemoryRowOf } from '../src/settings/vendor-memory-data';

   describe('vendorMemoryRowOf', () => {
     it('maps a profile with its supplier and category', () => {
       expect(
         vendorMemoryRowOf({ id: 'v1', pinned: true, partners: { name: 'Shell' }, categories: [{ label_en: 'Fuel' }] }),
       ).toEqual({ id: 'v1', supplier: 'Shell', category: 'Fuel', pinned: true });
     });
     it('skips rows without a supplier or category', () => {
       expect(vendorMemoryRowOf({ id: 'v2', partners: null, categories: { label_en: 'Fuel' } })).toBeNull();
       expect(vendorMemoryRowOf({ id: 'v3', partners: { name: 'Shell' }, categories: null })).toBeNull();
     });
   });
   ```
3. New `apps/web/src/settings/forget-vendor-button.tsx`:
   ```tsx
   'use client';

   import { t } from '@shoebox/i18n';
   import { Button } from '@shoebox/ui';
   import { useRouter } from 'next/navigation';
   import { useState } from 'react';

   /** "Forget" for one remembered supplier: resets its memory and re-sorts its open documents. */
   export function ForgetVendorButton({ id, supplier }: { id: string; supplier: string }) {
     const router = useRouter();
     const [state, setState] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle');

     async function forget() {
       setState('busy');
       try {
         const res = await fetch(`/api/vendor-profiles/${encodeURIComponent(id)}/memory?reprocess=true`, {
           method: 'DELETE',
         });
         setState(res.ok ? 'done' : 'failed');
         if (res.ok) router.refresh();
       } catch {
         setState('failed');
       }
     }

     if (state === 'done') return <p role="status" className="text-body">{t('settings.vendors.forgotten')}</p>;
     return (
       <div className="flex flex-col items-end gap-1">
         <Button
           type="button"
           variant="secondary"
           disabled={state === 'busy'}
           aria-label={`${t('settings.vendors.forget')}: ${supplier}`}
           onClick={forget}
         >
           {t('settings.vendors.forget')}
         </Button>
         {state === 'failed' ? <p role="alert" className="text-body">{t('settings.vendors.failed')}</p> : null}
       </div>
     );
   }
   ```
4. `nastaveni/page.tsx`: import `loadVendorMemory` and `ForgetVendorButton`. After the `bank` line add `const vendors = auth.ok && supabase ? await loadVendorMemory(supabase, auth.orgId) : null;` and `const canForget = auth.ok && (auth.role === 'owner' || auth.role === 'member');`. Insert this card right before the "Who has access" card:
   ```tsx
   {vendors === null ? null : (
     <Card className="flex flex-col gap-4 p-6">
       <h2 className="flex items-center gap-1 text-card-title">
         {t('settings.vendors.title')}
         <HelpTip term={t('settings.vendors.title')} text={t('settings.vendors.help')} />
       </h2>
       {vendors.length === 0 ? (
         <p className="text-body">{t('settings.vendors.none')}</p>
       ) : (
         <dl className="flex flex-col gap-4">
           {vendors.map((v) => (
             <Row key={v.id} label={v.supplier}>
               <span className="flex flex-wrap items-center justify-end gap-2">
                 {v.pinned ? t('settings.vendors.always', { category: v.category }) : v.category}
                 {canForget ? <ForgetVendorButton id={v.id} supplier={v.supplier} /> : null}
               </span>
             </Row>
           ))}
         </dl>
       )}
     </Card>
   )}
   ```
5. Checks: `pnpm --filter @shoebox/web test -- vendor-memory-data 2>&1 | tail -8`, `pnpm --filter @shoebox/web typecheck 2>&1 | tail -10`, `pnpm --filter @shoebox/i18n test 2>&1 | tail -5`, `pnpm exec biome check apps/web/src/settings "apps/web/app/(app)/nastaveni" apps/web/test/vendor-memory-data.test.ts packages/i18n 2>&1 | tail -10` (fix your files with `--write`).

## 5. Do not touch

The lane C route and `src/documents/vendor-memory.ts`, the bank card, other pages. Hard rules 3, 6.

## 6. Commands

As in step 5.

## 7. Acceptance

- [ ] vendor-memory-data tests pass; typecheck 0; i18n tests pass; biome clean.

## 8. Stop and ask

As TEMPLATE §8.

## 9. Report

`docs/tasks/0415-report.md`, 120 tokens at most. Set `Status: review`.
