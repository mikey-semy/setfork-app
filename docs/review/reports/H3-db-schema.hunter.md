# H3 — отчёт охотника

Блок: **H3 — Схема БД и миграции**. Роль: reviewer (охотник).

## Охват

- прочитано файлов: **8 из 8**

Прочитанные файлы (целиком, по одному пути на строку):

```
src/shared/db/index.ts
src/shared/db/keyset.ts
src/shared/db/like.ts
src/shared/db/moved-list.ts
src/shared/db/raw.ts
src/shared/db/resolve-list.ts
src/shared/db/schema.ts
src/shared/db/visibility.ts
```

`schema.ts` (3092 строки) прочитан четырьмя заходами: 1–800, 800–1600, 1600–2400, 2400–3093.
Остальные семь файлов — по одному чтению целиком (69, 140, 26, 69, 23, 163, 19 строк).

- не прочитано: **пусто**, все файлы блока прочитаны целиком.

Файлы вне охвата, прочитанные фрагментами как доказательная база (не отчитываюсь за них,
их читает соседний блок): `src/features/analytics/service.ts`, `src/features/analytics/visitor.ts`,
`src/features/library/queries/feed.ts`, `src/features/library/queries/list.ts`,
`src/features/library/queries/shared.ts`, `src/features/library/actions/list-settings.ts`,
`src/features/mcp/tools/resources.ts`, `src/features/profile/queries.ts`,
`src/features/settings/actions.ts`, `src/features/issues/edit-actions.ts`,
`src/app/api/issues/search/route.ts`, `src/shared/env.ts`, `src/shared/ai/retrieval.ts`,
`src/shared/moderation/publication-state.ts`, `src/features/generation/service.ts`,
`tests/architecture/index-nulls-order.test.ts`, `package.json`, `drizzle.config.ts`, `AGENTS.md §8`,
и исходники drizzle-orm 0.45.2 (`node-postgres/driver.js`, `pg-core/db.js`).

## Гипотезы

- **H3.1 — проверена**: собраны все 45 вызовов `onConflict*` (грепом их 53 совпадения: 45 вызовов
  + 8 упоминаний в комментариях). У всех 22 вызовов с явной целью цель совпадает с
  уникальным индексом/PK в `schema.ts` по составу И порядку колонок; у 23 вызовов
  `onConflictDoNothing` цель не задана (Postgres ловит любое ограничение — промаха быть не может),
  и ни один `onConflictDoUpdate` не остался без цели. Таблица — в разделе «Таблица 1». Находок нет.
- **H3.2 — проверена**: девять поверхностей разобраны (семь через `keysetStep`, две горячие
  `orderBy`+`limit`). Найдена одна без индекса — **H3-005** (`mcpOwnListResources`). Кроме того
  установлено, что узда `tests/architecture/index-nulls-order` проверяет НЕ список поверхностей,
  как предполагал манифест, а только форму: «у каждой `.desc()`-колонки в `schema.ts` стоит
  `.nullsFirst()`» — наличие индекса под keyset-поверхностью она не проверяет в принципе.
  Таблица — в разделе «Таблица 2».
- **H3.3 — проверена**: скан всех 1151 `.ts`/`.tsx` файла `src/` + `scripts/` (кроме самого
  `src/shared/db/`) скриптом, извлекающим идентификаторы и строковые литералы из `` sql`` ``-шаблонов
  и сверяющим их с 463 именами колонок/таблиц и 113 значениями enum'ов схемы. Идентификаторов,
  отсутствующих в схеме, не осталось ни одного после исключения ключевых слов SQL, функций
  Postgres и алиасов CTE; литералов-значений enum с опечаткой нет. **Таблица пустая** — как искал,
  описано в разделе «Таблица 3».
- **H3.4 — проверена**: все 13 `sql<Date…>` найдены и прослежены до потребителя. Каждый либо
  проходит через `asDate` (`gnome-stats.ts:101`, `activation-db.ts:20,32,39`, `model-stats.ts:77`),
  либо оборачивается `new Date(...)` перед арифметикой (`feed-pick.ts:66`, `partners/service.ts:156`),
  либо не вызывает методов `Date` вовсе (sitemap, `sessions/queries.ts:88`, `shared.ts:59`).
  Прямого `.getTime()` на значении сырого выражения нет. Находок нет.
- **H3.5 — проверена**: находка **H3-004**. `Math.max(10, Number(DB_POOL_MAX) || 20)` и
  `Math.max(0, Number(DB_POOL_MIN) || 0)` молча клампят и молча съедают мусор, при том что в
  проекте есть `envNumber` (`src/shared/env.ts:18`), заведённый ровно против такого поведения.
  Отдельная часть гипотезы про `idleTimeoutMillis` снята: у `pg` он и без явного задания равен
  10 000 мс, тихой деградации тут нет.
- **H3.6 — проверена**: находка **H3-001**, подтверждена чтением исходников drizzle-orm 0.45.2.
- **H3.7 — проверена**: методы, зависящие от `this`, есть, и их большинство —
  `pg-core/db.js:165,172,180,213,240,267,275,290` читают `this.session`/`this.dialect`.
  Падения от этого НЕ происходит: через Proxy `this === proxy`, `proxy.session` отдаёт session
  нового drizzle-объекта, построенного на том же `Pool`, и функционально она равноценна.
  Цена не в поломке, а в множителе к H3-001 — подробности внутри той находки.
