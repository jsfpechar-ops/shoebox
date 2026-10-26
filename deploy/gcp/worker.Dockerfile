# Reading worker image for the e2-micro VM (test env, owner decision 2026-10-26 [test-env]).
# Build from the repo root: docker build -f deploy/gcp/worker.Dockerfile .
FROM node:22-slim
WORKDIR /repo
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --prod --filter "@shoebox/worker..." && rm -rf "$(pnpm store path)"
WORKDIR /repo/apps/worker
ENV NODE_ENV=production PORT=8081
USER node
# node directly: a pnpm wrapper costs ~100 MB of memory.
CMD ["node", "--import", "tsx", "src/main.ts"]
