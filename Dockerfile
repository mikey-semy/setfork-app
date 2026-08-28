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
# NEXT_PUBLIC_* вшиваются в бандл ЗДЕСЬ и потом не меняются: рантайм-подстановки
# у них нет. Пока образ собирался на прод-сервере, значения брались из его .env;
# со сборкой в CI их надо передать явно — иначе аналитика и абсолютные ссылки
# уедут пустыми, причём молча.
FROM base AS builder
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_UMAMI_URL
ARG NEXT_PUBLIC_UMAMI_WEBSITE_ID
# Адреса доков и лендинга: на проде их дефолты (`docs.<хост>` и `<origin>/about`)
# и есть правильные значения, а на своём стенде — нет, поэтому демо ссылалось на
# прод. Пустая строка означает «взять дефолт из shared/site». R13 линзы 08.
ARG NEXT_PUBLIC_DOCS_URL
ARG NEXT_PUBLIC_ABOUT_URL
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_UMAMI_URL=$NEXT_PUBLIC_UMAMI_URL \
    NEXT_PUBLIC_UMAMI_WEBSITE_ID=$NEXT_PUBLIC_UMAMI_WEBSITE_ID \
    NEXT_PUBLIC_DOCS_URL=$NEXT_PUBLIC_DOCS_URL \
    NEXT_PUBLIC_ABOUT_URL=$NEXT_PUBLIC_ABOUT_URL
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ── migrate: привести БД к schema.ts (one-shot перед стартом app) ──
# ИМЕННО push, а не versioned migrate: снапшоты миграций отстали от схемы на
# месяцы (прод исторически строился ручными push) — инцидент 2026-07-21, когда
# код с новыми колонками уехал без схемы и /admin/usage лёг.
# Обёртка вместо голого push: вопрос про unique-констрейнт НЕ подавляется
# --force и возвращает exit 0 без применения схемы (инцидент демо 2026-07-22 —
# «зелёный» migrate, старая схема, регистрация 42703). Обёртка предсоздаёт
# спорные колонки и проверяет маркеры схемы после push — иначе exit 1.
FROM builder AS migrate
CMD ["npx", "tsx", "scripts/migrate-push-run.ts"]

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
# Серты НУЦ Минцифры (публичные) — доверие TLS Сбера (GigaChat). Безвредно без него.
COPY --chown=node:node --from=builder /app/certs ./certs
ENV NODE_EXTRA_CA_CERTS=/app/certs/russian-trusted-ca-bundle.pem
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=4s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
