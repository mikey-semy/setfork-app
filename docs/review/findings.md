# Находки ревью

> Файл СГЕНЕРИРОВАН из `findings.jsonl` командой `npm run review -- findings`.
> Не редактируй его руками — правь jsonl и перегенерируй.

Открыто: **68** из 85 записей.

## high (5 открыто / 8)

| id | блок | статус | место | что не так |
|---|---|---|---|---|
| H1-001 | H1 | open | `src/features/auth/actions.ts:47` | Регистрация по e-mail сверяет занятость ника прямым запросом в users и минует handleTaken(), то есть 180-дневное удержание прежнего ника в user_redirects |
| H15-001 | H15 | fixed | `src/core/domain/destructive-command.ts:155` | Префикс echo/printf пропускает строку ЦЕЛИКОМ: PRINTS_ONLY снимает и запрет публикации, и пометку разрушительного пункта |
| H15-002 | H15 | fixed | `src/app/[handle]/[slug]/[...git]/route.ts:200` | Версия, созданная проекцией git push, минует assertNoDestructiveSteps: страж стоит только на фасаде ListStore, а ядро проецирует коммит в версию мимо него |
| H2-002 | H2 | fixed | `src/features/library/suggestion-core/merge.ts:94` | страж исполняемых команд на пути слияния получает пустой список блоков при недоступном снимке и проходит вхолостую |
| H2-012 | H2 | open | `src/features/library/actions/suggestion-items.ts:109` | предсказанный фронтом номер версии замерзает в list.json ветки, и после двух опубликованных версий git конфликтует по этой строке — а продукт такой конфликт не видит и разрешить не даёт |
| H5-002 | H5 | open | `src/shared/quota.ts:104` | На яндекс/гигачат/selectel обе денежные страховки могут молчать одновременно: цена модели вне прайс-книги пишется нулём, а пол баланса работает только у OpenRouter |
| H5-011 | H5 | open | `src/shared/quota.ts:119` | Пол остатка OpenRouter применяется при ЛЮБОМ активном провайдере: пустой счёт OpenRouter останавливает ИИ, работающий на Яндексе/Selectel/GigaChat |
| H5-019 | H5 | open | `src/shared/ai/credits.ts:33` | Ответ 200 с неожиданным телом даёт remaining=0, кладётся в кеш как валидный и глушит ИИ на всём инстансе — fail-closed там, где quota.ts:117 обещает best-effort |

## medium (29 открыто / 38)

