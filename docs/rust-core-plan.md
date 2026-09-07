> **Историческая справка (2026-07-30).** План выполнен: git-ядро переехало в Rust
> целиком, TS-реализация удалена (HQ `tracks/git-format.md`, Ф0b). Документ оставлен
> как запись хода переезда — актуальное состояние в `src/features/git/README.md`.

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

**➡️ NEXT: Фаза 0 ЗАКРЫТА** (все доменные мутации через `@/core`-порты: GitStore/ListStore/
CurationStore/CollabStore/SearchIndex/CatalogStore/Notifier/AiPort). Следующее — **Фаза 1**
(контракт провода Rust↔Next: транспорт HTTP+JSON, feature-flag inproc↔remote), затем **Фаза 2**
(Rust-скелет axum+sqlx, READ-порты + golden-сверка).

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
- [x] **SearchIndex** (обслуживание индекса): `features/search/adapter.ts` = порт `reindex`/`purgeStale`
  над `library/reindex.ts`; admin-purge через порт. Чтение ленты (`getFeed`) — read-проекция, НЕ порт.
  (Опционально позже: авто-`reindex` в write-path после версии — сейчас индекс bulk-админкой.)
- [x] **CatalogStore** (порт добавлен): `features/catalogs/adapter.ts` (ensure/setListCatalog/remove);
  catalog-actions ходят через порт (auth/revalidate — в actions).
- [x] **Notifier**: `features/notifications/adapter.ts` — формальный порт над `notify`/`notifyMany`
  (домен listId → БД templateId). Потребители пока зовут notify() напрямую (тонкая обёртка = сам порт).
- [x] **AiPort** (пока `embed`): `shared/ai/adapter.ts` над `embedOne`+settings. generate/refine — при
  миграции features/generation (streaming/cost, лучше сразу на Rust-стороне).

**Acceptance Фазы 0 — ДОСТИГНУТО:** доменные мутации версий/списков/курирования/коллаборации/каталогов
идут через `@/core`-порты (`*.adapter.ts`); прямых `db.insert(steps|templateVersions)` вне адаптеров нет.
Осталось по мелочи: `updateMeta`/MCP-draft-in-place/follow (не мутируют версии) — по потребности.

**➡️ Фаза 0 закрыта. NEXT: Фаза 1 (контракт провода) → Фаза 2 (Rust-скелет).**

---

## Фаза 1 — Контракт провода (Rust-seam) — В РАБОТЕ (git-ядро первым)

**Решения:** транспорт = **Connect** (protobuf-контракт + HTTP/JSON, без Envoy); переезд —
**git-ядро ПЕРВЫМ** (как Gitaly). Подробности: `docs/phase1-wire-contract.md`.

- [x] Транспорт зафиксирован: **Connect** (protobuf codegen; git-first как GitLab Gitaly).
- [x] Контракт git-ядра: порт **`GitCore`** (`@/core`) + **`proto/git.proto`** (`service GitCore`:
  InfoRefs*/UploadPack/ReceivePack/CreateBundle). Сервис резолвит/лочит/проецирует внутри.
- [x] In-process реализация `features/git/core.inproc.ts` (поверх `GitStore`); роут `[...git]` и
  `repo.bundle` зависят только от порта `GitCore`. e2e: clone/pull/push/bundle ✅.
- [x] **Feature-flag** `features/git/core.ts`: `SETFORK_CORE_URL` → inproc/remote (адрес `SETFORK_CORE_ADDR`).
- [x] **TS-клиент Connect-ES** из `proto/git.proto` (`buf.gen.yaml` + `gen/git_pb.ts`, protobuf-es v2) +
  `gitCoreRemote` (`core.remote.ts`, gRPC h2c). `tsc` зелёный. **e2e clone через Rust core сверен ✅.**