- **H3.8 — проверена**: находка **H3-006**. Ники хранятся в нижнем регистре
  (`src/shared/auth/handle-input.ts:19` — `stripHandleInput(raw).toLowerCase()`), уникальный
  индекс на `users.handle` — обычный `.unique()`, без `lower()`. `resolveUserByHandle` сравнивает
  через `lower()`, `resolveListBySlug` — точным `eq`. Цепочка чтения при этом не ломается: путь
  `/Miki/list` доезжает до `resolveListOrMoved`, тот находит владельца через `lower()` и отвечает
  308 на `/miki/list`. Ломается только прямой вызов `resolveListBySlug` с ненормализованным ником.
- **H3.9 — проверена, находок нет**: цепочка переездов A→B→C работает, и это следует из формы
  таблиц, а не из везения. `listRedirects` хранит `templateId`, а не целевой слаг
  (`schema.ts:558`), поэтому после второго переименования запись для A ведёт на ту же строку
  `templates`, у которой слаг уже C — `resolveListOrMoved` читает актуальный слаг из самой строки
  (`resolve-list.ts:151-162`). То же у `userRedirects`: хранится `userId`. Переписывать старые
  редиректы, как Gitea, здесь не нужно. Про ник, который спустя 180 дней занял другой человек:
  `resolveUserByHandle` сначала смотрит `users`, и живой владелец имени всегда побеждает
  удержание (`resolve-list.ts:63-76`) — порядок верный.
- **H3.10 — проверена**: FK **без** `onDelete` в схеме нет ни одного (проверено грепом по всем
  `references((` — совпадений без `onDelete` ноль). Вторая половина гипотезы дала находку
  **H3-002**: таблицы, привязанные к контенту БЕЗ внешнего ключа (`content_edits.target_id`,
  `reactions.target_id`), при удалении списка не чистятся ни каскадом, ни кодом, причём
  комментарии схемы утверждают обратное.
- **H3.11 — проверена, находок нет**: 41 jsonb-колонка, у 37 есть `$type`. Четыре без него —
  `embeddings.metadata` (870), `jobs.payload` (961), `agentActions.signal`/`decision` (1062, 1064)
  — намеренно свободные объекты, и читатели обращаются с ними как со свободными. Начал, как
  просил манифест, с `generation_candidates.items`: писатель (`generation/service.ts:179`) строит
  массив с ЯВНОЙ аннотацией `const items: CandidateItem[]`, то есть компилятор сверяет запись с
  тем же типом, что стоит в `$type` — сузиться молча тут нечему.
- **H3.12 — проверена, находок нет**: приведений всего два. `keyType: 'int'` использует ровно
  одна поверхность — `getCommitsPage` по `templateVersions.version` (`integer`), остальные шесть
  идут по `timestamptz`-колонкам с приведением по умолчанию. Поверхности с ключом `score` или
  `handle` в keyset нет ни одной.
- **H3.13 — проверена**: находка **H3-003**.
- **H3.14 — проверена, находок нет**: день считается в ПРИЛОЖЕНИИ и явно в UTC —
  `dayUtc()` (`src/features/analytics/visitor.ts:17`) это `now.toISOString().slice(0, 10)`, от
  часового пояса процесса не зависит вовсе, и две реплики с разными `TZ` дадут один и тот же
  `day`. Колонка `template_views.day` — `date`, drizzle отдаёт/принимает её строкой в той же форме.

## Свежесть дерева

Проверено до оформления находок:

- `git log HEAD..origin/master --oneline` — пусто ДО `git fetch origin` и пусто ПОСЛЕ него.
  Рабочее дерево совпадает с `origin/master` (HEAD = `63650e23`), ни одна находка не могла быть
  починена в master после того, как я её увидел.
- Соседних репозиториев (`setfork-core`) находки не касаются: весь предмет блока живёт в этом репо.
- Исходники drizzle-orm читались из `/home/mike/Projects/setfork-app/node_modules/` (в этом
  worktree `node_modules` не установлены). Версия совпадает с объявленной в `package.json`
  этого дерева: `"drizzle-orm": "^0.45.2"`.

## Ограничения охвата

Обязательный раздел. Чего я осознанно НЕ делал:

1. **Ничего не исполнял на живой базе.** Ни `EXPLAIN`, ни `db:push --dry-run`, ни запуск тестов.
   Все выводы про планы запросов (H3-005, H3-007) — рассуждение о форме индекса против формы
   `ORDER BY`, а не наблюдение планировщика. Замеров, на которые ссылаются комментарии в схеме,
   я не перепроверял и принял на веру.
2. **`drizzle/**` (48 файлов миграций) не читал** — манифест прямо велит судить по `git log`,
   а не по содержимому. Вывод H3-003 про устарелость опирается на AGENTS.md §8, на имя последнего
   файла (`0045_council_experts_generation_messages.sql`) и на то, что `drizzle.config.ts`
   указывает `out: './drizzle'`. Что именно сломается при накате, я не устанавливал — только то,
   что команда существует, работает и ведёт в устаревший журнал.
3. **`db:push` против чистой базы не прогонял.** Поэтому вопрос «применится ли схема на чистой
   установке» закрыт лишь частично: я проверял её на внутреннюю согласованность (цели
   `onConflict`, enum-литералы, FK), но не на то, что drizzle-kit сгенерирует валидный DDL. В
   частности, не проверен `default([])` у `feedSources.tags`/`feedItems.tags` — остальные
   массивы в схеме объявлены через `sql\`'{}'::text[]\``, и почему эти две отличаются, я не
   выяснял; косвенный довод, что всё в порядке, — `db:init` гоняется в CI.
4. **Порог «сколько строк, чтобы отсутствие индекса стало больно» не мерил.** H3-005 и H3-007
   оценены по устройству (правило контекста «оценивать по устройству, а не по наблюдаемым числам»),
   и оба получили низкую severity именно потому, что масштаб предъявить нечем.