| id | блок | статус | место | что не так |
|---|---|---|---|---|
| H1-004 | H1 | open | `src/features/mcp/tools/lists/write.ts:43` | Пишущие инструменты MCP отвечают «forbidden: you are not the owner» на список, который проситель не вправе видеть, а на несуществующий — «list not found»: разница ответов подтверждает существование приватного |
| H1-011 | H1 | open | `src/features/notifications/display.ts:43` | Письмо и web-push берут заголовок и адрес списка без проверки видимости, хотя лента уведомлений и счётчик непрочитанного те же строки прогоняют через canViewList |
| H15-003 | H15 | fixed | `src/core/domain/destructive-command.ts:44` | Запрет rm -rf / снимают кавычки вокруг пути и длинные флаги GNU; haltsMachine якорен на конец строки, breaksPermissions требует флаг перед режимом, mkfs не знает формы -t |
| H15-005 | H15 | open | `src/core/domain/quiz.ts:54` | shuffleSort на самых частых для sort-теста данных возвращает эталонный порядок без изменений, то есть показывает ученику готовый правильный ответ |
| H15-006 | H15 | open | `src/core/domain/quiz.ts:72` | shuffleSort и matchRights сортируют через localeCompare без явной локали: чистая функция ядра даёт разный ответ на одних входных данных в зависимости от окружения |
| H15-007 | H15 | open | `src/core/domain/access.ts:129` | canRunList не зовёт ни одна строка продукта (только тест), и путь MCP start_run запускает прогон архивного списка |
| H15-013 | H15 | open | `src/features/collab-store/store.ts:22` | Предложение правки теряет danger, needsHuman и needsHumanAsk на границе порта CollabStore, а удалённая реализация — ещё и blockId, хотя проводной NewStep все четыре поля объявляет |
| H2-001 | H2 | fixed | `src/features/git/core.remote.ts:113` | branchSnapshot отдаёт null и на сбое связи, поэтому страница предложения утверждает «ветка удалена» про живую ветку |
| H2-003 | H2 | open | `src/features/library/suggestion-core/merge.ts:103` | настройка linearOnly пропускается, когда mergeState вернул null: `if (state && …)` |
| H2-004 | H2 | open | `src/features/git/push-effects.ts:128` | сбой связи при материализации магической ветки записывается как «ветка не разворачивается в список», задача завершается успешно и повтора не будет |
| H2-005 | H2 | fixed | `src/features/git/list-content.ts:45` | toWireContent не шлёт danger/imageKey/needsHuman, а ядро переносит их только по block_id из ТЕКУЩЕЙ версии — у блока, которого там нет, пометки теряются молча |
| H2-007 | H2 | open | `src/app/[handle]/[slug]/load.ts:65` | listBranches().catch(() => []) делает пустой список веток неотличимым от отказа ядра, и адрес ветки показывает содержимое main |
| H2-009 | H2 | fixed | `tests/architecture/version-base-declared.test.ts:78` | сторож правила #938 сканирует только вызовы listStore.addVersion и по построению не видит три маршрута, создающих версию в ядре (mergeBranch, mergeResolved, проекция receivePack) |
| H3-001 | H3 | open | `src/shared/db/index.ts:38` | В production drizzle-клиент не кэшируется нигде и строится заново на каждое чтение свойства db — кэш поставлен только в ветке NODE_ENV !== 'production' |
| H3-008 | H3 | open | `src/features/transfer/actions.ts:98` | Смена владельца списка не оставляет записи в list_redirects, поэтому прежний адрес /owner/slug умирает — в отличие от переименования, которое его сохраняет |
| H5-001 | H5 | open | `src/shared/quota.ts:51` | freeGenQuota считает строки generations без фильтра по статусу — сорвавшаяся генерация съедает слот месячного лимита Free |
| H5-003 | H5 | duplicate | `src/shared/ai/credits.ts:29` | При сбое эндпоинта кредитов возвращается кэш любого возраста, и fresh:true этого не пробивает — пол остатка тихо перестаёт быть защитой |
| H5-004 | H5 | open | `src/features/generation/service.ts:37` | Месячный лимит совета дебетуется по refId=generationId, а считается count(distinct refId) — все витки одной генерации списывают один слот |
| H5-005 | H5 | open | `src/features/mcp/gnome.ts:31` | Number(process.env.X ?? 10): пустая или мусорная переменная даёт 0/NaN и наглухо закрывает лимит вопросов гному, отвечая чужой причиной |
| H5-006 | H5 | open | `src/shared/ai/embeddings.ts:192` | embedTexts тратит и пишет ai_usage, но не спрашивает globalBudgetOk: расход входит в знаменатель дневного капа и сам под кап не попадает |
| H5-012 | H5 | duplicate | `src/features/generation/service.ts:39` | Месячный лимит совета считает count(distinct ref_id), то есть ГЕНЕРАЦИИ, а не доставленные советы: один тред расходует до MAX_VARIANTS=6 советов за единицу лимита |
| H5-013 | H5 | open | `src/shared/ai/credits.ts:30` | При сбое /credits возвращается кэш ЛЮБОГО возраста, в том числе когда явно запрошен fresh — «живой остаток» в горячей зоне оказывается часовой давности |
| H5-014 | H5 | open | `src/shared/ai/generate.ts:235` | Упавший по таймауту вызов пишется с cost=0 и нулевыми токенами, хотя провайдер тарифицирует уже сгенерированное — трата уходит мимо дневного капа |
| H5-015 | H5 | duplicate | `src/shared/ai/index-run.ts:217` | Массовая индексация (embedTexts батчами) не спрашивает globalBudgetOk — целый класс платного расхода не покрыт объявленной страховкой от runaway |
| H5-016 | H5 | duplicate | `src/shared/quota.ts:51` | freeGenQuota считает строки generations, то есть ПОПЫТКИ: виток, не давший ни одного кандидата, навсегда съедает месячный слот free-тарифа |
| H5-020 | H5 | open | `src/app/api/[transport]/route.ts:35` | Второй экземпляр корня сырого Number(process.env): пустая SETFORK_MCP_RATE_PER_MIN даёт limit=0 и закрывает ВЕСЬ MCP-транспорт ответом 429 |
| H5-021 | H5 | open | `src/shared/ai/generate.ts:408` | outcome:'ok' пишется ДО проверки ответа: перевод журналируется успехом и тут же отбраковывается, поэтому щиток надёжности видит 100% успеха при неработающей кнопке |
| V1d-001 | V1d | open | `src/features/library/actions/forks.ts:101` | «Использовать как шаблон» собирает шаги рукописным маппингом и теряет needsHuman, needsHumanAsk, blockId и danger — соседняя forkTemplate в том же файле три из них переносит, общий toStepInput не зовётся |
| V1d-002 | V1d | open | `src/features/library/actions/forks.ts:214` | Форк теряет пометку «разрушительный пункт»: маппинг чинили дважды (needsHuman, blockId), а danger не доложили, и toStepInput с его тристейтом не зовётся |
| V1d-003 | V1d | open | `src/features/generation/actions.ts:333` | Приём сгенерированного кандидата пишет шаги третьим рукописным маппингом и выбрасывает needsHuman/needsHumanAsk, вычисленные восемью строками выше, а также blockId и danger |
| V1d-004 | V1d | fixed | `tests/features/library/fork-invariants.itest.ts:88` | Тест «копия шага несёт защитные поля» не импортирует forkTemplate вовсе: проверяемый маппинг переписан внутри теста, то есть подменено само проверяемое правило |
| V1d-005 | V1d | open | `src/features/library/actions/versions.ts:127` | updateListMeta — единственный путь записи канонической меты без гейта архива и заморозки: проверяется только владение, canEditList не зовётся, форма GeneralSection про состояние списка не знает |
| V1d-006 | V1d | open | `src/features/mcp/tools/lists/edit.ts:107` | update_list пишет полную замену состава без expectedVersion, и baseVersion нет даже в схеме инструмента, хотя patch_list его требует, а обзор сервера обещает агенту защиту от перезаписи чужой правки |
| V1d-007 | V1d | open | `src/features/library/suggestion-core/apply.ts:65` | Принятие предложения «из пунктов» пишет версию без expectedVersion и без сравнения base_version с текущей, и через MCP об устаревшей базе не сообщает ничто: ни очередь, ни описание инструмента, ни ворота |
| V1d-010 | V1d | open | `src/features/library/actions/forks.ts:75` | useTemplate проверяет видимость источника своим условием (только visibility === 'private') вместо доменного canViewList, который зовёт форк: черновик и снятый модерацией список копируются |
| V1d-011 | V1d | open | `src/features/library/actions/ai.ts:277` | Перевод списка и проход садовника пишут версию без expectedVersion, хотя механизм существует, применён соседями и по-настоящему сверяет версию в транзакции ядра под замком строки |
| V1d-012 | V1d | open | `src/features/library/actions/ai.ts:243` | Перевод списка — четвёртый рукописный конвертер шагов: он переносит blockId, type, content и «нужен человек» с комментариями, а danger не переносит, и тристейт в toStepInput подменяет решение автора мнением детектора |
| V1d-013 | V1d | open | `src/features/library/draft.ts:30` | Замок рабочей копии сериализует только MCP против MCP: сохранение из редактора идёт мимо lockList и не сверяет rev, поэтому гонка «патч и сохранение человеком», названная в комментарии к замку, открыта |

