// `pnpm proto:score`: runs scripts/proto/score.ts through Vite's SSR module loader (like eval.mjs),
// so no extra TS runner is needed. `@shoebox/*` is aliased to the package sources because scripts/
// is not a workspace package.
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({
  root,
  configFile: false,
  logLevel: 'error',
  server: { middlewareMode: true, watch: null, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  resolve: {
    alias: [
      {
        find: /^@shoebox\/(domain|extraction|i18n|testkit|validation)$/,
        replacement: `${root}packages/$1/src/index.ts`,
      },
    ],
  },
  ssr: { noExternal: [/^@shoebox\//] },
});
try {
  const cli = await server.ssrLoadModule('/scripts/proto/score.ts');
  process.exitCode = await cli.main(process.argv.slice(2));
} finally {
  await server.close();
}
