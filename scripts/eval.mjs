// `pnpm eval`: runs the TypeScript eval CLI through Vite's SSR module loader (an approved
// dependency), so no extra TS runner is needed. The logic lives in packages/testkit/src/eval/cli.ts.
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({
  root,
  configFile: false,
  logLevel: 'error',
  server: { middlewareMode: true, watch: null, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  ssr: { noExternal: [/^@shoebox\//] },
});
try {
  const cli = await server.ssrLoadModule('/packages/testkit/src/eval/cli.ts');
  process.exitCode = await cli.main(process.argv.slice(2));
} finally {
  await server.close();
}
