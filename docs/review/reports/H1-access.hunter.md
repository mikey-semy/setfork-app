# H1 — отчёт охотника

Блок: **H1 · Доступ и видимость**. Дерево `review/h1-access`, `HEAD..origin/master` пуст
(сверено до находок — дерево не устаревшее).

## Охват

- прочитано файлов: **58 из 58** (все файлы блока, целиком).

### Список прочитанных файлов блока (поимённо)

```
src/app/api/auth/demo/route.ts
src/app/api/auth/github/callback/route.ts
src/app/api/auth/github/route.ts
src/app/api/auth/logout/route.ts
src/app/api/auth/telegram/poll/route.ts
src/app/api/auth/telegram/route.ts
src/app/api/auth/vk/callback/route.ts
src/app/api/auth/vk/route.ts
src/app/api/auth/yandex/callback/route.ts
src/app/api/auth/yandex/route.ts
src/features/auth/AuthForms.tsx
src/features/auth/PasskeyLoginButton.tsx
src/features/auth/PasswordResetForms.tsx
src/features/auth/SignInMethods.tsx
src/features/auth/TelegramLoginWatcher.tsx
src/features/auth/TwoFaLoginForm.tsx
src/features/auth/actions.ts
src/features/auth/email-flows.ts
src/features/auth/link-actions.ts
src/features/auth/link-identity.ts
src/features/auth/oauth-entry.ts
src/features/auth/oauth-finish.ts
src/features/auth/oauth-next.ts
src/features/auth/passkey-core.ts
src/features/auth/passkeys.ts
src/features/auth/signed-cookies.ts
src/features/auth/token-helpers.ts
src/features/auth/twofa.ts
src/features/sessions/SessionsList.tsx
src/features/sessions/actions.ts
src/features/sessions/queries.ts
src/middleware.ts
src/shared/auth/admin-handle.ts
src/shared/auth/admin.ts
src/shared/auth/api-token.ts
src/shared/auth/app-origin.ts
src/shared/auth/handle.ts
src/shared/auth/identities.ts
src/shared/auth/oauth-meta.ts
src/shared/auth/oauth-server.ts
src/shared/auth/oauth.ts
src/shared/auth/passkey-error.ts
src/shared/auth/password-policy.ts
src/shared/auth/password.ts
src/shared/auth/safe-next.ts
src/shared/auth/session.ts
src/shared/auth/tokens.ts
src/shared/auth/totp.ts
src/shared/auth/users.ts
src/shared/auth/webauthn.ts
src/shared/list-visibility.ts
tests/features/auth/link-identity.itest.ts
tests/features/auth/login-keeps-email.test.tsx
tests/features/auth/oauth-next.test.ts
tests/features/auth/passkey-error.test.ts
tests/features/auth/passkey-options.test.ts
tests/features/auth/register-admin-handle.itest.ts
tests/security/server-action-actor-identity.test.ts
```

### Не прочитано из блока

Пусто — все 58 прочитаны целиком.

### Файлы вне блока, прочитанные ради критерия приёмки (таблицы «маршрут → гейт» и «публичность»)

Прочитаны **целиком**:

```
src/core/domain/access.ts
src/features/library/guard.ts
src/shared/db/visibility.ts
src/shared/db/resolve-list.ts
src/shared/http/cache.ts
src/app/sitemap.ts
src/app/llms.txt/route.ts
src/app/api/list-title/route.ts
src/app/[handle]/[slug]/raw/route.ts
src/app/[handle]/[slug]/data.json/route.ts
src/app/[handle]/[slug]/export/route.ts
src/app/[handle]/[slug]/embed/route.ts
src/app/[handle]/[slug]/badge/[kind]/route.ts
src/app/[handle]/[slug]/releases.atom/route.ts
src/app/[handle]/[slug]/repo.bundle/route.ts
src/app/[handle]/[slug]/opengraph-image.tsx
src/app/[handle]/[slug]/[...git]/access.ts
src/features/library/publish-draft.ts
src/features/mcp/registry/kit.ts
tests/features/mcp/registry.test.ts
```

Прочитаны **фрагментами** (только участки, относящиеся к доступу; за файлы целиком
отвечают их блоки):

