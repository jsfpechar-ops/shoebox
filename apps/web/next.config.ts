import type { NextConfig } from 'next';

const config: NextConfig = {
  // Workspace packages ship TypeScript source (package.json "exports" point at src/).
  transpilePackages: ['@shoebox/db', '@shoebox/domain', '@shoebox/i18n', '@shoebox/ui'],
  // Biome lints the repo (pnpm lint); Next must not look for ESLint.
  eslint: { ignoreDuringBuilds: true },
  // Metadata is rendered in <head> for every client, never streamed: the <title> cannot vanish
  // while a server action refreshes the page (axe document-title, 07 §8).
  htmlLimitedBots: /.*/,
  poweredByHeader: false,
  reactStrictMode: true,
};

export default config;
