# Rust-core + git — план миграции (живой документ)

Каноничный «где мы и что дальше» по переносу домена/git на Rust. Если не сказано иное —
**продолжаем по этому плану, по порядку, без переспрашивания.** Каждый шаг: ветка →
`tsc` + `next build` зелёные → merge `--no-ff`. Дизайн-контекст: [`architecture.md`](architecture.md).

---

## Зафиксированные решения (НЕ переспрашивать)

- **Бренд:** SetFork, домен **setfork.com**. (рабочее имя было SetHub; rename сделан)
- **Фронт:** остаётся Next.js (презентация + тонкий BFF). Домен/данные/git/поиск/AI → Rust.
- **git = источник правды.** Postgres — проекция для UI/поиска/AI. Общая БД для TS и Rust.
- **Модель:** **List** = единица контента и курирования (звёзды/форк/verified/issues).
  **Repository (каталог)** = git-единица, держит **1..N List**. Solo-список = repo из одного.
- **Rust git:** **`gix` (gitoxide) для чтения** (upload-pack/clone/pull), **`git2`/libgit2 для
  записи** (receive-pack/push). В раннем Rust допустимо временно шеллить в `git`, как в TS.
- **git-freeze на TS:** НЕ золотим TS-реализацию git (настоящие ветки/merge, git-LFS,
  распределённый лок) — это владение Rust-core. TS-git = рабочий прототип.
- **Auth:** API-токены `sf_…` (Basic) для git/MCP; session-cookie для веба.
- **Транспорт Rust↔Next (предв. рекомендация):** HTTP+JSON (простой BFF), не gRPC. Финально —
  в начале Фазы 1.

---

## Snapshot статуса (обновлять при каждом шаге)

- ✅ **Мягкая граница**: `src/core/domain/entities.ts` (типы) + `src/core/ports.ts` (порты).
  core LocaleText = `Partial<Record<string,string>>` (совместим с shared, без кастов).
- ✅ **GitStore** порт + адаптер (`features/git/adapter.ts`); роуты `[...git]`+`repo.bundle` через порт.
- ✅ **ListStore** порт + адаптер (`features/library/list-store.adapter.ts`): read + **addVersion**.
  Через порт ходят: страница versions (read), `saveNewVersion` (write).