```
src/features/settings/actions.ts            (changeHandle, ensureGhostUser, deleteAccount: строки 90–230)
src/features/library/queries/shared.ts      (indexableFilter: 85–110)
src/features/library/suggestion-core/apply.ts   (гейт принятия: 1–70)
src/features/library/suggestion-core/merge.ts   (гейт слияния: 1–80)
src/features/library/suggestion-core/review.ts  (запрет самоотзыва: грепом, строка 36)
src/features/moderation/moderate-list.ts    (gateListPublication: 140–200)
src/features/mcp/tools/lists/delete.ts      (1–46)
src/features/mcp/tools/lists/write.ts       (ownedList: 1–60)
src/features/mcp/tools/reads.ts             (mcpGetList: 44–70)
src/features/mcp/tools/runs.ts              (mcpStartRun: 55–75)
src/features/mcp/tools/shared.ts            (mcpCanView: 24–28)
src/features/notifications/queries.ts       (keepVisible: 1–150)
src/features/transfer/actions.ts            (initiateTransfer: 1–40)
src/app/[handle]/load.ts                    (гейт profilePrivate: 60–110)
src/app/[handle]/page.tsx                   (generateMetadata + noindex: 30–100)
src/shared/db/schema.ts                     (users, user_redirects: 221–260, 518–532)
src/shared/lib/translit.ts                  (translitRu: 1–25)
src/features/digest/queries.ts              (грепом: копия предиката публичности, строки 61 и 76)
```

Свериться с картой корней `setfork-hq/reviews/problems/CLUSTERS.md` удалось: карта
прочитана до записи находок, повторы корней помечены (`K31`, `K37`, `K05`).

### Гипотезы манифеста: что проверено, что нет

| # | Гипотеза | Итог |
|---|---|---|
| 1 | Побочные пути списка | **Проверена по коду** все девять (`raw`, `data.json`, `export`, `embed`, `badge`, `opengraph-image`, `releases.atom`, `repo.bundle`, `[...git]`). Содержимым приватного/чернового/снятого не отвечает ни один. Побочные находки: H1-007, H1-008. Живым запросом не проверял — стенда в этом дереве нет. |
| 2 | Переехавший адрес пускает ЗАПИСЬ | **Проверена, дефекта нет.** `resolveListBySlug` (путь записи) прежние адреса не учитывает намеренно; MCP-запись (`ownedList`) прежний адрес принимает, но владение проверяет по найденному `id`, а не по нику из адреса. |
| 3 | Смена ника: старый ник ведёт к новому владельцу | **Проверена — подтвердилась.** H1-001. |
| 4 | `indexableFilter()` ↔ `publiclyVisible()` | **Проверена.** Для списков и тегов совпадают побайтово (`indexableFilter` = `publiclyVisible`). Расхождение нашлось не в них, а в профилях: H1-005. |
| 5 | Черновик / `pendingEdits` в публичной поверхности | **Проверена частично.** `pendingEdits` отдаются только тому, кто может писать, и только свои (`reads.ts:57`) — чисто. Карта сайта, `llms.txt`, og-картинка, уведомления — чисто. **Ленту и поиск (`features/library/queries/*`, `explore`) целиком НЕ читал** — судил по грепу `publiclyVisible()`. |
| 6 | Скрытое модерацией остаётся доступным | **Проверена, дефекта нет.** `canViewList` закрывает всё, кроме владельца и админа; публикация, удаление, передача и настройки снятого списка заблокированы, «отмыть» флаг сменой видимости нельзя (`gateListPublication`, `where moderation = 'pending'`). Наблюдение без находки — см. «Проверено и признано корректным», п. 6. |
| 7 | Соавтор может больше, чем должен | **Проверена частично.** Удаление, передача владения, настройки и снятие модерации — строго владелец (и админ); соавтор модерационный takedown не обходит (`canViewList`). **`features/collab/actions.ts` (выдача прав другому) я не читал** — эту часть гипотезы назову непроверенной. |
| 8 | Автор предложения принимает своё | **Проверена частично.** Самоотзыв запрещён явно (`review.ts:36`). Слияние своего предложения соавтором возможно — как у GitHub/Gitea, и это названо в коде вслух. **`reviewGates` целиком не читал**, поэтому «обязательное одобрение обходится самим автором» осталось непроверенным. |
| 9 | Уведомление раскрывает содержимое | **Проверена частично.** Лента и счётчик непрочитанного фильтруются `canViewList` (включая счётчик — он не служит сигналом «в приватном что-то произошло»). **До шаблона письма/пуша я не дошёл** — почтовая половина гипотезы не проверена. |
| 10 | Админ-гейт `ADMIN_HANDLES` неточный | **Проверена — опровергнута.** Сравнение точное: `trim().toLowerCase()` обеих сторон + `list.includes(h)`, частичного совпадения нет; `demo` в проде админом не бывает; админ-ники нельзя занять ни регистрацией, ни сменой ника (узда `register-admin-handle.itest.ts` предъявляет оба пути). |
| 11 | read-токен MCP доходит до мутирующего инструмента | **Проверена — опровергнута.** Скоуп вшит в способ регистрации (`kit.ts`), а не в инструмент; `READ_ONLY` в тесте задан независимо от аннотаций, и тест гоняет read-токен по ВСЕМ незарегистрированным-как-чтение инструментам. Завести пишущий инструмент через `readTool` узда ловит расхождением `readOnlyHint ↔ READ_ONLY`. |
| 12 | Серверная проверка опирается на поле из формы | **Проверена частично.** Статический караул есть и работает по существу; точечно проверены `link-actions`, `settings/actions`, `transfer/actions`, MCP-инструменты — личность везде из сессии/токена. Полного обхода всех 71 файла с `'use server'` я не делал. Дыра в самой узде — H1-009. |
| 13 | Снимок пачки: условие не повторено в `UPDATE` | **Проверена для `publish_lists`/`publishOwnedDrafts` — образцово** (владелец, статус, видимость, архив, заморозка и модерация стоят в самом `UPDATE`). **`bulk_create_lists` и пакетную модерацию не читал.** Тот же класс дефекта нашёлся в другом месте — H1-002. |
| 14 | Отказ подтверждает существование | **Проверена — подтвердилась** на записи MCP: H1-004. На HTTP-поверхностях (`raw`, `data.json`, `git`, `list-title`) политика соблюдена. |

