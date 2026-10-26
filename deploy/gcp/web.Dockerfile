# Website image for Cloud Run (test env, owner decision 2026-10-26 [test-env]). Build from the repo root:
# docker build -f deploy/gcp/web.Dockerfile .
FROM node:22-slim AS build
WORKDIR /repo
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter "@shoebox/web..." && pnpm --filter @shoebox/web build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 8080
# node directly: a pnpm wrapper costs ~100 MB of memory.
CMD ["node", "apps/web/server.js"]
