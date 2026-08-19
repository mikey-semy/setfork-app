# Architecture & the domain boundary

Цель: провести **чистую границу домена** уже сейчас (мягко, без миграций БД), чтобы
пост-MVP **порт бэкенда на Rust** был механическим переносом, а не переписыванием.
Фронт остаётся Next.js (презентация + тонкий BFF); домен/данные/git/поиск/AI — уезжают
за Rust-API.

## Слои (ports & adapters / гексагональная)

```
delivery   Next.js: страницы, роуты, server actions  ─┐
                                                        │ зависят от core
adapters   Drizzle · git (shell → потом gix/git2) ·    │ (типы + порты)
           pgvector-поиск · OpenRouter · imgproxy      │
                                                        │
core       ДОМЕН: сущности (pure types) + порты        │  ← ни от чего не зависит
           (интерфейсы инфраструктуры)  ────────────────┘
```

Правило зависимостей: **`core/` не импортирует ничего** из `features/`, `shared/`,
`app/`, Drizzle или Next. Адаптеры реализуют порты. Delivery и адаптеры зависят от core,
не наоборот.

## Ubiquitous language (аггрегаты)

- **Repository** — git-единица и контейнер, держит **1..N Lists**. Один список = solo-repo
  (пользователь видит просто «список»); несколько = **каталог**. `git clone` тянет
  репозиторий целиком.
- **List** — единица **контента и курирования** (звёзды/форк/verified/issues/поиск — по
  списку), живёт внутри Repository по пути `lists/<slug>/list.json`. Идентичность =
  `repository + path`.
- **Version** — иммутабельный снимок List = git-коммит + тег `vN`.
- **Step** — узел контента версии (title/desc/command/level/why/section/subtasks/refs/image).
- **Issue** / **IssueComment**, **Suggestion** (PR-аналог) / **SuggestionComment**.
- **Курирование**: **Star**, **Watch**, **Follow**, **Contributor**.
- **User**, **ApiToken**, **Notification**, **AiUsage**.

### Repository ↔ List — стадийность
- **Домен-модель сейчас:** `Repository(1..N Lists)` уже заложена в типах.
- **Реальность БД сейчас:** таблицы `repositories` нет; каждый List = свой git-репо.
  Адаптер выдаёт синтетический **solo-Repository** на каждый List.
- **С UI каталогов:** вводим таблицу `repositories` (+ `repositoryId`/`path` у List),
  мультисписочные репо, «скачать репозиторий архивом (ZIP)» ручным действием.
- **Форк/clone:** форк **списка** → копия списка (в дефолт-репо или новый solo-repo);
  форк **каталога** → копия всего репозитория.

## Порты (контракты инфраструктуры) — `src/core/ports.ts`

- **ListStore** — чтение/запись списков, версий, шагов; лента/фид.
- **CurationStore** — stars/forks/watch/follow/verified/counts.
- **CollabStore** — issues, suggestions, comments.
- **GitStore** — `ensureRepo`, upload-pack (clone/pull), receive-pack (push), bundle,
  проекция коммита ↔ версии. Адаптер сейчас: shell в `git` + персистентные bare-репо.
  **Позже (Rust): gix для чтения, `git2`/libgit2 для записи** (серверный receive-pack в
  gix пока моложе). За портом свапается без боли.
- **SearchIndex** — keyword + semantic (pgvector).
- **AiPort** — генерация/refine/embeddings + учёт стоимости.
- **Notifier** — уведомления/подписки.
- **Clock / IdGen** — детерминизм и тестируемость (без `Date.now()`/random в домене).

## Rust-seam: что переехало, что осталось

> Сверено 19.08.2026. Ядро (`setfork-core`) — УЖЕ НЕ ПЛАН: оно в проде, ходит по gRPC на
> `setfork-core:50051`, и интеграционные тесты фронта поднимают его настоящим образом.
> Столбец «после MVP» ниже был написан до этого; здесь он приведён к факту.

| Слой | Где живёт сейчас (19.08.2026) |
|---|---|
| Презентация/SSR | Next.js — как и задумано, тонкий BFF |
| Домен-сервисы | ⚠️ по-прежнему TS (`features/*`); переезд не начинался |
| GitStore | **Rust-ядро**. Запись версий идёт ТОЛЬКО через него — прямой записи из фронта больше нет |
| SearchIndex | ⚠️ по-прежнему pgvector через Drizzle из Next (`queries/shared.ts`) |
| AiPort | ⚠️ по-прежнему OpenRouter из Next (`shared/ai/*`) |
| Данные | Postgres — тот же, общий для фронта и ядра |

То есть переехал ровно один слой из четырёх, и это осознанно: ради него Rust и брали.

Причина Rust: **производительность под большой трафик** git-хостинга (packfiles/дельты/
ref-negotiation) — CPU/IO-интенсив, где Rust даёт то, чего Node не даст. Для поиска и ИИ
такого довода нет: там узкое место — база и внешний API, а не язык.

## Как мигрируем (мягко, инкрементально)

1. ✅ **Сделано:** `core/domain` (типы) + `core/ports` (интерфейсы) + этот документ.
   Фичи не переписывались — чертился контракт. Ноль миграций БД, ноль поломок.
2. **Дальше, послойно:** каждый `features/*` начинает ходить через порты; Drizzle и
   `features/git/*` оборачиваются в адаптеры, реализующие порты. По одному срезу за раз.
3. **С каталог-UI:** таблица `repositories`, мультисписочные репо, архив-ZIP.
4. **Пост-MVP:** реализуем порты на Rust, Next.js остаётся презентацией.

Замороженное намеренно (Rust это перепишет — не золотим TS): настоящие git-ветки/merge,
git-LFS, распределённый лок push. TS-git остаётся «рабочим прототипом» (clone/pull/push
уже проверены).

## Границы слоёв (enforcement, 2026-07-08)

Направление зависимостей форсируется линтом (`eslint-plugin-boundaries`,
см. eslint.config.mjs):

```
app → widgets → features → { core, shared }
```

- фичи не импортируют друг друга (каждая видит только себя + core/shared);
- `shared` не знает про фичи; `core` не знает ни про кого (правило выше);
- ratchet-baseline в `eslint-suppressions.json` (сейчас 70 нарушений; стартовало
  со 107): НОВОЕ нарушение падает ошибкой сразу, починил старое — запусти
  `npx eslint . --prune-suppressions`;
- `features/mcp` и `features/admin` — delivery-слои (внешний API и
  админ-консоль над продуктом, зеркала app/): им, как и app, можно
  оркестрировать фичи (элементы mcp/admin в eslint-границах);
- composition root — `src/instrumentation.ts` (вне слоёв): единственное место
  связывания shared ↔ features (реестры джоб, источник индексации);
- чистые доменные модули живут в `core/domain` (entities, access — предикат
  видимости canViewList, quiz — контент+оценка тестов); сгенерённый protobuf —
  в `shared/gen`; композитные шапки страниц (ListHeader) — в `widgets/`;
- оставшаяся взаимная пара `library ↔ git`: разорвётся при Rust-докате, когда
  умрёт TS-проекция (`git/project.ts → library/list-store`) и git уедет в
  инфраструктурный слой; чокпоинт `library/guard` останется в library до
  декомпозиции query-слоя.
