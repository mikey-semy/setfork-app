# SetFork — списки-эталоны, которые создаёт сообщество и ИИ

SetFork — площадка для **канонических списков-инструкций**: не статичный док и не
просто чек-лист, а живой эталон, который **генерирует нейросеть**, дорабатывает
сообщество, а версии и авторство честно хранятся. Нашёл готовый — **форкнул** под
свой стек; не нашёл — **сгенерировал по запросу** (с веб-поиском); хочешь
подключить ИИ-агента — он ходит в SetFork **по MCP**.

Список — это упорядоченная последовательность **или** неупорядоченный набор шагов;
у шага есть заголовок, описание, команда, подпункты-проверки, ссылки и скриншот.

## Что умеет

**Списки и версии**
- Типы: **упорядоченный** (шаги 1..N) или **набор/чек-лист** (порядок неважен).
- Приватность **public/private** (как в GitHub), смена в danger-зоне списка.
- Версионирование: черновик правится на месте, публикация = снимок-версия; правки не плодят версии.
- Форк чужого списка (с атрибуцией), звёзды, предложения правок (PR-подобные suggestions).

**AI**
- **Генерация по запросу** через OpenRouter с **веб-поиском** (`:online`): нет совпадения в поиске → «Сгенерировать» → выбор из вариантов-кандидатов → создаётся **приватный черновик** → владелец публикует.
- **«Улучшить с ИИ»** — правка пунктов по инструкции прямо в редакторе.
- **Генерация примечания к версии** из диффа (как commit-message в Copilot).

**Редактор**
- Drag-and-drop переупорядочивание, **undo/redo** (Ctrl+Z/Shift+Z), Alt+↑/↓ для перемещения пункта.
- Скриншоты шагов (загрузка перетаскиванием).

**Поиск**
- Keyword / **semantic (pgvector)** / hybrid — режим, порог релевантности и лимит настраиваются в админке; при отсутствии эмбеддингов — откат на ключевые слова.

**Сообщество и модерация**
- Подписки (follow) + лента активности по подпискам.
- Уведомления: колокольчик с выпадашкой + страница + предпочтения.
- **ИИ-модерация** только публичного контента (таксономия MLCommons/Llama Guard S1–S14): опасное не удаляется, а не пускается в публичное; verified-бейдж; админ-панель.

**Аккаунты**
- Вход по **паролю** (scrypt) и через **GitHub OAuth**; серверные сессии с отзывом и «кто онлайн».
- Профиль: bio/локация/сайт/соцсети, аватар (drag-and-drop), удаление аккаунта = анонимизация.

**Медиа**
- S3-совместимое хранилище (MinIO локально / Selectel в проде) + **imgproxy** (подписанные webp-трансформы); настройки — в админке.

**Экспорт / печать**
- Скачать список в **Markdown / HTML**, печать → PDF (пункт не рвётся между страницами).

**MCP / API для ИИ-агентов**
- Удалённый **MCP-сервер** (`/api/mcp`, Streamable HTTP) с авторизацией персональными API-токенами.
- Инструменты: `search_lists`, `get_list`, `create_list`, `update_list` (создаёт черновик; правит только владелец).

**Учёт расхода ИИ (фундамент биллинга)**
- Каждый вызов ИИ пишется в `ai_usage` с **фактической стоимостью OpenRouter**; админ-дашборд по пользователям + свой расход в настройках.

## Стек

- **Next.js 16** (App Router) + **React 19** + TypeScript
- **Drizzle ORM** + **PostgreSQL 16** с **pgvector** (RAG-эмбеддинги, hnsw)
- **Tailwind CSS** (токены дизайна в `globals.css`) + Radix-примитивы, light/dark
- **OpenRouter** + Vercel `ai` SDK (генерация, refine, модерация, эмбеддинги)
- **imgproxy** + S3 (`@aws-sdk/client-s3`), MinIO локально
- **MCP**: `mcp-handler` + `@modelcontextprotocol/sdk`
- Авторизация: **jose**-сессии, scrypt-пароли (node crypto), GitHub OAuth
- Двуязычный интерфейс **EN/RU** (locale-JSON контент)
- Feature-Sliced Design: `src/{app, features, shared, widgets}`