5. **Карту корней `setfork-hq/reviews/problems/CLUSTERS.md` сверить не удалось**: по указанному
   пути такого файла нет, там лежит дерево из 253 карточек по файлам. Целенаправленно проверил,
   что карточек по `src/shared/db/**` в нём нет вовсе (glob дал пусто) — то есть мои находки по
   файлам блока заведомо не повтор. Повтор по КОРНЮ (а не по файлу) исключить не могу: 253
   карточки я не читал.
6. **Приватность/права не проверял** — это предмет других блоков. Даже там, где предикат
   видимости попался мне на глаза (`publiclyVisible`, `visibleFilter`), я смотрел только на
   совпадение его формы с предикатом частичного индекса, а не на правильность самого правила.
7. **H3.7 закрыта доказательством «не падает», а не «this не нужен».** Я не перебирал ВСЕ методы
   `PgDatabase` — я нашёл, что зависимость от `this` есть у большинства, и показал, почему она
   разрешается в рабочий объект. Метод, который сломался бы, я не нашёл, но и полного перебора
   поверхности drizzle не делал.

## Находки

### H3-001 · high · На проде drizzle-клиент строится заново на КАЖДОЕ обращение к `db`

**Место:** `src/shared/db/index.ts:37-57`

**Что не так:** `getDb()` кэширует построенный клиент в `global.__pgDb` только когда
`process.env.NODE_ENV !== 'production'` (строка 38). В production кэш не ставится, а
`Proxy.get` (строки 52-55) зовёт `getDb()` на каждое читаемое свойство — значит
`drizzle(pool, { schema })` выполняется при каждом `db.select`, `db.insert`, `db.query.*`,
`db.transaction`. Пул при этом один (`global.__pgPool` кэшируется всегда), так что проблема
не в соединениях, а в самом объекте.

Цена одного `drizzle(pool, {schema})` — не «лишний объект». По исходникам drizzle-orm 0.45.2:
`node-postgres/driver.js:29-51` вызывает `extractTablesRelationalConfig(config.schema, …)` —
полный проход по всем экспортам `schema.ts`; затем конструктор `PgDatabase`
(`pg-core/db.js:32-44`) в цикле по ВСЕМ таблицам схемы создаёт по объекту
`new RelationalQueryBuilder(...)` на каждую. В схеме 87 таблиц.

Множитель от Proxy (это и есть закрытая гипотеза 7): методы drizzle читают `this.session` и
`this.dialect`, а `this` — прокси. `db.select(...)` — это `proxy.get('select')` → `getDb()`
№1, затем внутри метода `this.session` → `getDb()` №2 и `this.dialect` → `getDb()` №3
(`pg-core/db.js:165-181`). `db.transaction(cb)` — `getDb()` №1 плюс `this.session`
(`db.js:290`) → №2. То есть на один запрос приходится не одно построение схемы, а два-три.

**Сценарий отказа:** прод, `NODE_ENV=production`. Пользователь открывает `/miki/some-list`.
Страница выполняет, скажем, восемь обращений к `db` — значит около двадцати раз подряд
выполняется `extractTablesRelationalConfig` по 87 таблицам и создаётся около 1740
объектов `RelationalQueryBuilder`, которые тут же становятся мусором. То же на каждом
запросе каждой страницы и на каждом такте воркера. Локально дефект не воспроизводится
вообще: в dev-режиме ветка кэша работает, и все замеры, снятые на `npm run dev`, о нём
не скажут.

**Почему это дефект:** ветка кэширования написана ради переживания HMR в dev, а на проде
единственное, что она делает, — отключает кэш там, где он нужнее всего. Комментарий в шапке
файла («Один Pool на процесс») описывает как раз то, что для `Pool` соблюдено, а для
самого клиента — нет; читатель файла видит «singleton Drizzle-клиент» в первой строке и
получает обратное.

**Уверенность:** confirmed

**Корень:** кэш, выключенный ровно в том режиме, ради которого он нужен

---

### H3-002 · medium · Удаление списка оставляет `content_edits` и `reactions` сиротами — вопреки тому, что говорят комментарии схемы

**Место:** `src/shared/db/schema.ts:1573-1592` (`content_edits`), `src/shared/db/schema.ts:1373-1389` (`reactions`)

**Что не так:** обе таблицы ссылаются на контент полиморфно, без внешнего ключа на
`target_id`, и обе объясняют в комментарии, почему это безопасно. `content_edits`:
«Внешним ключом не связан: цель зависит от `kind`, а чистку делает каскад владельца — обе
таблицы уходят вместе со списком» (строки 1578-1579). `reactions`: «FK на target нет (разные
таблицы); чистка — при удалении контента (сейчас не удаляем)» (строка 1372).

Оба утверждения неверны. Каскад уносит `issues` и `issue_comments` — но не строки, которые
на них указывают: FK-то нет, а значит и каскаду не за что зацепиться. А контент мы как раз
удаляем: `deleteListAction` (`src/features/library/actions/list-settings.ts:144`) делает
`db.delete(templates)` и больше ничего. Грепом по всему `src/` единственное удаление из
`content_edits` — усечение истории до 20 ревизий по конкретному `target_id`
(`src/features/issues/edit-actions.ts:44-51`), единственное из `reactions` — снятие своей
реакции пользователем (`src/features/reactions/actions.ts:77`). Ни одного пути, удаляющего
строки при исчезновении цели, нет.

