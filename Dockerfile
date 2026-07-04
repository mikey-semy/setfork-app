# setfork-frontend (Next.js 16, standalone output). Multi-stage: deps → build → runner.
# Цель `migrate` (drizzle-kit push) содержит devDeps+исходники — для миграции схемы.

FROM node:22-slim AS base
WORKDIR /app

# ── deps: полный установ (вкл. devDeps для сборки/миграций) ──
FROM base AS deps
# .npmrc обязателен: в нём legacy-peer-deps=true — иначе строгий `npm ci` падает на
# конфликте peer-deps (@emoji-mart/react хочет react<=18, у нас react 19).
COPY package.json package-lock.json .npmrc ./
RUN npm ci

# ── builder: сборка standalone ──
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ── migrate: применить версионные миграции к БД (one-shot перед стартом app) ──
FROM builder AS migrate
CMD ["npx", "drizzle-kit", "migrate"]

# ── runner: минимальный standalone-сервер (непривилегированный) ──
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000 HOSTNAME=0.0.0.0
# git — на случай inproc-режима git-ядра (без SETFORK_CORE_URL фронт шеллит git сам).
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
# node-образ уже содержит пользователя `node` (uid 1000); отдаём ему владение.
COPY --chown=node:node --from=builder /app/.next/standalone ./
COPY --chown=node:node --from=builder /app/.next/static ./.next/static
COPY --chown=node:node --from=builder /app/public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=4s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
