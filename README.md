# SetHub — runnable checklists (MVP)

Запускаемые, версионируемые чек-листы для разработчиков. Список — не статичный
док: ты **прогоняешь** его, отмечаешь шаги, он хранит прогресс и версию, а из
публичной **библиотеки** любой чек-лист можно **форкнуть** под свой стек.

Ядро ценности v0 (single-player, полезно при нуле других пользователей):

1. **Структурированный чек-лист** — упорядоченные шаги с markdown/командами/подшагами/ссылками.
2. **Прогоны (runs)** — исполняемый экземпляр шаблона: отмечаешь шаги, состояние и заметки сохраняются, прогон привязан к версии.
3. **Форк + публичная библиотека** — засеянные качественные чек-листы (деплой, инцидент, релиз, аудит…), форк под себя.
4. **Лёгкое версионирование** — у шаблона есть версии, прогон помнит, на какой версии он шёл.

Осознанно **вне MVP** (фаза v1): AI-генерация черновиков, community-trust/верификация,
PR/merge, репутация, команды/права/биллинг, интеграция с IDE.

## Стек

- **Next.js 16** (App Router) + **React 19** + TypeScript
- **Drizzle ORM** + **PostgreSQL 16**
- **Tailwind CSS** (токены дизайна в `globals.css`) + Radix-примитивы, light/dark
- **GitHub OAuth** (jose-сессии) + dev-фолбэк «войти как demo»
- Двуязычный интерфейс **EN/RU**
- Feature-Sliced Design: `src/{app, features, shared, widgets}`

Дизайн-исходник: `SetHub.dc.html` / `RunStep.dc.html` (Claude Design handoff).

## Быстрый старт

```bash
cp .env.example .env         # заполни AUTH_SECRET (openssl rand -hex 32)
npm install
npm run db:up                # поднять Postgres в docker (порт 5435)
npm run db:push              # применить схему
npm run db:seed              # засеять библиотеку (8 тем, 8 чек-листов)
npm run dev                  # http://localhost:3000
```

Без GitHub OAuth-приложения на `/login` доступен вход **«Continue as demo»** —
приложение полностью работает без внешней настройки.

Чтобы включить GitHub-вход: создай OAuth App
(callback `http://localhost:3000/api/auth/github/callback`) и заполни
`GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` в `.env`.

## Структура

```
src/
  app/                    # роуты: / (Search), /explore, /[owner]/[slug] (run), /login, /runs, /my-lists, /new
    api/auth/*            # GitHub OAuth + demo + logout
  features/
    library/              # лента, темы, детальная, создание списка
    runs/                 # прогон: старт, отметка шагов, подшаги, заметки, форк
  shared/
    db/                   # Drizzle schema + клиент
    auth/                 # jose-сессии + upsert юзера
    i18n/                 # EN/RU
    ui/, lib/             # Identicon, контролы, cn
  widgets/                # TopNav
scripts/seed.ts           # сид публичной библиотеки
```
