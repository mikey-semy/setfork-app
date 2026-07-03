# setfork-frontend (Next.js 16, standalone output). Multi-stage: deps → build → runner.
# Цель `migrate` (drizzle-kit push) содержит devDeps+исходники — для миграции схемы.

FROM node:22-slim AS base
WORKDIR /app

# ── deps: полный установ (вкл. devDeps для сборки/миграций) ──
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ── builder: сборка standalone ──
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ── migrate: drizzle-kit push (применить схему к БД); запускается как one-shot ──
FROM builder AS migrate
CMD ["npx", "drizzle-kit", "push"]

# ── runner: минимальный standalone-сервер ──
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000 HOSTNAME=0.0.0.0
# git — на случай inproc-режима git-ядра (без SETFORK_CORE_URL фронт шеллит git сам).
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
