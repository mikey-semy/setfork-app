# `src/core` — доменное ядро

Чистый домен: **сущности** (`domain/entities.ts`) + **порты** (`ports.ts`).
Проведён как граница под пост-MVP порт бэкенда на **Rust** (fronт остаётся Next.js).

**Правило зависимостей:** `core/` не импортирует ничего из `features/`, `shared/`,
`app/`, Drizzle или Next. Адаптеры реализуют порты; delivery/адаптеры зависят от core.

Полное описание слоёв, ubiquitous language, Repository↔List модели и плана миграции —
в [`docs/architecture.md`](../../docs/architecture.md).

**Статус:** контракт задан (мягкая граница). Дальше `features/*` мигрируют на порты
послойно; таблица `repositories` и каталоги — вместе с их UI.