**Сценарий отказа:** у владельца список с тремя задачами, каждую он правил → в
`content_edits` три строки с `prev_title`/`prev_body` (полные тексты прежних редакций), в
`reactions` — эмодзи участников на этих задачах. Владелец жмёт «Удалить список». Каскад
уносит `templates` → `issues` → `issue_comments`. Строки `content_edits` и `reactions`
остаются в базе навсегда: их `target_id` теперь указывает на несуществующие строки, ни один
запрос их не читает и ни один путь их не удалит. Текст, который автор считает удалённым
вместе со списком, продолжает лежать в БД.

**Почему это дефект:** расхождение обещания с поведением — ровно то, что ищет ревью. Комментарий
схемы заявляет механизм чистки, которого нет, и следующий читатель на него положится. Для
`content_edits` это ещё и пользовательский текст, переживающий удаление, о котором его автору
не сказано.

**Уверенность:** confirmed

**Корень:** полиморфная ссылка без FK, чью чистку комментарий приписывает каскаду

---

### H3-003 · medium · `db:migrate` и `db:generate` живы в `package.json` и ведут в журнал миграций, устаревший на десятки таблиц

**Место:** `package.json:26-27`

**Что не так:** AGENTS.md §8 говорит прямо: «**Только `npm run db:push`, НЕ `drizzle-kit
generate`.** Миграции в репозитории устарели, и `generate` ломает БД». При этом обе команды
остались рабочими скриптами:

```
"db:generate": "drizzle-kit generate",
"db:migrate":  "drizzle-kit migrate",
```

`drizzle.config.ts` направляет обе в `out: './drizzle'` — каталог из 48 файлов, последний
`0045_council_experts_generation_messages.sql`. Прод, CI и `db:init` накатывают схему
исключительно `drizzle-kit push --force`, так что журнал миграций и живая база разошлись
и продолжают расходиться с каждым изменением `schema.ts`. Узды, не дающей вызвать эти
команды, нет — я искал: запрет существует только текстом в AGENTS.md.

**Сценарий отказа:** новый участник (или агент, читающий `package.json`, а не AGENTS.md)
поднимает себе базу и по привычному имени запускает `npm run db:migrate`. drizzle-kit
берёт журнал, отставший от схемы на десятки таблиц, и применяет его к базе, накатанной
push'ем: в лучшем случае падает на уже существующих объектах, в худшем — доводит базу до
состояния, которого в проекте нет ни у кого. Симметрично `npm run db:generate` молча
дописывает в `drizzle/` новую миграцию от текущей схемы, после чего следующий `db:migrate`
попытается применить и её тоже.

**Почему это дефект:** правило 3 инвариантов — мёртвое право хуже отсутствующего.
Команда, которая существует, запускается и ломает базу, а от её вызова защищает только
абзац документации, — ровно тот случай, который манифест называет находкой
(«мёртвая команда (`db:migrate`, `db:generate`), способная сломать базу тому, кто её вызовет»).

**Уверенность:** confirmed

**Корень:** запрет живёт в документации, а не в коде

---

### H3-004 · medium · `DB_POOL_MAX`/`DB_POOL_MIN` принимаются и молча не действуют, мимо собственного `envNumber`

**Место:** `src/shared/db/index.ts:32-33`

**Что не так:**

```ts
max: Math.max(10, Number(process.env.DB_POOL_MAX) || 20),
min: Math.max(0,  Number(process.env.DB_POOL_MIN) || 0),
```

Три разных молчания в двух строках. `DB_POOL_MAX=5` → `Math.max(10, 5)` = **10**: значение
принято и отброшено. `DB_POOL_MAX=abc` → `NaN || 20` = **20**: мусор неотличим от «не задано».
`DB_POOL_MIN=30` при `max=20` — `pg` такую пару не валидирует, конфигурация оседает в пуле
и не даёт заявленного эффекта.

Существеннее то, что в проекте УЖЕ есть ответ на этот класс: `envNumber`
(`src/shared/env.ts:18-27`), и его шапка написана про ровно эту болезнь — «`Number(process.env.X ?? d)`
ведёт себя противоположно в соседних константах… одна и та же ошибка настройки — два разных
исхода, и оба тихие». `envNumber` при непонятном значении берёт дефолт И ПЕЧАТАЕТ
предупреждение. Слой базы им не пользуется.

**Сценарий отказа:** Postgres на netcup делит машину с чужими проектами, оператор снижает
`DB_POOL_MAX=5`, чтобы уложиться в `max_connections`, и перезапускает. Приложение берёт 10.
При веб-запросах и воркере в одном процессе (комментарий строки 20 говорит, что пул общий)
и нескольких контейнерах лимит соединений выбирается быстрее, чем рассчитал оператор; дальше
`connectionTimeoutMillis: 10_000` превращает это в явные отказы через 10 секунд. В логах при
этом нет ни строчки о том, что заданное значение не применено.

**Почему это дефект:** правило 7 — никакой тихой деградации; настройка принята и не действует,
причина не названа. Плюс расхождение с собственным правилом чтения чисел из окружения.

**Уверенность:** confirmed

**Корень:** число из env читается сырым `Number(...) || d` мимо `envNumber`

---

### H3-005 · low · Keyset-лента `resources/list` в MCP не имеет индекса ни одной из нужных форм

**Место:** `src/features/mcp/tools/resources.ts:70-80` (поверхность), `src/shared/db/schema.ts:472-507` (индексы `templates`)

