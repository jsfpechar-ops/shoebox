// `pnpm proto:serve`: runs scripts/proto/serve.ts through Vite's SSR module loader (like eval.mjs).
// `@shoebox/*` is aliased to the package sources because scripts/ is not a workspace package.
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
  const page = await server.ssrLoadModule('/scripts/proto/serve.ts');
  process.exitCode = await page.main();
} finally {
  await server.close();
}