- [x] **Контракты доменных портов — НАЧАТО: `proto/domain_read.proto`** (`service ListRead`:
  GetList/ListVersions/GetVersion/GetContributors — READ-часть ListStore). Конвенции: LocaleText =
  map-обёртка, даты = unix-ms (`floor(epoch*1000)`), nullable = '', not-found = `found=false`.
  **Rust-реализация `src/domain_read.rs` (sqlx) + golden-сверка С TS-адаптером — 6/6 списков OK**
  (вкл. форк, MCP-созданный, ordered/unordered): CLI `domain-read <owner> <slug> <out.json>` ↔
  `scripts/golden-domain-read.ts` (запуск: `NODE_OPTIONS=--conditions=react-server npx tsx …`;
  avatarRef нормализуется — TS подписывает imgproxy). **Connect-ES клиент — СДЕЛАН:**
  `gen/domain_read_pb.ts` (buf) + `list-store.remote.ts` (READ-методы порта) + фасад
  `list-store.ts` с флагом **`SETFORK_DOMAIN_READS=1`** (writes всегда Drizzle; потребители
  импортируют только фасад). **Remote-golden через провод (Connect→Rust vs Drizzle) — OK**
  на 2 списках (list/versions/getVersion/contributors). **CurationRead — СДЕЛАН** тем же
  паттерном (IsStarred/IsWatching/WatchCount/WatcherIds; фасад `curation/store.ts`, тот же
  флаг; golden через провод 4/4). **WRITE-фаза НАЧАТА: ListWrite.AddVersion** — полная
  семантика адаптера (LocaleText/imageRef/jsonb, bump в одной tx, `for update`), фасад за
  ОТДЕЛЬНЫМ флагом `SETFORK_DOMAIN_WRITES=1`; write-golden round-trip идентичен. Осталось:
  `create` на Rust, Collab reads (по потребности), затем катовер write на dev/проде.

## Фаза 2 — Rust git-ядро (git-first)

**Проект создан и РАБОТАЕТ:** `C:\Users\Mike\Projects\setfork-core` (отдельный git-репо).
`tonic`+`prost`+`tokio`+`sqlx`, `build.rs` кодогенит из `proto/git.proto` (protoc из
`protoc-bin-vendored`). **Проверено: `cargo build` ок, сервер стартует, sqlx подключается к той же
Postgres** (self-check: 11 списков, резолв `demo/redis-…`→uuid+v3). (Ранний timeout crates.io был
временным сбоем сети, НЕ блоком.) См. `setfork-core/README.md`.

- [x] Rust-проект-скелет (tonic GitCore из proto) — собирается + запускается.
- [x] **sqlx** подключение к той же Postgres + `resolve_list(owner,slug)`→(id,version) + self-check.
- [x] Загрузка истории версий (`db::load_bundle_data`: versions+steps, jsonb LocaleText→'en').
- [x] Материализация репо (шелл git, детерм. даты/идентичность) + **`CreateBundle` RPC** + CLI.
  Проверено: bundle demo/redis-… клонируется (3 коммита, теги v1-v3, list.json). `src/bundle.rs`.