**Что не так:** `mcpOwnListResources` строит классический keyset:
`WHERE owner_id = ? AND (created_at, id) < (?::timestamptz, ?::uuid) ORDER BY created_at DESC, id DESC`.
Требование, записанное в `keyset.ts:44-46` — «Под это нужен индекс `(…, key DESC, id DESC)`
— с `NULLS FIRST`». На `templates` таких индексов семь, и `created_at` не входит ни в один:
`templates_owner_slug` (owner_id, slug), `templates_forked_from_idx`, `templates_owner_fork_uq`,
`templates_pub_updated_idx` (updated_at), `templates_pub_stars_idx` (stars_count),
`templates_owner_updated_idx` (owner_id, updated_at DESC, id), `templates_repository_idx`.
Условие курсора остаётся фильтром, а порядок — сортировкой в рантайме.

Узда это не ловит и поймать не может: `tests/architecture/index-nulls-order.test.ts` проверяет
только, что у каждой `.desc()`-колонки В СХЕМЕ стоит `.nullsFirst()`. Про то, что у
keyset-поверхности вообще должен быть индекс, она не знает — отсутствующий индекс в её поле
зрения не попадает по устройству, а не по недосмотру списка.

**Сценарий отказа:** агент подключён по MCP и листает `resources/list` владельца, у которого
518 списков (число из комментария `src/features/library/queries/feed.ts:222`). На КАЖДОЙ
странице обхода база поднимает и сортирует весь его корпус, чтобы отдать порцию, — то есть
цена страницы равна размеру библиотеки владельца, а не размеру порции. Это ровно то, ради
избавления от чего keyset и вводился (`keyset.ts:12-15`).

**Почему это дефект:** манифест блока называет находкой «запрос с `orderBy`/keyset, под
которым нет индекса нужной формы». Severity низкая осознанно: отсечка идёт по одному
владельцу, целевых чисел на проде нет и предъявить их не на ком.

**Уверенность:** confirmed

**Корень:** keyset заведён без парного индекса, и узда такой пропуск не видит

---

### H3-006 · low · Ник сравнивается с учётом регистра в `resolveListBySlug` и без учёта — в соседней функции того же файла

**Место:** `src/shared/db/resolve-list.ts:33` против `src/shared/db/resolve-list.ts:66,74`

**Что не так:** ники хранятся в нижнем регистре — нормализация стоит на входе
(`src/shared/auth/handle-input.ts:19`: `stripHandleInput(raw).toLowerCase()`), а уникальность
`users.handle` объявлена обычным `.unique()` (`schema.ts:238`), без `lower()`.
`resolveUserByHandle` это учитывает и сравнивает через `sql\`lower(...) = lower(...)\``, ссылаясь
на форму Gitea («сверка без учёта регистра», строка 58). `resolveListBySlug` в том же файле
сравнивает точным `eq(users.handle, owner)`.

Путь ЧТЕНИЯ от этого не страдает, и это важно для оценки: `/Miki/list` промахивается мимо
`resolveListBySlug`, попадает в `resolveUserByHandle`, находит владельца и получает 308 на
`/miki/list` (`resolve-list.ts:126-141`). Страдают семь прямых вызывающих
`resolveListBySlug`, которые берут `owner` из параметров как есть.

**Сценарий отказа:** `GET /api/issues/search?owner=Miki&slug=deploy&q=ssl`
(`src/app/api/issues/search/route.ts:21,25` — `owner` берётся из query без нормализации,
middleware регистр пути не трогает). `resolveListBySlug` возвращает `null`, роут отвечает
`Response.json([])` — то есть «задач не найдено» вместо списка задач. Пустой ответ здесь же
служит и отказом в доступе, поэтому отличить «нет прав» от «не тот регистр» нельзя ни
клиенту, ни по логам.

**Почему это дефект:** правило 7 (причина отказа не названа, результат — пустой экран) плюс
две разные трактовки одного идентификатора в одном файле, о которой ничто не предупреждает.

**Уверенность:** plausible — что до этих вызывающих доходит ненормализованный ник, я показал
для API-роута (параметр из query); для server actions, куда `owner` приходит из параметров
страницы, страница обычно уже отредиректила адрес в нижний регистр, и сценарий требует
обращения в обход страницы (агент, curl, сохранённая форма).

**Корень:** одно и то же имя сравнивается двумя правилами в соседних функциях

---

### H3-007 · low · Комментарий `templates_owner_updated_idx` обещает порядок, который двум его потребителям не подходит

**Место:** `src/shared/db/schema.ts:498-505`

**Что не так:** индекс объявлен `on(t.ownerId, t.updatedAt.desc().nullsFirst(), t.id)`, то есть
`(owner_id, updated_at DESC NULLS FIRST, id ASC NULLS LAST)`, и комментарий над ним утверждает:
«порядок этих выдач доопределён до `id` (feed.ts, profile-lists.ts) … С `id` в индексе порядок
выдаётся индексом целиком».

Для `getUserTemplates` (`src/features/library/queries/feed.ts:246`) это правда: там
`orderBy(desc(updatedAt), asc(id))` — совпадает с индексом по всем трём колонкам. Но два
других потребителя сортируют `id` в другую сторону: `getPinnedTemplates`
(`feed.ts:209`) и `getPinnableLists` (`src/features/profile/queries.ts:126`) используют
`desc(templates.id)`. По третьей колонке индекс им не годится, и равные `updated_at`
по-прежнему дорешиваются сортировкой в рантайме — ровно то, что комментарий объявляет
устранённым. (Сами эти две выдачи между собой согласованы — `desc(pinned), desc(updatedAt),
desc(id)` и `desc(updatedAt), desc(id)` дают один и тот же порядок, так что дефекта в выборе
«разных шести» тут нет.)

