/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'M12 §4.1: no import cycles.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'domain-is-pure',
      severity: 'error',
      comment:
        'M12 §4.1: packages/domain imports only decimal.js, zod and itself (no node:*, no I/O).',
      from: { path: '^packages/domain/src/' },
      to: { pathNot: ['^packages/domain/src/', 'node_modules/(decimal\\.js|zod)/'] },
    },
    {
      name: 'no-cross-internals',
      severity: 'error',
      comment:
        'M12 §4.1: another package is imported only through its package.json exports (its src/index.ts), never deep.',
      from: { path: '^packages/([^/]+)/src/' },
      to: { path: '^packages/(?!$1/)[^/]+/src/', pathNot: '^packages/[^/]+/src/index\\.tsx?$' },
    },
    {
      name: 'apps-are-leaves',
      severity: 'error',
      comment: 'M12 §4.1: nothing imports from apps/*.',
      from: { pathNot: '^apps/' },
      to: { path: '^apps/' },
    },
    {
      name: 'apps-are-leaves-cross-app',
      severity: 'error',
      comment: 'M12 §4.1: one app never imports another app.',
      from: { path: '^apps/([^/]+)/' },
      to: { path: '^apps/(?!$1/)' },
    },
    {
      name: 'ui-no-server',
      severity: 'error',
      comment: 'M12 §4.1: packages/ui may not import db, pipeline, registries, extraction.',
      from: { path: '^packages/ui/' },
      to: { path: '^packages/(db|pipeline|registries|extraction)/' },
    },
  ],
  options: {
    doNotFollow: { path: ['node_modules'] },
    exclude: { path: ['\\.turbo/', '/dist/', '\\.next/', '/coverage/'] },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['types', 'import', 'default'],
      extensions: ['.ts', '.tsx', '.mts', '.js', '.mjs', '.json'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
