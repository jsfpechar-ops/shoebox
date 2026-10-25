import { defineConfig } from 'vitest/config';

// Per-package config: without it, vitest run inside the package loads the root multi-project config and finds no tests.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    // The *.db.test.ts files share one DATABASE_URL and run migrations: never in parallel.
    fileParallelism: false,
  },
});