**Сценарий отказа:** владелец с 518 списками открывает окно «Customize your pins».
`getPinnableLists` фильтрует по `owner_id` и просит `ORDER BY pinned DESC, updated_at DESC, id DESC`.
Индексом отдаются первые две колонки, третья добирается Incremental Sort — то есть заявленного
«порядок выдаётся индексом целиком» не происходит, хотя схема утверждает обратное и платит за
третью колонку на каждой записи в `templates`.

**Почему это дефект:** расхождение утверждения в схеме с формой запросов, на которые оно
ссылается поимённо. Последствие мелкое (группы равных `updated_at` короткие, у закреплённых
потолок — 6 строк), поэтому severity low; ценность находки в том, что комментарий вводит в
заблуждение следующего, кто будет править этот индекс.

**Уверенность:** confirmed

**Корень:** комментарий к индексу описывает запросы, которые с тех пор разошлись с ним

---

## Таблица 1 — `onConflict` → ограничение

45 вызовов (грепом 53 совпадения: 45 вызовов + 8 упоминаний в комментариях и описаниях
инструментов). **Все цели совпадают с уникальным ограничением по составу и порядку колонок.**

### С явной целью (22)

| # | Файл:строка | Цель `onConflict` | Ограничение в `schema.ts` | Совпадение |
|---|---|---|---|---|
| 1 | `app/api/push/subscribe/route.ts:21` | `pushSubscriptions.endpoint` | `.unique()` на `endpoint` (1096) | ✓ |
| 2 | `features/admin/feed-actions.ts:51` | `feedSources.url` | `feed_sources_url_idx` (2004) | ✓ |
| 3 | `features/analytics/service.ts:17` | `[templateId, visitor, day]` | `template_views_uq` (2476) | ✓ порядок тот же |
| 4 | `features/curation/adapter.ts:63` | `[watches.userId, watches.templateId]` | `watches_user_tpl` (1665) | ✓ |
| 5 | `features/curation/adapter.ts:80` | `[watches.userId, watches.templateId]` | `watches_user_tpl` (1665) | ✓ |
| 6 | `features/feeds/service.ts:157` | `feedItems.key` | `feed_items_key_idx` (2036) | ✓ |
| 7 | `features/generation/service.ts:236` | `[generationId, idx]` | `generation_candidates_gen_idx` (2319) | ✓ |
| 8 | `features/library/draft.ts:102` | `[listDrafts.templateId, authorId]` | `list_drafts_tpl_author` (1166) | ✓ |
| 9 | `features/library/indexnow.ts:285` | `indexnowSubmissions.templateId` | PK (2557-2559) | ✓ |
| 10 | `features/library/suggestion-core/review.ts:47` | `[suggestionId, reviewerId]` | `sug_review_one_per_reviewer` (1273) | ✓ |
| 11 | `features/linkcheck/harvest.ts:66` | `linkChecks.urlNorm` | `.unique()` на `url_norm` (2518) | ✓ |
| 12 | `features/mcp/tools/lists/edit.ts:105` | `[templateId, authorId]` | `list_drafts_tpl_author` (1166) | ✓ |
| 13 | `features/mcp/tools/lists/edit.ts:233` | `[templateId, authorId]` | `list_drafts_tpl_author` (1166) | ✓ |
| 14 | `features/mcp/tools/sources.ts:41` | `knowledgeSources.url` | `knowledge_sources_url_idx` (2104) | ✓ |
| 15 | `features/mcp/tools/suggestions.ts:114` | `[suggestionId, name]` | `sug_reported_check_uniq` (1344) | ✓ |
| 16 | `features/monetization/pro-interest.ts:68` | `proInterest.email` | `pro_interest_email_uq` (2638) | ✓ |
| 17 | `features/quizzes/actions.ts:98` | `[userId, templateId, bid]` | `quiz_attempts_uq` (1826) | ✓ порядок тот же |
| 18 | `shared/agents/policy.ts:91,102,111,124,139` (5 шт.) | `agentLoops.type` | PK `type` (1020) | ✓ |
| 19 | `shared/agents/policy.ts:195` | `agentActions.idempotencyKey` | `agent_actions_idem_idx` (1084) | ✓ |
| 20 | `shared/ai/triples.ts:82` | `[subject, relation, object, lang]` | `knowledge_triples_fact_idx` (2121) | ✓ порядок тот же |
| 21 | `shared/completion.ts:136` | `[courseCompletions.userId, templateId]` | `course_completions_uq` (1863) | ✓ |
| 22 | `shared/settings/kv.ts:23` | `appSettings.key` | PK `key` (881) | ✓ |

### Без явной цели — `onConflictDoNothing()` (23)

Postgres при `DO NOTHING` без спецификации гасит конфликт ПО ЛЮБОМУ ограничению, поэтому
промахнуться мимо цели здесь нельзя по устройству. Проверено отдельно: ни один
`onConflictDoUpdate` в кодовой базе не остался без цели (Postgres такого и не принял бы).

`admin/collection-actions.ts:20` (`collections.slug`), `:90` (`collection_items_uq`) ·
`admin/hire.ts:103` (PK `council_experts.id`) · `catalogs/adapter.ts:9` (`repo_owner_name`) ·
`changelog/service.ts:214` (`changelog_ext_idx`) · `collab/actions.ts:52` (`collab_tpl_user`) ·
`curation/adapter.ts:29` (`stars_user_tpl`), `:87` (`watches_user_tpl`) ·
`dig/actions.ts:101` (`dig_layers_step_level_idx`) · `dig/guide.ts:131` (`dig_guides_step_idx`) ·
`library/reindex.ts:91` (PK `list_links(from_id,to_id)`) ·
`library/suggestion-core/branch.ts:110` (частичный `suggestions_open_branch`) ·
`library/viewed-actions.ts:49` (`sug_viewed_uq`) · `settings/actions.ts:137` (`user_redirects.handle`) ·
`tags/actions.ts:43,58,83` и `tags/service.ts:15` (PK `tags.slug`) ·
`shared/ai/roster.ts:350` (PK `council_experts.id`).