## Находки

### H1-001 · high · Регистрация не проверяет удержание прежнего ника — чужой прежний ник достаётся первому желающему
**Место:** `src/features/auth/actions.ts:47`
**Что не так:** регистрация по e-mail проверяет занятость ника одним запросом в `users`
(`eq(users.handle, handle)`), минуя `handleTaken()` — единственное место, где учитывается
таблица `user_redirects` и 180-дневное удержание прежнего ника. Смена ника
(`settings/actions.ts:107`) и OAuth-воронка (`uniqueHandle` → `handleTaken`) через неё ходят,
регистрация — нет.
**Сценарий отказа:** Алиса переименовалась `alice` → `alice-dev`. Её прежний ник лежит в
`user_redirects` и по правилу удержания занят ещё 180 дней: все ссылки вида `/alice/<список>`
и все `git remote` в клонах продолжают вести к ней. Посторонний открывает форму регистрации,
вводит handle `alice` — `users` такой строки не содержит, `user_redirects` не спрашивают,
вставка проходит. Дальше `resolveUserByHandle` сначала ищет живого пользователя и находит
НОВОГО (`shared/db/resolve-list.ts:63`): `/alice` — теперь чужой профиль, а `/alice/<список>`
отвечает «не найдено» вместо перенаправления, потому что `redirectIfUserMoved` до прежнего
ника уже не доходит. Второй порядок: когда новый владелец ника однажды переименуется,
`changeHandle` выполнит `delete from user_redirects where handle in (старый, новый)` без
фильтра по `user_id` (`settings/actions.ts:116`) и сотрёт ЧУЖУЮ запись удержания — остаток
срока Алисы исчезает молча. Третий порядок, если ники совпали и слаг тоже: `git pull` из
старого клона по адресу `/alice/<slug>` начинает тянуть историю ДРУГОГО списка.
**Почему это дефект:** правило удержания записано в коде с обоснованием — «отдать его сейчас
значило бы передать вместе с ним чужой трафик» (`shared/auth/handle.ts:55-59`). Одно из трёх
мест, заводящих ник, это правило не исполняет. Инвариант «право проверяется там, где данные»
и правило H1 «владелец, потерявший доступ к своему».
**Уверенность:** confirmed

### H1-002 · medium · Одноразовость OAuth-кода и ротация refresh проверены ДО `UPDATE`, а не в нём
**Место:** `src/shared/auth/oauth-server.ts:137` (и `:155-162`)
**Что не так:** `exchangeCode` читает строку кода, проверяет `row.usedAt`, и только потом
выполняет `update … set usedAt = now() where id = row.id` — без условия `usedAt is null` в
самом `UPDATE`. `refreshTokens` устроен так же: `isNull(revokedAt)` стоит в `SELECT`, а
`update … set revokedAt` выполняется по одному `id`.
**Сценарий отказа:** перехвативший код авторизации (например, посторонний слушатель на петле —
`isLoopback` разрешает любой порт `http://127.0.0.1:*`) отправляет `POST /token` одновременно
с законным клиентом. Обе транзакции читают `usedAt = null`, обе проходят проверку PKCE
(verifier у них один — он ехал рядом с кодом), обе делают безусловный `UPDATE` и обе получают
по паре токенов с 30-дневным доступом. Законный клиент успешно подключается, поэтому
подмены никто не замечает. Тот же приём на `/token?grant_type=refresh_token` даёт две живые
пары из одного refresh — то есть обнаружение кражи по ротации, обещанное в комментарии
`:146-150`, не срабатывает.
**Почему это дефект:** инвариант 1 («условие обязано стоять В САМОМ `UPDATE`» — три P1 подряд
были этой ошибкой). Намерение прямо записано в коде: «Повторный обмен обязан отказать, а не
выдать второй токен: перехваченный код иначе работает столько раз, сколько его успеют
предъявить» (`:135-137`) — реализация намерения не исполняет.
**Уверенность:** confirmed