## Быстрый старт

```bash
cp .env.example .env          # заполни AUTH_SECRET (openssl rand -hex 32)
npm install
npm run db:up                 # Postgres (pgvector) в docker, порт DB_PORT (по умолч. 5435)
npm run db:init               # схема + расширения + канон поиска (чистая БД одной командой)
npm run db:seed               # засеять публичную библиотеку (темы + списки)
npm run dev                   # http://localhost:3000
```

Без внешней настройки на `/login` работает вход **«Continue as demo»** — приложение
полностью функционально. Опционально:

- **AI** — задай `OPENROUTER_API_KEY` в `.env` **или** прямо в `/admin` (ключ хранится в БД, на клиент не уходит). Без ключа генерация/refine/семантика выключены (откат на keyword-поиск).
- **GitHub-вход** — OAuth App (callback `…/api/auth/github/callback`) + `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`.
- **Медиа** — S3/imgproxy настраиваются в `/admin` (перекрывают `.env`); без них аватары/скриншоты падают на локальный диск.

Админ-доступ (`/admin`) — по хэндлам из env `ADMIN_HANDLES` (по умолчанию `demo`).

## Подключение ИИ-агента (MCP)

1. Настройки → **«API и MCP-доступ»** → создай токен (показывается один раз).
2. В ИИ-клиенте добавь удалённый MCP-сервер: URL `http://<host>/api/mcp`, заголовок `Authorization: Bearer sf_…`.

## Структура

```
src/
  app/
    explore/                 # лента + поиск
    generate/  generate/[id] # AI-генерация: запрос → выбор варианта
    new/                     # создание списка (типы, редактор)
    [handle]/                # профиль
    [handle]/[slug]/         # список: overview / edit / versions / suggest(ions) / settings / export
    admin/                   # AI/медиа/поиск + moderation + usage
    api/[transport]/         # MCP-сервер (Streamable HTTP)
    api/auth/*               # GitHub OAuth + demo + logout
  features/
    library/                 # лента, карточки, редактор (DnD/undo/redo), refine, change-note, экспорт
    generation/              # генерация: кандидаты, экран выбора, «Underpants Gnomes»-заглушка
    moderation/ follows/ notifications/ sessions/ settings/ profile/ auth/
    mcp/                     # инструменты + API-токены
    admin/                   # настройки ИИ/медиа/поиска, reindex, usage
  shared/
    db/                      # Drizzle schema + клиент (pgvector)
    ai/                      # generate/refine/note, moderate, embeddings, usage(биллинг), models, rate-limit
    auth/                    # jose-сессии, scrypt-пароли, api-token
    media/                   # S3 + imgproxy (avatarSrc/imageUrl)
    settings/                # AI/media/search — key-value в app_settings
    i18n/  ui/  lib/
  widgets/                   # TopNav, Dashboard
scripts/seed.ts              # сид публичной библиотеки
```

---

## For developers (English)

SetFork is an open-source platform for **canonical, runnable checklists**: lists that an
AI drafts, the community refines, and whose versions and authorship are kept honestly in
git. This repository is the web application — Next.js and TypeScript, with Postgres
behind it. Git itself is owned by a separate Rust service,
[`setfork-core`](https://github.com/mikey-semy/setfork-core).

Licensed under **AGPL-3.0-only** — see [LICENSE](LICENSE). Section 13 applies to network
use: if you run a modified version as a service, its users must be able to obtain the
source.

```sh
npm ci
cp .env.example .env
npm run itest:env     # Postgres in Docker
npm run db:push       # schema (not the migration files — see CONTRIBUTING)
npm run db:seed
npm run dev
```

Most of the application runs without the Rust core; anything touching git — versions,
diffs, branches, suggestions — does not.

- [CONTRIBUTING.md](CONTRIBUTING.md) — how to propose a change, the AI policy, DCO, and
  the architecture guards you will meet
- [SECURITY.md](SECURITY.md) — how to report a vulnerability (not as a public issue)
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

The project is maintained by one person and pull requests are reviewed about once a
week. That is a promise of an answer, not of speed.
