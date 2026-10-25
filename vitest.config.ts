import { defineConfig } from 'vitest/config';
import { projects } from './vitest.workspace';

export default defineConfig({
  test: {
    projects,
    // Coverage is read only from the root config (M12 §4.3). Gated packages fail CI below
    // their line threshold; every other package is report-only.
    coverage: {
      provider: 'v8',
      include: ['apps/*/src/**/*.{ts,tsx}', 'packages/*/src/**/*.{ts,tsx}'],
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: 'coverage',
      thresholds: {
        'packages/domain/src/**': { lines: 90 },
        'packages/validation/src/**': { lines: 90 },
        'packages/tax-xml/src/**': { lines: 85 },
      },
    },
  },
});