### H1-003 · medium · Выключенный провайдер выключен только на старте: callback Яндекса, VK и поллинг Telegram гейта не имеют
**Место:** `src/app/api/auth/yandex/callback/route.ts:8`, `src/app/api/auth/vk/callback/route.ts:9`,
`src/app/api/auth/telegram/poll/route.ts:19`
**Что не так:** правило «провайдер проверяется на ОБОИХ концах» написано и исполнено ровно для
одного провайдера из четырёх. В `github/callback/route.ts:11-16` стоит `if (!oauthEnabled().github)`
с комментарием, объясняющим, зачем это нужно; три остальные точки завершения входа такого
условия не содержат вовсе.
**Сценарий отказа:** сопровождающий выключает провайдера — `AUTH_DISABLED_PROVIDERS=yandex`
(так уже делают: на RU-проде выключен github) — например потому, что у приложения утекли
ключи. Стартовый маршрут перестаёт пускать, но у всех, кто ушёл к провайдеру в последние
10 минут, в браузере лежит живая кука `ya_oauth_state` (`maxAge: 600`). Их возврат проходит
проверку state, код меняется на токен с тем же `YANDEX_CLIENT_SECRET`, `enterWithIdentity`
создаёт сессию — то есть выключенный вход продолжает выдавать сессии, и продолжительность
окна задаётся не решением админа, а сроком жизни куки. Telegram-поллинг то же самое делает
без всякого окна: токен `tg_login` живёт 10 минут, а `oauthEnabled().telegram` в `poll`
не спрашивают ни разу. Привязка идентичности (`intent=link`) проходит этим же путём.
**Почему это дефект:** инвариант 3 («мёртвое право хуже отсутствующего»: админ думает, что
запретил, а запретил не до конца) и правило блока «право проверяется на сервере, на каждом
конце». Сам проект это правило уже сформулировал — в соседнем файле.
**Уверенность:** confirmed

### H1-004 · medium · Запись через MCP отвечает «forbidden» на список, которого проситель не видит, — оракул существования
**Место:** `src/features/mcp/tools/lists/write.ts:43`, `src/features/mcp/tools/lists/delete.ts:28`,
`src/features/mcp/tools/runs.ts:70`
**Что не так:** читающая половина MCP скрывает существование правильно — `mcpGetList`
возвращает `null` и для несуществующего, и для невидимого (`reads.ts:49`). Пишущая половина
сначала находит список БЕЗ фильтра видимости, а потом сравнивает владельца и отвечает
`forbidden: you are not the owner`, тогда как несуществующий даёт `list not found`. Разница
ответов и есть утечка факта.
**Сценарий отказа:** держатель любого MCP-токена (регистрация открыта, токен выдаётся себе
сам) перебирает `delete_list {handle:"alice", slug:"q3-layoffs"}` БЕЗ `confirm` — проверка
владельца стоит раньше проверки `confirm`, поэтому вызов ничего не пишет и ничем не
ограничен. Ответ `forbidden: you are not the owner` означает «такой список у Алисы есть»,
ответ `list not found` — «нет». Так прощупывается существование приватных списков и
черновиков по словарю слагов. `update_list`/`patch_list` дают то же различие и вдобавок
советуют `suggest_edit` на список, которого проситель не видит, — совет, который заведомо
не сработает.
**Почему это дефект:** инвариант 4 («приватное не подтверждает своё существование») и
гипотеза 14 манифеста. Поверхности `raw`, `data.json` и git-транспорт платят ради этого
одинаковым отказом и пишут об этом в комментариях; MCP — та же поверхность и то же
приватное. **Корень: K31** (анти-перечислительная политика не общий контракт) — карточка
не новая, это второе проявление корня, уже названного в карте.
**Уверенность:** confirmed

