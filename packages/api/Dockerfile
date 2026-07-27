# syntax=docker/dockerfile:1.7
# =============================================================================
# Stage 1: Builder — install deps, build the TanStack Start static client, then
#          bundle the API to a single self-contained dist/index.js.
# =============================================================================
FROM oven/bun:1.3.14 AS builder
WORKDIR /app

COPY package.json bun.lock* ./
COPY packages/api/package.json ./packages/api/
COPY packages/web/package.json ./packages/web/
COPY packages/shared/package.json ./packages/shared/
# --ignore-scripts: skip the root "prepare" (lefthook install), which needs git and
# only matters for local dev. No dep here relies on a postinstall at build time.
RUN bun install --frozen-lockfile --ignore-scripts

COPY packages/shared ./packages/shared
COPY packages/api ./packages/api
COPY packages/web ./packages/web

# Browser telemetry is compiled into the static client only when configured.
ARG VITE_SENTRY_DSN
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN

WORKDIR /app/packages/shared
RUN bun run typecheck

WORKDIR /app/packages/web
RUN bun run build

WORKDIR /app/packages/api
RUN bun run build

# =============================================================================
# Stage 2: Runtime — Bun + API bundle + SPA static files.
#          Includes ca-certificates and ffmpeg (yt-dlp binary is self-contained).
# =============================================================================
FROM oven/bun:1.3.14-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates ffmpeg \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/packages/api/dist/index.js ./index.js
COPY --from=builder /app/packages/web/dist/client ./public

ENV NODE_ENV=production
ENV PORT=3001
ENV YTDLP_DIR=/data/yt-dlp

EXPOSE 3001

CMD ["bun", "run", "index.js"]
