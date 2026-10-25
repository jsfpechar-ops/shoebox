import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Import boundaries (M12 §4.1, AC-4): .dependency-cruiser.cjs. Each case writes fixture modules
 * at the real paths the rules cover, cruises them with the repo config, and removes them again.
 */
const root = fileURLToPath(new URL('../../..', import.meta.url));
const depcruise = join(root, 'node_modules', '.bin', 'depcruise');

type Violation = { from: string; to: string; rule: { name: string; severity: string } };

function cruise(files: Record<string, string>, entry: string): string[] {
  for (const [rel, content] of Object.entries(files)) {
    writeFileSync(join(root, rel), content);
  }
  let stdout = '';
  try {
    stdout = execFileSync(
      depcruise,
      ['--config', '.dependency-cruiser.cjs', '--output-type', 'json', entry],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
  } catch (error) {
    stdout = String((error as { stdout?: string }).stdout ?? '');
  } finally {
    for (const rel of Object.keys(files)) {
      rmSync(join(root, rel), { force: true });
    }
  }
  const parsed = JSON.parse(stdout) as { summary: { violations: Violation[] } };
  return parsed.summary.violations.map((v) => `${v.rule.name}: ${v.from} -> ${v.to}`);
}

describe('domain-is-pure (AC-4)', () => {
  it('fails when packages/domain imports node:fs', () => {
    const entry = 'packages/domain/src/__depcruise-fixture-fs.ts';
    const violations = cruise({ [entry]: "import 'node:fs';\nexport const a = 1;\n" }, entry);
    expect(violations).toEqual([`domain-is-pure: ${entry} -> fs`]);
  });

  it('fails when packages/domain imports packages/db', () => {
    const entry = 'packages/domain/src/__depcruise-fixture-db.ts';
    const violations = cruise(
      {
        [entry]:
          "import { packageName } from '../../db/src/index.ts';\nexport const b = packageName;\n",
      },
      entry,
    );
    expect(violations).toEqual([`domain-is-pure: ${entry} -> packages/db/src/index.ts`]);
  });

  it('passes when packages/domain imports itself', () => {
    const entry = 'packages/domain/src/__depcruise-fixture-self.ts';
    const violations = cruise(
      { [entry]: "import { packageName } from './index.ts';\nexport const c = packageName;\n" },
      entry,
    );
    expect(violations).toEqual([]);
  });
});

describe('no-cross-internals', () => {
  it('fails on a deep import of another package', () => {
    const entry = 'packages/pipeline/src/__depcruise-fixture-deep.ts';
    const internal = 'packages/db/src/__depcruise-fixture-internal.ts';
    const violations = cruise(
      {
        [internal]: 'export const internal = 1;\n',
        [entry]:
          "import { internal } from '../../db/src/__depcruise-fixture-internal.ts';\nexport const d = internal;\n",
      },
      entry,
    );
    expect(violations).toEqual([`no-cross-internals: ${entry} -> ${internal}`]);
  });

  it('passes an import through the package entry point', () => {
    const entry = 'packages/pipeline/src/__depcruise-fixture-entry.ts';
    const violations = cruise(
      {
        [entry]:
          "import { packageName } from '../../db/src/index.ts';\nexport const e = packageName;\n",
      },
      entry,
    );
    expect(violations).toEqual([]);
  });
});

describe('apps-are-leaves', () => {
  it('fails when a package imports an app', () => {
    const entry = 'packages/platform/src/__depcruise-fixture-app.ts';
    const violations = cruise(
      {
        [entry]:
          "import { packageName } from '../../../apps/web/src/index.ts';\nexport const f = packageName;\n",
      },
      entry,
    );
    expect(violations).toEqual([`apps-are-leaves: ${entry} -> apps/web/src/index.ts`]);
  });

  it('passes when an app imports a package', () => {
    const entry = 'apps/web/src/__depcruise-fixture-pkg.ts';
    const violations = cruise(
      {
        [entry]:
          "import { packageName } from '../../../packages/domain/src/index.ts';\nexport const g = packageName;\n",
      },
      entry,
    );
    expect(violations).toEqual([]);
  });
});

describe('ui-no-server', () => {
  it('fails when packages/ui imports packages/db', () => {
    const entry = 'packages/ui/src/__depcruise-fixture-db.ts';
    const violations = cruise(
      {
        [entry]:
          "import { packageName } from '../../db/src/index.ts';\nexport const h = packageName;\n",
      },
      entry,
    );
    expect(violations).toEqual([`ui-no-server: ${entry} -> packages/db/src/index.ts`]);
  });

  it('passes when packages/ui imports packages/domain', () => {
    const entry = 'packages/ui/src/__depcruise-fixture-domain.ts';
    const violations = cruise(
      {
        [entry]:
          "import { packageName } from '../../domain/src/index.ts';\nexport const i = packageName;\n",
      },
      entry,
    );
    expect(violations).toEqual([]);
  });
});

describe('no-circular', () => {
  it('fails on an import cycle', () => {
    const a = 'packages/domain/src/__depcruise-fixture-a.ts';
    const b = 'packages/domain/src/__depcruise-fixture-b.ts';
    const violations = cruise(
      {
        [a]: "import { y } from './__depcruise-fixture-b.ts';\nexport const x = y;\n",
        [b]: "import { x } from './__depcruise-fixture-a.ts';\nexport const y = x;\n",
      },
      a,
    );
    expect(violations.some((v) => v.startsWith('no-circular: '))).toBe(true);
  });
});