### H1-005 · medium · `sitemap.xml` отправляет поисковику адреса приватных профилей
**Место:** `src/app/sitemap.ts:67-72` и `:111-116`
**Что не так:** секция авторов собирается по одному признаку — «есть хотя бы один
индексируемый список» — и не спрашивает `users.profilePrivate`. Между тем сама страница
профиля для чужого зрителя отвечает `notFound()` (`src/app/[handle]/load.ts:89`), а её
`generateMetadata` специально ставит `robots: { index: false }` с обоснованием «закрытый
профиль в индексе — это раскрытие через выдачу» (`src/app/[handle]/page.tsx:47-49`). Карта
сайта делает ровно то, что этот код запрещает.
**Сценарий отказа:** человек включает «Приватный профиль» в настройках, оставляя один
публичный список (штатный сценарий — подсказка настройки прямо обещает: «Ваши ПУБЛИЧНЫЕ
списки остаются публичными»). После этого `/sitemap.xml` продолжает подавать поисковику
`https://setfork.com/<его ник>` как адрес к обходу; обходчик приходит, получает 404 и
трактует карту как врущую, а сам адрес закрытого профиля объявлен вслух машинному адресату,
которому запрещено его индексировать другим местом того же кода.
**Почему это дефект:** инвариант 5 («ограничивая выдачу, сразу отвечай, чем достаётся
отрезанное» — здесь ссылка в никуда) и критерий приёмки блока: `indexableFilter()` для
списков и тегов с `publiclyVisible()` сходится, а для профилей отбора нет вовсе.
**Уверенность:** confirmed

### H1-006 · low · Вход по passkey минует второй фактор, и это отклонение нигде не названо
**Место:** `src/features/auth/passkeys.ts:148`
**Что не так:** два пути входа из трёх сверяют `totpEnabled` и уводят на шаг с кодом —
пароль (`actions.ts:86-90`) и OAuth (`oauth-finish.ts:16-21`, с комментарием «второй фактор
обязателен и на OAuth-пути»). `finishPasskeyLogin` зовёт `startSession` напрямую, `users`
читается только ради строки сессии.
**Сценарий отказа:** человек включает 2FA в настройках — интерфейс обещает, что теперь вход
требует код. Его passkey синхронизирован связкой ключей и доступен на втором, разблокированном
устройстве (ровно та причина, по которой `residentKey: 'required'` и включена синхронизация).
Вход на `/login` по passkey создаёт полноценную сессию без TOTP. Обратная сторона того же
места: возврат `next` там тоже теряется — после входа по ключу человека всегда уносит на `/`
(`PasskeyLoginButton.tsx:37`), то есть начатое подключение MCP молча не состоится — поломка,
которую для остальных путей уже чинили.
**Почему это дефект:** GitHub действительно засчитывает passkey за два фактора, и решение
может быть тем же. Но инвариант 14 требует, чтобы отклонение было НАЗВАНО ВСЛУХ: соседние
пути объясняют своё поведение комментарием, а здесь нет ни строки, и по коду отличить
«решили так» от «забыли» нельзя.
**Уверенность:** plausible

### H1-007 · low · `releases.atom` живёт вне общей кеш-политики: 60 секунд публичного окна и отказ без запрета хранения
**Место:** `src/app/[handle]/[slug]/releases.atom/route.ts:58-61` (и `:22`)
**Что не так:** `shared/http/cache.ts` объявляет единую политику машинных поверхностей и
перечисляет пять адресов — `raw`, `data.json`, `embed`, `badge`, `export`; `releases.atom`
в перечень не вошёл и ставит заголовки сам: `public, max-age=60`, без `ETag`. Отказ
(`:22`) отдаётся вообще без заголовков кеша, хотя все соседи зовут `noStoreHeaders()`
именно ради этого.
**Сценарий отказа:** список снимают модерацией (или владелец делает его приватным).
`revalidatePath` до CDN и чужого прокси не достаёт, поэтому до 60 секунд любой анонимный
читатель получает фид с заголовками и текстом релизов уже закрытого списка, ни разу не
задев `isPubliclyVisible`. Зеркально: фид списка, опубликованного минуту назад, какое-то
время остаётся отрицательно закешированным у чужого прокси, потому что 404 разрешено
хранить эвристически.
**Почему это дефект:** ровно тот случай, который разобран в `cache.ts:5-19` («окна свежести
у публичного ответа быть не может… `max-age=60` продолжал бы отдавать содержимое уже
закрытого списка»). **Корень: K05** — второе проявление уже названного корня.
**Уверенность:** confirmed