- [x] **Golden-exact match с TS — ДОСТИГНУТ.** Полный порт serialize.ts (README+list.json+steps/*.md),
  `serde_json preserve_order`, `floor(epoch)` (git усекает дробные сек). **Проверено:** bundle
  demo/redis-… — рабочее дерево И commit-SHA идентичны TS (485ed58/052ada9/93618ff), и сам
  bundle-файл **байт-в-байт** (`cmp` ✅). → drop-in для TS smart-HTTP.
- [x] **READ RPC: `InfoRefsUploadPack` + `UploadPack` (clone/pull) — РАБОТАЮТ e2e.**
  `smart_http.rs` (порт smart-http.ts: pkt-line, `git upload-pack --stateless-rpc`, `GIT_PROTOCOL`),
  `bundle::materialize_repo` вынесен для переиспользования, `with_materialized` (материализация→op→cleanup).
  **Проверено:** advertise-байты идентичны TS (550==550, `cmp`); полный `git clone` через Rust
  (Connect-ES клиент → gRPC) даёт SHA 485ed58/052ada9/93618ff + теги v1..v3, все файлы. `InfoRefsReceivePack`
  (advertise для push) тоже реализован.
- [x] **`ReceivePack` (git push) — РАБОТАЕТ e2e.** Персистентные bare-репо под `GIT_DATA_DIR`
  (общий том с фронтом, git=источник правды): `repo.rs` (`ensure_repo` bootstrap `git clone --bare` /
  ленивый append веб-версий, пер-репо async-лок), `bundle.rs` (`bootstrap_bare`/`append_versions`/
  `max_tag_version`/pre-receive hook), `project.rs` (парс list.json запушенного tip → `ProjStep`),
  `db.rs` (`add_version` tx: current+1→insert version+steps→bump; `update_meta`; step_level enum,
  LocaleText `{en}`). READ RPC + CreateBundle теперь тоже через `ensure_repo` (после push клоны видят
  коммит). **Проверено:** `git push` через Rust → коммит персистится (re-clone) И в Postgres версия 4
  (8 шагов, note, tags-мета, current_version). TS Connect-ES `receivePack` тоже проверен (мост).
- [x] **Docker (оба репо):** `Dockerfile` + `docker-compose.yml` (обычный) + `docker-compose.prod.yml`
  (внешняя сеть `edge`). Core: rust→debian-slim+git. Front: node standalone + `migrate` target
  (drizzle-kit push). Все compose провалидированы `docker compose config`.
- [x] **КАТОВЕР git на Rust — ГОТОВ (dev).** Флип `.env.local`: `SETFORK_CORE_URL=1` +
  `SETFORK_CORE_ADDR=127.0.0.1:50051` → `gitCore` в роуте `[...git]` = `gitCoreRemote` → Rust.
  **Проверено через НАСТОЯЩИЙ Next-роут** (не мост): `git clone localhost:3000` отдаёт историю (v1..v5);
  дискриминатор — с выключенным core роут даёт **500** (значит remote реально активен, не inproc);
  `git push` (Basic-токен `sf_`) → версия 5 в Postgres. `.env.local` gitignored; убрать 2 строки =
  возврат к inproc. Требует запущенного `setfork-core` (cargo run / docker).
- [x] **`git2` (libgit2) вместо шелла — СДЕЛАНО для объектов/коммитов/деревьев/рефов.**
  `bundle.rs` (materialize/bootstrap/append/max_tag) и `project.rs` (read_tip/tag) на git2
  (`init_bare`+treebuilder+`repo.commit` фикс-идентичность SetFork+Time offset 0; open_bare+
  tree.get_path). git2 0.19 `default-features=false` (без сети; libgit2 собирается на Windows через cc).
  **Проверено байт-в-байт:** git2 vs shell материализация → одинаковый SHA (`1f9115d…`, A/B через stash);
  полный e2e через реальный роут (git2-bootstrap на удалённом репо, clone v1..v6 детерминированно, push
  v7→git2-проекция). **Шелл git остался ТОЛЬКО для** `git bundle create` (у libgit2 нет bundle) и
  `upload/receive-pack --stateless-rpc` (wire-протокол — как у Gitaly). Полностью нативный pack-протокол
  (gix server-side) — отдельный большой шаг, низкий приоритет.
- [ ] Материализация репо (сначала шелл `git`, как TS; детерминированные SHA) → RPC по одному:
  `CreateBundle` → `InfoRefs*` → `UploadPack` → `ReceivePack`(+проекция). Потом gix/git2 вместо шелла.
- [ ] TS Connect-ES клиент из `proto/git.proto` → `gitCoreRemote` (`features/git/core.ts`) →
  флип `SETFORK_CORE_URL` → **golden-сверка** байт/SHA с inproc.

### (историч. набросок Фазы 2, до git-first) — Rust READ-порты
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