## low (34 открыто / 39)

| id | блок | статус | место | что не так |
|---|---|---|---|---|
| H1-002 | H1 | open | `src/shared/auth/oauth-server.ts:141` | Одноразовость кода авторизации и ротация refresh-токена проверяются ПЕРЕД UPDATE, а условия в самом UPDATE нет и число затронутых строк не смотрят |
| H1-003 | H1 | open | `src/app/api/auth/yandex/callback/route.ts:8` | Callback Яндекса и VK и поллинг Telegram не спрашивают oauthEnabled(), хотя для GitHub это правило написано и исполнено: «провайдер проверяется на ОБОИХ концах» |
| H1-005 | H1 | open | `src/app/sitemap.ts:67` | Карта сайта подаёт поисковику адреса профилей всех авторов индексируемых списков, не спрашивая users.profilePrivate, хотя сама страница закрытого профиля отвечает 404 и ставит noindex |
| H1-006 | H1 | open | `src/features/auth/passkeys.ts:148` | Вход по passkey создаёт сессию напрямую, минуя развилку totpEnabled, которая есть на пути пароля и OAuth; userVerification стоит 'preferred', то есть вторым фактором сам ключ не гарантирован |
| H1-007 | H1 | open | `src/app/[handle]/[slug]/releases.atom/route.ts:60` | Atom-фид релизов не входит в единую кеш-политику машинных поверхностей: отдаёт public, max-age=60 без ETag, а отказ — вообще без заголовков кеша |
| H1-008 | H1 | open | `src/app/[handle]/[slug]/export/route.ts:15` | export и repo.bundle не разбирают Authorization: Bearer, хотя raw, data.json и git-транспорт того же списка токен принимают |
| H1-009 | H1 | open | `tests/security/server-action-actor-identity.test.ts:54` | Караул «личность не приходит аргументом в экшен» не видит стрелочные экспорты и обрывает разбор списка параметров на первой закрывающей скобке |
| H1-010 | H1 | open | `src/features/digest/queries.ts:61` | Предикат «опубликован + публичный + прошёл модерацию» живёт рукописными копиями в 14 файлах помимо publiclyVisible()/isPubliclyVisible(), заведённых ровно против этих копий |
| H1-012 | H1 | open | `src/features/collab/actions.ts:26` | Выдача прав соавтору ищет человека точным eq(users.handle) и при промахе молча ничего не делает: ник в другом регистре, прежний ник или опечатка выглядят как принятые |
| H15-004 | H15 | open | `src/core/domain/quiz-fingerprint.ts:21` | В отпечаток теста входит ПОРЯДОК вариантов ответа, хотя докстрока обещает, что порядок отображения в него не входит |
| H15-008 | H15 | open | `src/core/domain/quiz.ts:145` | gradeBlank обходит массив blanks, а не число пропусков в шаблоне: лишние пропуски не оцениваются вовсе |
| H15-009 | H15 | open | `src/core/domain/links.ts:25` | normalizeUrl проверяет длину ВХОДА, а выход после percent-encoding режет slice — возвращается обрезанная строка вместо null |
| H15-010 | H15 | open | `src/core/domain/quiz.ts:121` | stripQuizAnswers снимает только поля СВОЕГО вида теста: при любом kind в контенте остаются носители эталона остальных видов, а ветка default не снимает ничего, кроме correct |
| H15-011 | H15 | open | `src/core/domain/links.ts:59` | walkStrings обходит произвольный JSON прямой рекурсией без ограничения глубины и без множества посещённых |
| H15-012 | H15 | rejected | `src/core/domain/quiz-fingerprint.ts:19` | Отвергнуто: «редактор при первом сохранении пишет kind:'choice' явно и отпечаток легаси-теста меняется» — такого пути нет, kind для choice намеренно опускается |
| H15-014 | H15 | open | `src/shared/ai/adapter.ts:7` | Адаптер AiPort.embed выбрасывает объявленный портом meta для учёта стоимости, а в EmbedMeta нет поля feature вовсе |
| H2-006 | H2 | open | `src/app/[handle]/[slug]/repo.bundle/route.ts:14` | gitCore.bundle — единственный метод адаптера без обёртки ошибок, и он никогда не возвращает null, поэтому ветка `if (!buf) return 500` мертва |
| H2-008 | H2 | fixed | `src/app/[handle]/[slug]/suggestions/[id]/edit/page.tsx:57` | правка пунктов ветки зовёт toEditorItems с пустыми превью — единственный из четырёх вызовов, тогда как соседние пути считают превью обязательными |
| H2-010 | H2 | open | `src/features/git/ConflictResolver.tsx:144` | подпись под кнопкой обещает merge-коммит, а экшен шлёт mode из настроек списка и на squash ядро делает коммит с одним родителем |
| H2-011 | H2 | open | `src/features/git/README.md:22` | README блока говорит «Write: owner only», хотя с Ф5 пишут владелец, соавтор и любой с write-токеном на открытом списке; там же «git binary at runtime» противоречит тексту ниже |
| H2-013 | H2 | fixed | `tests/architecture/version-base-declared.test.ts:40` | докблок сторожа обещает ловить «появление девятого маршрута мимо решения», хотя признак у него один — вызов фасада; границу надо назвать прямо, иначе зелёный сторож примут за доказательство |
| H3-002 | H3 | open | `src/shared/db/schema.ts:1578` | content_edits и reactions не чистятся при удалении списка, хотя комментарии схемы утверждают, что это делает каскад владельца |
| H3-003 | H3 | open | `package.json:27` | db:migrate и db:generate остались рабочими скриптами и ведут в журнал миграций, не обновлявшийся с 20.07.2026, при том что схема накатывается только push |
| H3-004 | H3 | open | `src/shared/db/index.ts:32` | DB_POOL_MAX/DB_POOL_MIN читаются сырым Number(...)\|\|d с клампом: заданное значение может молча не подействовать, а мусор неотличим от «не задано» |
| H3-005 | H3 | open | `src/features/mcp/tools/resources.ts:70` | Keyset-лента MCP resources/list по (templates.created_at, id) не имеет индекса ни одной из нужных форм |
| H3-006 | H3 | open | `src/shared/db/resolve-list.ts:33` | Ник сравнивается регистрозависимым eq в resolveListBySlug и getListMeta, а через lower() — в соседней resolveUserByHandle; ники при этом хранятся в нижнем регистре |
| H3-007 | H3 | rejected | `src/shared/db/schema.ts:498` | Отвергнуто: комментарий templates_owner_updated_idx называет feed.ts и profile-lists.ts, и оба названных потребителя сортируют desc(updatedAt), asc(id) — ровно как индекс |
| H5-007 | H5 | open | `src/shared/quota.ts:40` | Снятие лимитов админу читает ник из JWT, тогда как админский гейт сознательно перечитывает его из БД — снятые лимиты живут до 30 дней после смены ника |
| H5-008 | H5 | open | `tests/features/money/budget-window.itest.ts:20` | Тест окна дневного капа ни разу не кладёт расход за границу окна — подмена суток месяцем или годом остаётся зелёной |
| H5-009 | H5 | open | `src/shared/ai/generate.ts:434` | Упавший вызов перевода не пишется в ai_usage — единственная точка вызова модели, освобождённая от правила «каждый физический вызов в журнал» |
| H5-010 | H5 | open | `src/features/mcp/council.ts:26` | council_draft не проверяет globalBudgetOk и обещает агенту совет, которого не будет |
| H5-017 | H5 | open | `src/shared/quota.ts:40` | Денежные квоты снимаются по isAdminHandle, а не по planFor/isPro — ровно та ошибка, которую entitlements.ts запрещает вслух |
| H5-018 | H5 | open | `src/shared/quota.ts:64` | aiQuota суммирует cost_usd без учёта outcome: вызовы, вернувшие мусор вместо JSON (outcome='invalid'), списывают месячный бюджет пользователя, ничего ему не отдав |
| V1d-008 | V1d | rejected | `src/features/mcp/tools/lists/edit.ts:168` | Отвергнуто: patch_list с publish:false и правда не зовёт listWritable под замком, но сценария за этим нет — ownedList спрашивает canEditList в начале КАЖДОГО вызова, и остаётся окно в доли миллисекунды |
| V1d-009 | V1d | open | `src/features/library/actions/verification.ts:33` | setVerificationLevel адресует версию номером, прочитанным до записи, без условия «эта версия всё ещё текущая», и возвращает ok:true, когда уровень лёг на версию, переставшую быть текущей |
| V1d-014 | V1d | open | `src/features/library/draft.ts:33` | Сохранение черновика из редактора — единственная запись в рабочую копию без стража исполняемых команд: обе ветки MCP зовут assertNoDestructiveSteps и объясняют зачем, upsertDraft не зовёт |
| V1d-015 | V1d | open | `src/features/gardener/sweep/readiness-gate.ts:80` | Садовник публикует свой черновик безусловным UPDATE мимо publishOwnedDrafts: ни статуса, ни видимости, ни владельца, ни архива с заморозкой, ни модерации в условии запроса нет |
| V1d-016 | V1d | open | `src/features/library/actions/versions.ts:283` | «Вернуть эту версию» и «Принять правку» не спрашивают canEditList, а бэкстоп фасада бросает обычный Error вместо ListWriteError — в архиве и заморозке человек получает безымянную страницу ошибки |
| V1d-017 | V1d | open | `src/shared/db/schema.ts:865` | У embeddings.ref_id нет внешнего ключа на templates, поэтому удаление списка не трогает его строки в корпусе: текст удалённого списка лежит там плейнтекстом до следующего ПОЛНОГО реиндекса |