### H1-008 · low · `export` и `repo.bundle` не принимают API-токен, хотя близнецы принимают
**Место:** `src/app/[handle]/[slug]/export/route.ts:15`, `src/app/[handle]/[slug]/repo.bundle/route.ts:11`
**Что не так:** `raw` и `data.json` разбирают `Authorization: Bearer sf_…` и читают от имени
владельца токена; git smart-HTTP тоже опознаёт токен (`[...git]/access.ts:84`). `export` и
`repo.bundle` зовут гейт, который знает только куку.
**Сценарий отказа:** агент с валидным read-токеном владельца забирает его ПРИВАТНЫЙ список:
`…/raw` — 200, `…/data.json` — 200, `…/export?format=md` — 404, `…/repo.bundle` — 404. При
этом `llms.txt` обещает машинному читателю «Any list is available as markdown: append `.md`
to its address», а `.md` переписывается middleware именно в `export`: обещание исполняется
только для публичных списков, и отличить «нет доступа» от «нет списка» агент не может —
ответ одинаков.
**Почему это дефект:** правило блока «владелец, потерявший доступ к своему» плюс инвариант 8
(отказ не учит следующему шагу: агент, у которого две трети транспортов работают, будет
перебирать третий за деньги пользователя).
**Уверенность:** confirmed

### H1-009 · low · Караул «личность не приходит аргументом» не видит стрелочные экспорты и обрывает разбор сигнатуры на первой `)`
**Место:** `tests/security/server-action-actor-identity.test.ts:54`
**Что не так:** караул ищет только `export\s+async\s+function\s+(\w+)\s*\(([^)]*)\)`. Во-первых,
`export const foo = async (userId: string) => …` — такой же экспорт из файла с `'use server'`
и такая же сетевая точка входа — под шаблон не попадает вовсе. Во-вторых, `[^)]*` обрывает
список параметров на ПЕРВОЙ закрывающей скобке: у сигнатуры
`export async function act(cb: () => void, userId: string)` в проверку уходит строка `cb: (`,
и `userId` караул не увидит.
**Сценарий отказа:** разработчик заводит в `'use server'`-файле
`export const deletePasskeyFor = async (userId: string, id: string) => removePasskey(userId, id)` —
то есть ровно ту дыру, ради которой караул написан (удаление ключей ЛЮБОГО пользователя по
прямому запросу). Караул остаётся зелёным, ревью полагается на него и дыра уезжает в прод.
Сегодня живого нарушителя нет: прогон обоих шаблонов по всем 71 файлу с `'use server'`
не дал ни одного стрелочного экспорта и ни одной сигнатуры с вложенной скобкой — дыра
латентная, но проверяемая.
**Почему это дефект:** инвариант 18 — «сама узда может быть дырявой»; свой второй тест
караул проверяет только на `actorUserId`-варианте и обе эти формы не предъявляет.
**Уверенность:** confirmed

### H1-010 · low · Дайджест повторяет предикат публичности сырым SQL вместо `publiclyVisible()`
**Место:** `src/features/digest/queries.ts:61` и `:76`
**Что не так:** условие «опубликован + публичный + прошёл модерацию» написано строкой внутри
SQL-запроса, тогда как `shared/db/visibility.ts` заведён ровно для того, чтобы такого не было,
и перечисляет в комментарии места, где копии уже жили.
**Сценарий отказа:** добавляется четвёртое состояние модерации (или архив входит в правило
видимости) — `publiclyVisible()` правят в одном месте, все поверхности узнают, а еженедельное
письмо продолжает набирать списки по старому условию и разошлёт в почту подборку, куда попал
список, закрытый на сайте. Расхождение не увидит никто: письмо уходит мимо всех экранов.
**Почему это дефект:** **Корень: K37** (политика живёт не там, где исполняется) — третье
проявление; сейчас значение совпадает, поэтому это риск на будущее, а не живая утечка.
**Уверенность:** confirmed

## Критерий приёмки, таблица 1 — маршрут → гейт

Собрана чтением кода. «Аноним» = без куки и без `Authorization`.

