# Stage 1: Install dependencies & build frontend + backend bundle
FROM oven/bun:1 AS builder

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig.json vite.config.ts tailwind.config.js postcss.config.js index.html ./
COPY protocol ./protocol
COPY backend ./backend
COPY frontend ./frontend
COPY scripts ./scripts

RUN bun run build

# Stage 2: Minimal production runtime
FROM oven/bun:1-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN mkdir -p /app/data && chown -R bun:bun /app

COPY --from=builder --chown=bun:bun /app/package.json ./package.json
COPY --from=builder --chown=bun:bun /app/dist ./dist

ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=3001 \
  MILICENT_DB_PATH=/app/data/milicent.db \
  TZ=Asia/Jakarta

USER bun

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3001/health || exit 1

CMD ["bun", "run", "dist/server.js"]