- ✅ **git в TS** уже «Уровень 2»: clone/pull/**push**, git=источник правды, персистентные
  bare-репо (`.setfork-git`), проекция `list.json`→версия, pre-receive hook, коллабораторы.
- ✅ **Каталоги v1** (метаданные): таблица `repositories` + `templates.repositoryId`.

**➡️ NEXT (Фаза 0, по порядку):** домиграция оставшихся писателей и портов (см. чек-лист ниже).

---

## Фаза 0 — Достроить границу в TS (ближайшее)

Цель: **все** доменные операции идут через `@/core` порты; TS-фичи не трогают Drizzle/git напрямую.
Тогда замена на Rust = смена реализации адаптера, без правки фич.

**Писатели на `ListStore` (сейчас часть в обход порта):**
- [x] `saveNewVersion` → `listStore.addVersion`
- [x] `acceptSuggestion` (library/actions) → addVersion
- [x] `forkTemplate` (создание форка + первая версия) → `listStore.create`
- [x] `createTemplate` (/new) → `listStore.create`
- [x] расширить `ListStore`: `create(input)` (+ `toStepInput` хелпер; `insertSteps` удалён)
- [x] `generation accept` (features/generation/actions) → `listStore.create`
- [x] MCP `create_list` → create, `update_list` published → addVersion (draft in-place: TODO port-метод `replaceDraftSteps`)
- [x] git `projectPushedCommit` → addVersion (e2e-проверено пушем)
- [ ] `updateMeta` в `ListStore` (title/desc/tags/ordered/visibility/pinned) — по потребности
- [ ] MCP draft in-place → порт (`ListStore.replaceDraftSteps`)

**Итог write-path:** все создатели версий/списков идут через `ListStore.create`/`addVersion`
(кроме нишевого MCP-draft-in-place). Проверено: push→addVersion e2e (v2 с сохранением level).

**Остальные порты — адаптеры + развести потребителей:**
- [x] **CurationStore** (stars/watch): `features/curation/adapter.ts` = каноническая DB-логика;
  `toggleStar`/`toggleWatch`/`ensureWatch` мутации через порт; `watch/queries` + `library.isStarred`
  = тонкие обёртки над портом (потребители не менялись). Follow — отдельно позже.
- [x] **CollabStore** (issues/suggestions/comments): `features/collab-store/adapter.ts` = каноническая
  DB-логика (openIssue/addIssueComment/setIssueStatus/createSuggestion/addSuggestionComment);
  issue-actions + submitSuggestion/addSuggestionComment ходят через порт (auth/notify/watch — в actions).
  setIssueLabels/setIssueStatus-labels — direct (niche).
- [ ] **SearchIndex** (`getFeed`, semantic pgvector, reindex): обернуть `features/library/queries` + generation embeddings.
- [ ] **AiPort** (generate/refine/embed + учёт стоимости): обернуть `shared/ai/*`.
- [ ] **Notifier**: обернуть `features/notifications/notify` (частично уже чистый).
- [ ] **CatalogStore** (новый порт): repositories CRUD + assign (сейчас `features/catalogs` напрямую).

**Acceptance Фазы 0:** нет прямых `db.insert(steps|templateVersions|...)` вне адаптеров;
grep по фичам не находит Drizzle-мутаций домена вне `*.adapter.ts`.

---

## Фаза 1 — Контракт провода (Rust-seam)

- [ ] Выбрать транспорт (реком. HTTP+JSON) и зафиксировать.
- [ ] Описать API-контракт = порты, сериализованные (типы запрос/ответ). Держать типы общими
  (например, генерить TS-клиент из Rust-схемы или общий OpenAPI).
- [ ] Ввести **feature-flag на адаптер**: `inproc` (текущий Drizzle) vs `remote` (HTTP к Rust).
  Фичи не меняются — меняется реализация порта.

## Фаза 2 — Rust-скелет: READ-порты

- [ ] Rust-проект: **axum + sqlx + tokio**, та же Postgres.
- [ ] Реализовать READ: `ListStore` (getBySlug/versions/getVersion/contributors), `SearchIndex`
  (feed + semantic pgvector), `CurationStore` reads.
- [ ] Флипнуть Next на Rust по каждому read-порту за флагом; **сверять выдачу** с TS (golden-тесты).

## Фаза 3 — Rust git-core (главное)

- [ ] Персистентные bare-репо под управлением Rust (модель `GIT_DATA_DIR`, тот же диск/том).
- [ ] **Чтение через `gix`**: info/refs (upload-pack advertise) + upload-pack (clone/pull).
- [ ] **Запись через `git2`/libgit2**: receive-pack (push) + pre-receive-валидация (`list.json`).
- [ ] `ensureRepo` (bootstrap из истории + ленивый append веб-версий, детерминированные SHA),
  `projectPushedCommit` (list.json→версия через ListStore), `bundle`.
- [ ] Smart-HTTP отдаёт **Rust** напрямую (owns `/{owner}/{slug}.git/*`); Next проксирует или DNS.
- [ ] **Каталог = 1 репо с несколькими `lists/<slug>/list.json`** — здесь catalog-as-git-unit
  становится реальным (в TS отложено). git clone каталога тянет все списки.
- [ ] **Acceptance:** clone/pull/push против Rust == против TS; детерминированные SHA совпадают;
  запушенные коммиты персистятся; pre-receive отклоняет битое; коллаборатор пушит, чужой — 401.

## Фаза 4 — Записи + катовер

- [ ] WRITE-порты на Rust: addVersion/create, issues/suggestions, curation, catalogs.
- [ ] Распределённый лок push (Postgres advisory) для мульти-инстанс.
- [ ] Флипнуть Next на Rust по всем портам; ретайрнуть TS доменные внутренности (Next = BFF/UI).
- [ ] Форк каталога, «скачать репозиторий архивом (ZIP)» (ручное), SSH — по спросу.

---

## Открытые вопросы (решаем В СВОЮ ФАЗУ, не блокируют)

- Транспорт Rust↔Next: HTTP+JSON (реком.) vs gRPC — финал в Фазе 1.
- Rust отдаёт git напрямую vs Next-прокси — финал в Фазе 3 (реком.: Rust owns `/*.git`).
- `gix` receive-pack зрелость → фолбэк на `git2` для записи (уже заложено в решении).
- Деплой: отдельный Rust-сервис + Next; общая Postgres + персистентный том для репо.
- Стоимость AI: остаётся за `AiPort` (можно оставить в Next или перенести в Rust).

## Как резюмировать работу (для будущих сессий / меня)

1. Открыть этот файл → блок **Snapshot** и **NEXT**.
2. Взять следующий незакрытый `[ ]` из текущей фазы **по порядку**.
3. Ветка → реализовать → `tsc` + `next build` зелёные → merge `--no-ff` → отметить `[x]` здесь.
4. Не переспрашивать «что дальше» — план и есть ответ; спрашивать только при развилке из
   «Открытых вопросов» соответствующей фазы.