| Маршрут | Кто проверяет | По какому признаку | Что отвечает при отказе |
|---|---|---|---|
| `/{h}/{s}` (страница и вкладки) | `requireViewableMeta` (`library/guard.ts:65`) | `canViewList(meta, {isOwner, isCollaborator, isAdmin})`, админ — по нику ИЗ КУКИ | `notFound()` 404; переехавший адрес → 301, но только если цель видна зрителю |
| `/{h}/{s}/export?format=` | `requireViewableDetail` (только кука) | `canViewList` | `404 Not found`, `private, no-store`. Bearer не принимает — H1-008 |
| `/{h}/{s}.md` | middleware rewrite → `export` | то же | то же |
| `/{h}/{s}/raw` | `requireViewableDetailFor(token)` иначе `requireViewableDetail` | `canViewList`; админом токен не считается | 404 скриптом-заглушкой без адреса и слага, `SF-Reason: not_found`; битый токен → 401; лимит 120/мин/IP |
| `/{h}/{s}/data.json` | то же | то же | `404 {"error":"not_found"}`, `no-store`; битый токен → 401; лимит 120/мин/IP |
| `/{h}/{s}/embed` | `getTemplateDetail` + `isPubliclyVisible` | публичный+опубликованный+active; сессия не смотрится вовсе | 404 HTML, `no-store` |
| `/{h}/{s}/badge/{kind}.svg` | `getListMeta` + `isPubliclyVisible` | то же | `404 Not found`, `no-store` |
| `/{h}/{s}/releases.atom` | `getListMeta` + `isPubliclyVisible` | то же | `404 Not found` БЕЗ заголовков кеша; успех — `public, max-age=60` (H1-007) |
| `/{h}/{s}/opengraph-image` | SQL-предикат `publiclyVisible()` | то же | 200 с НЕЙТРАЛЬНОЙ карточкой — существование не подтверждается |
| `/{h}/{s}/repo.bundle` | `requireViewableMeta` (только кука) | `canViewList` | `404 Not found`; ни Bearer, ни лимита частоты |
| `/{h}/{s}/info/refs`, `git-upload-pack`, `git-receive-pack` | `authorizeGitRead` (`[...git]/access.ts:79`) | аноним — `isPubliclyVisible`; с кредитивом — `canViewList` + соавторство | аноним → 401 `auth_required` (одинаково для приватного и несуществующего, как у GitHub); опознанный → 404 `not_found`; переезд → redirect, только если цель видна |
| push (`git-receive-pack`) | `authorizeGitWrite` → `resolvePushRole` | владелец / соавтор / посторонний с write-токеном при открытом приёме правок; `canEditList` | 403 `access_denied` с причиной; архив/заморозка → `write_disabled` |
| `/api/list-title?h=&s=` | `requireViewableMeta` | `canViewList` | `{title:null}`, `no-store` |
| `/{h}` (профиль) | `loadProfilePage` (`[handle]/load.ts:89`) | `profilePrivate && viewer ≠ owner` | `notFound()`; прежний ник → redirect; мета — `noindex` |
| `/sitemap.xml`, `/llms.txt`, `/llms-full.txt` | `indexableFilter()` = `publiclyVisible()` | публичный+опубликованный+active | закрытое не попадает; профили не фильтруются — H1-005 |
| `/admin/*` | `requireAdmin` → `getAdmin` | ник из БД по неизменяемому `userId` ∈ `ADMIN_HANDLES` | `redirect('/')` |
| режим ремонта | `middleware.isAdminRequest` | ник ИЗ ПОДПИСАННОЙ КУКИ, реестр сессий не спрашивается (названо вслух) | 503: скрипт-заглушка для `/raw`, `text/plain` для машинных, HTML для людей |
| MCP чтение (`get_list`, `get_script`, `get_run`) | `mcpCanView` | `canViewList` без админа | `null` → «не найдено», существование не подтверждается |
| MCP запись (`update/patch/delete_list`, `start_run`) | владение / `mcpCanView` | владелец или соавтор | **`forbidden …` — существование подтверждается (H1-004)** |
| MCP любой инструмент | `kit.ts` | `authInfo.extra.userId`; для пишущих ещё `scopes ∋ write` | `Unauthorized` / `This token is read-only…` |

## Критерий приёмки, таблица 2 — публичность

Эталон: `publiclyVisible()` (SQL, `shared/db/visibility.ts:17`) = `status='published' AND
visibility='public' AND moderation='active'`; `isPubliclyVisible()` (`core/domain/access.ts:72`)
= `canViewList(list, {isOwner:false, isAdmin:false})` — те же три условия, выраженные через
единый предикат. Расхождения между этими двумя нет.

