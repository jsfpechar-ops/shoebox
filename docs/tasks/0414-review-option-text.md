# 0414: Review deck shows an option's own text

Status: todo
Ticket: lane D, review deck (lane C category questions) | Depends on: none | Branch: claude/project-thread-yn56ih | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 15 tool calls, 30k tokens

## 1. Objective

Category questions from lane C (kinds `which_category`, `relearn_vendor`) send options with the generic label key `categorize.option.category` plus a `text` field holding the category's English name. The review deck shows `text` when it is present, otherwise the translated label.

## 2. Context

- `apps/web/src/documents/review-deck.ts`: `QuestionPayload`, `parseQuestionPayload`.
- `apps/web/src/documents/review-card.tsx`: renders `t(option.label)` twice (the button, and `review.suggested`).

## 3. Files

| Path | Action |
|---|---|
| `apps/web/src/documents/review-deck.ts` | edit |
| `apps/web/src/documents/review-card.tsx` | edit |
| `apps/web/test/review-deck.test.ts` | edit: add one test (below) |

## 4. Steps

1. `review-deck.ts`:
   - Option type in `QuestionPayload` becomes `{ value: string; label: MessageKey; text?: string }`; the local `options` array in `parseQuestionPayload` uses the same type.
   - In the loop: `options.push(typeof option.text === 'string' && option.text.trim() !== '' ? { value: option.value, label: option.label as MessageKey, text: option.text.trim() } : { value: option.value, label: option.label as MessageKey });` (no `text` key when absent, so existing tests stay equal).
   - Add `import { type MessageKey, t } from '@shoebox/i18n';` (replace the type-only import) and export:
     ```ts
     /** What an option button says: its own text (category names from M04) or the translated label. */
     export function optionText(option: { label: MessageKey; text?: string }): string {
       return option.text ?? t(option.label);
     }
     ```
   - Extend the doc comment of `parseQuestionPayload` with `; an option may carry a non-empty string text`.
2. `review-card.tsx`: replace `t(option.label)` with `optionText(option)` and `t(suggestedOption.label)` with `optionText(suggestedOption)`; import `optionText` from `./review-deck` (merge into the existing import from that file if there is one).
3. Append to `apps/web/test/review-deck.test.ts` (import `optionText` in the existing import line from `../src/documents/review-deck`):
   ```ts
   describe('option text', () => {
     it('keeps a category name and shows it instead of the label', () => {
       const parsed = parseQuestionPayload({
         question: 'question.which_category',
         options: [
           { value: 'c1', label: 'categorize.option.category', text: ' Fuel ' },
           { value: 'c2', label: 'categorize.option.category', text: '' },
         ],
       });
       expect(parsed?.options[0]).toEqual({ value: 'c1', label: 'categorize.option.category', text: 'Fuel' });
       expect(parsed?.options[1]).toEqual({ value: 'c2', label: 'categorize.option.category' });
       expect(optionText({ label: 'categorize.option.category' as never, text: 'Fuel' })).toBe('Fuel');
     });
   });
   ```
4. `pnpm --filter @shoebox/web test -- review-deck 2>&1 | tail -8`, `pnpm --filter @shoebox/web typecheck 2>&1 | tail -10`, `pnpm exec biome check apps/web/src/documents apps/web/test/review-deck.test.ts 2>&1 | tail -8` (fix your files with `--write`).

## 5. Do not touch

Other files. Hard rule 6.

## 6. Commands

As in step 4.

## 7. Acceptance

- [ ] review-deck tests pass; typecheck 0; biome clean.

## 8. Stop and ask

As TEMPLATE §8.

## 9. Report

`docs/tasks/0414-report.md`, 100 tokens at most. Set `Status: review`.
