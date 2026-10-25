import { fileURLToPath } from 'node:url';
import type { TestProjectInlineConfiguration } from 'vitest/config';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

/** scripts/ is not a workspace package; resolve @shoebox/* to the sources (as scripts/proto-score.mjs does). */
const SHOEBOX_ALIAS = [
  {
    find: /^@shoebox\/(domain|extraction|i18n|testkit|validation)$/,
    replacement: `${ROOT}packages/$1/src/index.ts`,
  },
];

/** Vitest projects (M12 §4.1): unit (node), db (needs local Supabase), ui (happy-dom). */
export const projects: TestProjectInlineConfiguration[] = [
  {
    resolve: { alias: SHOEBOX_ALIAS },
    test: {
      name: 'unit',
      environment: 'node',
      include: [
        'apps/*/test/**/*.test.ts',
        'packages/*/test/**/*.test.ts',
        'scripts/lint/test/**/*.test.ts',
        'scripts/test/**/*.test.ts',
      ],
      exclude: ['**/node_modules/**', 'packages/ui/**', '**/*.db.test.ts'],
    },
  },
  {
    test: {
      name: 'db',
      environment: 'node',
      include: ['packages/db/test/**/*.db.test.ts', 'apps/worker/test/**/*.db.test.ts'],
      fileParallelism: false,
    },
  },
  {
    test: {
      name: 'ui',
      environment: 'happy-dom',
      include: ['packages/ui/test/**/*.test.ts', 'packages/ui/test/**/*.test.tsx'],
    },
  },
];