| Потребитель | Чем фильтрует | Сходится? |
|---|---|---|
| `indexableFilter()` | возвращает `publiclyVisible()` напрямую | ✅ побайтово |
| `sitemap.xml` — списки | `indexableFilter()` | ✅ |
| `sitemap.xml` — теги | `indexableFilter()` по спискам (не по реестру тегов) | ✅ |
| `sitemap.xml` — **профили** | только «есть индексируемый список»; `profilePrivate` не спрашивается | ❌ **H1-005** |
| `sitemap.xml` — коллекции | `getCollections()` — не читал | ⚠️ не проверено |
| `llms.txt` / `llms-full.txt` | `indexableFilter()` | ✅ |
| `embed`, `badge`, `releases.atom`, `opengraph-image` | `isPubliclyVisible()` / `publiclyVisible()` | ✅ (у atom расходится не предикат, а политика кеша — H1-007) |
| лента уведомлений и счётчик непрочитанного | `canViewList` построчно | ✅ |
| поиск людей, подписки | `users.deleted = false AND users.profilePrivate = false` | ✅ |
| еженедельный дайджест | рукописная копия триады в сыром SQL | ⚠️ значение совпадает, источник свой — H1-010 |
| `get_list` (MCP) | `mcpCanView` = `canViewList` без админа | ✅ |
| `pendingEdits` в `get_list` | только свои и только тому, кто может писать | ✅ |
| витрина/поиск списков (`features/library/queries/*`) | по грепу — `publiclyVisible()` | ⚠️ целиком не читал |

## Проверено и признано корректным

1. **Последний способ входа.** Правило «дверь снаружи не закрывают изнутри» проведено через
   отвязку провайдера И удаление passkey, считает только ПРИГОДНЫЕ двери (выключенный
   провайдер за вход не считается), и обе операции идут под `select … for update` строки
   пользователя — две отвязки разом аккаунт без входа не оставляют. Узда на реальной БД
   предъявляет и гонку, и выключенный провайдер.
2. **Личность не приходит аргументом.** `startPendingLogin`, `removePasskey`, `applySuggestion`
   вынесены в модули БЕЗ `'use server'` — это приём, а не случайность, и он объяснён в каждом
   файле. Сам караул при этом дыряв (H1-009), но правило соблюдено.
3. **Ник администратора.** Занять нельзя ни регистрацией, ни сменой ника, ни через OAuth
   (`uniqueHandle` ходит через тот же `handleTaken`), сверка занятости регистронезависима
   (`lower(handle)`), `getAdmin()` берёт ник из БД, а не из куки. Гипотеза 10 опровергнута.
4. **Пакетная публикация (`publish_lists`).** Эталон исполнения инварианта 1: владелец,
   статус, видимость, архив, заморозка и модерация повторены В САМОМ `UPDATE`, отчёт
   считается по тому, что реально записалось, а план считается тем же правилом, что и запись.
5. **`safeNext` и цель поездки.** Открытый редирект закрыт на обоих концах (`//evil`, `/\`),
   кука одноразовая, тест предъявляет дефект, а не ноль в счётчике.
6. **Модерационный takedown.** Публикация, удаление, передача владения и смена настроек
   снятого списка заблокированы, «отмыть» флаг повторной публикацией нельзя (`where
   moderation = 'pending'` в самом `UPDATE`). Наблюдение без находки: владелец МОЖЕТ отправить
   новую версию снятого списка через git (`authorizeGitWrite` смотрит `canEditList`, то есть
   только архив и заморозку). Утечки нет — список остаётся невидимым, а версии неизменяемы,
   поэтому запись модерации не стирается; отдельного правила, которое это запрещало бы, я в
   коде не нашёл и опираться мне не на что.
7. **Два источника админства.** `getAdmin()` читает ник из БД, а `guard.ts:38`, `middleware.ts:52`
   и `list-settings.ts:74` — из подписанной куки. Расхождение реально, но сценария я построить
   не смог: `changeHandle` отзывает все прочие сессии и переиздаёт куку текущей, а админ-ник
   нельзя занять ни одним путём. Оставляю следующему ревьюеру как место, куда стоит вернуться,
   если правила смены ника ослабят.
8. **`repo.bundle` без заголовков кеша** — не находка: маршрут объявлен `dynamic = 'force-dynamic'`,
   и Next отдаёт таким обработчикам `no-store` по умолчанию. В отличие от него `releases.atom`
   свой заголовок ставит САМ и перебивает умолчание — поэтому находкой стал именно он.
9. **Телеграм-вход.** Завершение требует кода, присланного ботом в Telegram, то есть relay
   чужой ссылки жертве сессии не даёт; брутфорс кода ограничен пятью попытками на токен, и
   исчерпание гасит токен, а не продлевает окно.
10. **`demo`-вход.** Проверяется и в интерфейсе, и в самом маршруте (прямой POST не проходит),
    `demo` никогда не админ в проде, ник зарезервирован.