**Отдельно проверено — nullable-колонки в уникальных целях.** В Postgres `NULL <> NULL`, поэтому
уникальность на nullable-колонке дубликаты не ловит. Таких целей четыре:
`agent_actions.idempotency_key`, `changelog_entries.external_id`, `suggestions.number`,
`course_completions.template_id`. Во всех четырёх случаях путь записи, пользующийся
`onConflict`, подставляет непустое значение (проверено по каждому вызывающему), а строки с
`NULL` кладутся другими путями, которым уникальность и не нужна. Дефекта нет.

## Таблица 2 — лента → индекс

Девять поверхностей: семь через `keysetStep` (все вызовы в репозитории) и две горячие
`orderBy`+`limit` на витрине.

| Поверхность | Файл | Колонки порядка | Индекс | NULLS | В узде `index-nulls-order`? |
|---|---|---|---|---|---|
| Журнал аудита | `features/admin/audit-queries.ts:40` | `created_at DESC, id DESC` | `audit_log_created_idx` (2823) | `.desc().nullsFirst()` на обеих | форма — да |
| Тред обсуждения | `features/discussions/queries.ts:150` | `created_at ASC, id ASC` | `discussion_comments_discussion_idx` (1633) | ASC, `NULLS LAST` = дефолт `ORDER BY ASC` | н/п (ASC) |
| Тред задачи | `features/issues/queries.ts:391` | `created_at ASC, id ASC` | `issue_comments_issue_idx` (1553) | то же | н/п (ASC) |
| История версий | `features/library/queries/list.ts:203` | `version DESC, id DESC` (keyType `int`) | `template_versions_tpl_version` (601) | обратный скан ASC-индекса даёт `DESC NULLS FIRST` | н/п |
| Тред правки | `features/library/queries/suggestions.ts:274` | `created_at ASC, id ASC` | `suggestion_comments_sug_idx` (1367) | то же | н/п (ASC) |
| **MCP `resources/list`** | `features/mcp/tools/resources.ts:70` | `created_at DESC, id DESC` | **нет** | — | **нет, и не может быть** → **H3-005** |
| Колокол уведомлений | `features/notifications/queries.ts:82` | `created_at DESC, id DESC` | `notifications_recipient_created_idx` (2871) | `.desc().nullsFirst()` на обеих | форма — да |
| Публичная лента (свежесть) | `features/library/queries/feed.ts:286` | `updated_at DESC` под `publiclyVisible()` | `templates_pub_updated_idx` (492), частичный | `.desc().nullsFirst()` | форма — да |
| Списки профиля / каталога | `feed.ts:246`, `feed.ts:306` | `updated_at DESC, id ASC` | `templates_owner_updated_idx` (505) — для `feed.ts:246`; для каталога только `templates_repository_idx` (506), без порядка | `.desc().nullsFirst()` | форма — да |

Примечания к таблице:

- По истории версий: `template_versions_tpl_version` уникален по `(template_id, version)`,
  поэтому тай-брейк по `id` не может понадобиться — равных `version` внутри одного списка не
  бывает. Форма индекса отличается от буквы правила из `keyset.ts:44`, но по существу
  достаточна; находкой не считаю.
- По каталогу (`feed.ts:306`): под `WHERE repository_id = ?` есть индекс, но он без
  `updated_at`/`id`, то есть порядок добирается сортировкой. Отдельной находкой не оформляю —
  один каталог это десятки списков, а не корпус; фиксирую здесь, чтобы следующий читатель
  не искал заново.
- Про узду. Колонка «в узде» в манифесте предполагала список поверхностей, заданный руками.
  Такого списка в узде нет: `tests/architecture/index-nulls-order.test.ts` читает `schema.ts`
  построчно и требует, чтобы у каждой `.desc()` стояла `.nullsFirst()`, плюс держит
  вырожденность на замке (`descLines().length >= 7`). Это проверка ФОРМЫ индексов, которые
  есть, и она красной была — ею поймали семь колонок. Но пропущенный индекс (H3-005) вне её
  области по устройству.

## Таблица 3 — сырое SQL → схема

**Результат: пустая.** Ни одного идентификатора и ни одного значения enum из
`` sql`` ``-строк, которых нет в `schema.ts`. Как искал — обязательное описание, потому что
пустая таблица без него неотличима от непроверенной:

1. Из `schema.ts` механически извлечены **463** имени (первый строковый аргумент у
   `uuid|text|integer|bigint|boolean|jsonb|timestamp|date|numeric|real|smallint|halfvec|vector|pgTable|pgEnum`)
   и **113** значений enum (все строковые литералы внутри массивов `pgEnum`).
2. Обойдены **1151** файл `.ts`/`.tsx` в `src/` и `scripts/`, кроме самого `src/shared/db/`.
   Из каждого извлечены все `` sql`…` `` и `` sql<T>`…` ``-шаблоны.
3. Внутри каждого шаблона `${…}`-интерполяции вырезаны: там drizzle подставляет колонку
   типобезопасно, и промах поймал бы компилятор. Проверялось только то, что написано в строке
   буквами.
4. Из остатка вынуты все идентификаторы `[a-z_][a-z0-9_]*` длиной ≥ 3 и все строковые
   литералы, и сверены со множествами из п. 1.
5. Полученный остаток разобран вручную, до нуля. В него попали: ключевые слова и функции
   Postgres, не вошедшие в мой стоп-лист (`float8`, `hashtext`, `jsonb_exists`,
   `jsonb_each_text`, `jsonb_array_elements_text`, `jsonb_array_length`, `word_similarity`,
   `ts_rank_cd`, `pg_advisory_xact_lock`, `intersect`); алиасы рекурсивного CTE дерева форков
   (`tree`, `raw_depth`, `visible_parent`, `truncated_children`, `child_count`, `is_cycle`,
   `path`, `parent_id` — все объявлены в том же запросе, `features/library/fork-tree.ts:95`);
   алиасы CTE рудника знаний (`walk`, `seed`, `depth` — `shared/ai/triples.ts:122`); аргументы
   `date_trunc` (`day`, `week`, `month`, `hour`, `second`); конфигурация полнотекста
   (`simple`); языки (`en`, `ru`); пространства advisory-локов (`episode`, `stage`, `claim`);
   значения колонок-`text`, не являющихся enum'ами (`agent` — `users.account_type`,
   `proposed`/`approved` — `agenda_items.status`, `dry-run` — `agent_actions.result_status`,
   `generation` — `ai_usage.ref_type`, `council-run`, `single`, `bid`, `email`).
6. Отдельно прочитаны глазами все места, где сырой подзапрос называет колонки ЧУЖОЙ таблицы
   по имени, — там опечатка компилятором не ловится вовсе:
   `library/queries/shared.ts:55-62` (`template_versions.verification_level`, `verified_at`,
   `template_id`, `version`), `admin/development-queries.ts:129-138` (`agent_actions.action`,
   `result_status`, `signal`, `occurred_at`; `link_clicks.template_id`;
   `suggestions.template_id`, `author_id`; `users.account_type`; `feed_items.published_at`,
   `created_at`, `used_template_id`), `partners/service.ts:151` (те же `feed_items`).
   Все имена есть в схеме.
7. Отдельно сверены значения enum в предикатах частичных индексов самой схемы
   (`templates_pub_*` → `list_status`/`list_visibility`/`moderation_status`;
   `jobs_*` → `job_status`; `suggestions_open_branch` → `suggestion_status`;
   `transfer_one_pending` → `transfer_status`) и в сырых фильтрах приложения
   (`shared/ai/retrieval.ts:69`, `shared/moderation/publication-state.ts:32,35`,
   `features/moderation/queries.ts:88-91`). Совпадают все.

## Проверено и признано корректным

- **`templates_owner_fork_uq` на nullable-колонке** (`schema.ts:481`). Выглядит как ошибка —
  уникальность по `(owner_id, forked_from_id)` сломала бы создание второго обычного списка.
  Но `forked_from_id` у обычных списков `NULL`, а `NULL <> NULL`, поэтому уникальность
  действует ровно на форки. Комментарий это и говорит; проверено, верно.
- **Цепочка переездов A→B→C** (`resolve-list.ts:144-162`). Работает без переписывания старых
  редиректов, потому что `list_redirects` хранит `template_id`, а не целевой слаг. Гипотеза
  манифеста предполагала обратное.
- **`keysetStep` — условие и порядок одной сущностью** (`keyset.ts:61-84`). `scanDesc`
  выводится из пары `(order, dir)`, а не задаётся отдельно, поэтому `<`/`>` не может разойтись
  с `desc`/`asc`. Шаг назад разворачивается ПОСЛЕ отсечения строки-разведчика
  (`keyset.ts:129-130`) — порядок операций верный, ближайшая к читателю строка не теряется.
- **`cursorKey` берёт ключ текстом, а не значением** (`keyset.ts:96-98`). Обход обрезки
  микросекунд драйвером; та же причина, по которой `list_drafts.rev` — счётчик, а не
  `updated_at` (`schema.ts:1153-1162`), и по которой `indexnow_submissions.sent_updated_at`
  пишется из текстовой формы (`schema.ts:2551-2554`). Правило применено последовательно в трёх
  местах.
- **`escapeLike`** (`like.ts:21`). Экранирует `\`, `%`, `_`, причём слэш первым — порядок
  важен, и он верный. Подпёрто уздой `tests/architecture/like-escaping`.
- **`movedPath`** (`moved-list.ts:20-29`). Подхватывает только точную границу сегмента
  (`/`, `?`, `.`), так что `/miki/api-old` не перехватывается адресом `/miki/api`.
- **FK `templates.forked_from_id` → `set null`** (`schema.ts:452`) и
  **`course_completions.template_id` → `set null`** (`schema.ts:1842`). Оба выглядят как
  забытый каскад, но оба — осознанные решения с объяснением в комментарии, и оба верны:
  форк не должен уходить вместе с исходником, сертификат — вместе с курсом.
- **`dayUtc()`** (`features/analytics/visitor.ts:17`). Граница суток от часового пояса
  процесса не зависит — `toISOString()` всегда UTC.
- **Нормализация ников до нижнего регистра на входе** (`shared/auth/handle-input.ts:19`) —
  есть, и `resolveUserByHandle` её уважает. Проблема только в `resolveListBySlug` (H3-006).
- **`Executor`** (`index.ts:69`). Тип «пул или транзакция вызывающего» — способ не дать
  помощнику взять отдельное соединение в обход замка. Через Proxy тип разрешается корректно:
  `tx`, приходящий в колбэк, — настоящий объект drizzle, не прокси.
