# H2 — отчёт охотника · Контракт с git-ядром

Дерево: `master` @ `379ad0fa` (свежее, `HEAD..origin/master` пусто).
Вторая сторона стыка: `/home/mike/Projects/setfork-core`. ⚠️ Рабочая копия ядра была
на 2 коммита ПОЗАДИ `origin/master`; все утверждения про ядро сверены с
`origin/master` (`b73eba9` + `082b752` + `5f0f375`). Одна кандидатная находка на этом
и отвалилась — см. «Проверено и признано корректным», п. 1.

## Охват

Манифеста `docs/review/blocks/H2-core-contract.md` в дереве НЕТ, поэтому
`review.py prompt H2` не запускается (`error: manifest missing`). Список файлов взят
из `blocks.json` (`paths` блока H2) прямым обходом. Гипотез манифеста проверять было
нечего — их не существует; вместо них шёл список из задания (потеря полей, отказ ядра
как «успех»/пустота, две копии правила, транспорт против существа, сверка версий).

**Прочитано целиком (43 из 45 файлов блока; оставшиеся два дочитаны 22.09 — см. конец отчёта):**

```
cli/README.md
cli/lib.mjs
cli/lib.test.mjs
cli/package.json
cli/sf.mjs
proto/domain_read.proto
proto/git.proto
src/app/[handle]/[slug]/[...git]/access.ts
src/app/[handle]/[slug]/[...git]/route.ts
src/app/[handle]/[slug]/repo.bundle/route.ts
src/features/git/BranchPicker.tsx
src/features/git/CloneDropdown.tsx
src/features/git/ConflictResolver.tsx
src/features/git/README.md
src/features/git/actions.ts
src/features/git/actor-context.ts
src/features/git/branch-label.ts
src/features/git/capabilities.ts
src/features/git/core.remote.ts
src/features/git/core.ts
src/features/git/http-auth.ts
src/features/git/http-body.ts
src/features/git/http-request.ts
src/features/git/http-response.ts
src/features/git/list-content.ts
src/features/git/moved.ts
src/features/git/push-effects.ts
src/features/git/snapshot-steps.ts
src/features/git/three-way.ts
src/features/git/transport-error.ts
src/shared/core-transport.ts
tests/features/git/branch-label.test.ts
tests/features/git/clone-dropdown.test.tsx
tests/features/git/core-capability.test.ts
tests/features/git/http-body.test.ts
tests/features/git/list-content.test.ts
tests/features/git/push-effects.itest.ts
tests/features/git/push-resilience.itest.ts
tests/features/git/push-role.test.ts
tests/features/git/three-way.test.ts
tests/features/git/transport-access.itest.ts
tests/features/git/transport-error.test.ts
tests/features/git/write-gate.itest.ts
```

**Прочитано по существу блока (чужие файлы, находки оформлены — предмет мой, а живёт
он там):**

```
src/core/ports.ts (раздел GitCore, стр. 160–345)
src/app/[handle]/[slug]/load.ts (git-часть)
src/app/[handle]/[slug]/suggestions/[id]/load.ts
src/app/[handle]/[slug]/suggestions/[id]/edit/page.tsx
src/app/[handle]/[slug]/suggestions/[id]/SuggestionNotices.tsx
src/app/[handle]/[slug]/versions/page.tsx (git-часть)
src/app/api/internal/write-allowed/route.ts
src/features/library/suggestion-core/merge.ts, revision.ts
src/features/library/actions/suggestion-branch.ts, suggestion-items.ts, canon.ts
src/features/library/suggestion-blocks.ts
src/features/library/list-content.ts
src/features/library/list-editor/CanonPanel.tsx, StepBlockBody.tsx
tests/architecture/version-base-declared.test.ts
setfork-core@origin/master: proto/*, src/gate.rs, src/reason.rs, src/db/carryover.rs,
  src/git/{serialize,project,version}.rs, src/services/git_core/{mod,convert,merge}.rs,
  scripts/check-proto-sync.sh
```

**Не прочитано:** ничего из списка блока.

**Что прогнано, а не прочитано:**
`SETFORK_FRONTEND_DIR=.../setfork-app SETFORK_FRONTEND_REF=master bash
scripts/check-proto-sync.sh` в ядре → `proto-sync: OK`. Кросс-репный гейт зелёный на
сегодняшнем дереве. Сборка/тесты фронта НЕ гонялись (это чтение, а не прогон).

---

## Общий корень девяти находок из одиннадцати

`GitCore` объявляет `null`/`[]` как ОТВЕТ ПО СУЩЕСТВУ («ветки нет», «list.json нет»),
а адаптер отдаёт то же самое значение на ЛЮБОМ сбое связи:

```ts
// src/features/git/core.remote.ts:113
const res = await client.getBranchSnapshot({ repo: toRepoRef(repo), branch }).catch(() => null)
if (!res || !res.found) return null
```

То же на `:152` (`mergeState`), `:266` (`listTags` → `[]`), `:272` (`listCommits`).
Порт при этом обещает ровно обратное — `/** Материализация tip ветки (просмотр «на
ветке»). null — ветки/list.json нет. */` (`src/core/ports.ts:259`). Ни один вызывающий
после этого отличить «нет» от «не ответило» не может, и каждый решает сам — кто
показывает ложный факт, кто пропускает проверку. Ядро в зеркальной ситуации выбрало
противоположное и записало это словами: `gate.rs` — «**Fail-closed.** Фронт не ответил,
ответил ошибкой или не уложился в таймаут — запись отклоняется. Дверь, открытая по
умолчанию, обесценивает всю конструкцию». Фронт на своей половине двери оставляет
открытыми.

В карте корней (`setfork-hq/reviews/problems/CLUSTERS.md`, 40 кластеров) такого корня
нет: ближайшие K06 (нет таксономии ошибок HTTP-границы) и K31 (код отказа выбирает
каждая поверхность) — про ВЫБОР кода на границе, а здесь код отказа УНИЧТОЖАЕТСЯ до
границы, в адаптере. Предлагаю завести отдельным корнем: **«отказ чтения выдан за
отсутствие объекта»**.

---

## Находки

### H2-001 · high · «Ветка удалена» говорят про живую ветку, когда молчит ядро
**Место:** `src/features/git/core.remote.ts:113` (корень), проявление —
`src/app/[handle]/[slug]/suggestions/[id]/load.ts:96` и
`src/app/[handle]/[slug]/suggestions/[id]/SuggestionNotices.tsx:83`

**Что не так.** `branchMissing` вычисляется как `!!sug.branchRef && !snapshot`, а
`snapshot` приходит null и от сбоя связи тоже. Страница показывает утверждение о факте:

```ts
// load.ts:96
const branchMissing = !!sug.branchRef && !snapshot
```
```ts
// SuggestionNotices.tsx:83
{branchMissing && (<Alert variant="warn">{t('pr.branchDeletedStale', lang)…</Alert>)}
```
```ts
// dict/ru.ts:2283
'pr.branchDeletedStale': 'Ветка «{branch}» удалена — предложение неактуально, можно только отклонить.',
```

**Сценарий отказа.** Ядро перезапускается (выкатка) или рвётся коннект порт-прокси.
Владелец открывает предложение из ветки. `items = blocksFrom(sug, null)` → `[]`, то
есть пунктов не видно вовсе; сверху красуется «Ветка удалена — предложение неактуально,
можно только отклонить». Владелец отклоняет живую правку. Ветка цела, ядро просто не
ответило.

**Почему дефект.** Инвариант 7 («никакой тихой деградации: назвать причину и дать
Повторить») — здесь хуже тихой деградации: названа НЕВЕРНАЯ причина, и она толкает к
необратимому действию. Адаптер нарушает собственный договор порта
(`ports.ts:259`: «null — ветки/list.json нет»).

**Уверенность:** confirmed.

---

### H2-002 · high · Страж исполняемых команд на пути слияния проходит вхолостую, если снимок не прочитался
**Место:** `src/features/library/suggestion-core/merge.ts:94`

**Что не так.**
```ts
const incoming = await suggestionBlocks(sug, owner, tpl.slug)
const destructive = findDestructiveSteps(incoming)
if (destructive.length) { … return { ok:false, … } }
```
А `suggestionBlocks` при недоступном снимке отдаёт **пустой массив**, а не отказ:
```ts
// src/features/library/suggestion-blocks.ts:20,30
if (sug.branchRef) return snapshot ? (snapshotSteps(snapshot) …) : []
const snapshot = sug.branchRef ? await gitCore.branchSnapshot(…).catch(() => null) : null
```
`findDestructiveSteps([])` → `[]` → страж молча пропускает. Ровно тот страж, про
который в том же файле написано: «посторонний вкладчик мог положить исполняемую
команду в ветку, а владелец влить её одной кнопкой — и она уезжает в исполняемый
/raw».

**Сценарий отказа.** Чтение `branchSnapshot` срывается (обрыв соединения к ядру —
известная болячка порт-прокси), следующий RPC `mergeBranch` проходит. Страж не увидел
ни одного блока, слияние состоялось, ядро спроецировало версию с исполняемой командой,
она уезжает в `/raw`. Ничего в наблюдаемость при этом не пишется: `.catch(() => null)`
глушит молча.

Второй, уже НЕ преходящий вход в ту же ветку: `currentRevision` в соседнем вызове
(`suggestion-core/revision.ts:15–22`) **сознательно** объявлено, что «недоступность git
не блокирует слияние». То есть путь «git не ответил — сливаем» спроектирован; следствие
для стража содержимого не продумано.

**Почему дефект.** Проверка безопасности fail-open там, где ядро на своей стороне
прямо выбрало fail-closed (`gate.rs`). Инвариант 3 (мёртвое право) и 7.

**Уверенность:** confirmed по коду; путь до ущерба требует преходящего сбоя чтения
между двумя RPC — это названо вслух.

---

### H2-003 · high · Настройка «только линейная история» не действует, если ядро не отдало merge-state
**Место:** `src/features/library/suggestion-core/merge.ts:103`

```ts
if (prs.linearOnly) {
  const state = await gitCore.mergeState({ owner, slug: tpl.slug }, sug.branchRef).catch(() => null)
  if (state && state.mergeBaseSha !== state.ours.tipSha) return { ok: false, reason: 'not-linear' }
}
```

**Что не так.** `state === null` → условие ложно → проверка ПРОПУСКАЕТСЯ, и слияние
идёт дальше с `mode: prs.mergeMethod`. Второго исполнителя у этого правила нет: ядро
про `linearOnly` не знает ничего (`merge_branch` в
`setfork-core/src/services/git_core/mod.rs` знает только `mode`), в `pr-settings.ts`
это чисто фронтовая настройка, и единственная её проверка — эта строка.

**Сценарий отказа.** `get_merge_state` отдаёт `found:false` не только при отсутствии
ветки: в ядре это ещё и «любой из трёх снимков не материализовался»
(`mod.rs:626–634`, `match (base, ours, theirs) { (Some,Some,Some) => …, _ => Ok(None) }`).
Материализация падает на непарсящемся `list.json`, а такой коммит в ветку пролезает —
это записано в нашем же коде: «Хук требует наличия list.json, но не его
разбираемости: битый JSON проходит `cat-file -e`» (`push-effects.ts:126`). Владелец,
включивший «только линейная история», получает merge-коммит в main. То же — на сбое
связи (и тогда `mergeBranch` тоже упадёт, поэтому основной вход именно `found:false`).

**Почему дефект.** Инвариант 3: «Флаг, галочка или роль, которые нигде не проверяются,
— находка: администратор думает, что запретил, а не запретил ничего». Здесь галочка
проверяется через раз, что хуже: в журнале настроек она включена.

**Уверенность:** confirmed.

---

### H2-004 · high · Обещанное ядром предложение из терминала пропадает навсегда, если снимок не прочитался
**Место:** `src/features/git/push-effects.ts:128`

```ts
const snap = await gitCore.branchSnapshot(repo, m.branch).catch(() => null)
if (!snap) {
  captureError(new Error('magic push: branch does not materialize as a list'), …)
  continue    // «Это не ошибка задачи: повторять нечего, ветка такая и есть»
}
```

**Что не так.** Комментарий рядом описывает ОДИН случай — битый `list.json` в ветке.
Но `branchSnapshot` отдаёт null и на сбое связи, а `continue` + успешное завершение
задачи означают, что очередь НЕ повторит. Предложение не создаётся никогда.

**Сценарий отказа.** Человек делает `git push … refs/for/main`. Ядро принимает пак и
печатает ему в терминал «правка принята, предложение появится на странице списка»
(формулировка названа в докблоке файла, стр. 22). Фоновая задача `git_push` стартует в
момент перезапуска ядра (выкатка) → `branchSnapshot` падает → задача завершается
успешно, предложения нет, повтора не будет. В наблюдаемость при этом уезжает НЕВЕРНЫЙ
диагноз: «branch does not materialize as a list» про исправную ветку.

**Почему дефект.** Четвёртая ступень из CLUSTERS.md («обещано и не сделано»): система
вслух заявила результат, которого не будет. Плюс инвариант 7.

**Уверенность:** confirmed. Тест
`push-effects.itest.ts:171` («ветка, которая не разворачивается в список, не роняет
остальные эффекты») закрепляет именно это поведение — он подменяет `snapshot=false`, то
есть не различает два случая ровно так же, как код.

---

### H2-005 · medium · Пометка «разрушительный пункт» на НОВОМ блоке ветки не доезжает до ядра и молча теряется
**Место:** `src/features/git/list-content.ts:45–69` (форма провода) ↔
`setfork-core/src/services/git_core/convert.rs:118–126` и `src/db/carryover.rs:123–139`

**Что не так.** `toWireContent` сознательно НЕ шлёт `danger`/`imageKey`/`needsHuman`/
`needsHumanAsk`, а ядро подставляет их из **текущей версии списка по `block_id`**:

```sql
-- carryover.rs: current_marks
join templates t on t.id = tv.template_id and t.current_version = tv.version
```

Логика верна для блока, который в текущей версии ЕСТЬ. Для блока, которого там нет
(новый блок, заведённый в предложении), переносить нечего — и `canon_list_json`
оставляет `danger: false`, `image_key: None`.

При этом производитель содержимого пометку честно кладёт:
`src/features/library/list-content.ts:47` — `...(it.danger ? { danger: true } : {})`, —
а `src/features/git/list-content.ts` её выбрасывает. Два одноимённых модуля делают
противоположное.

**Сценарий отказа.** Владелец открывает `/{owner}/{slug}/suggestions/{id}/edit`
(ветковое предложение — тот же `ListEditor`), добавляет НОВЫЙ пункт с необратимой
командой и включает переключатель «разрушительный пункт»
(`list-editor/StepBlockBody.tsx:133–134`). Сохранение идёт через
`writeSuggestionItems` → `commitToBranch`; `danger` в провод не уезжает, в ядре
переносить неоткуда. Человек открывает предложение заново — пометки нет. Переключатель
на новом блоке — тихо ничего не делающий контрол; при слиянии пункт уедет в собранный
скрипт исполняемым (в `proto/git.proto:13` это прямое назначение поля: «из-за которой
пункт не попадает в собранный скрипт исполняемым»).

**Почему дефект.** Инвариант 2 («тихая потеря полей») и 3 («мёртвое право»). Довод
порта — «иначе клиент, который её не заполнил, снимал бы пометку с необратимой
команды» — объясняет только направление СНЯТИЯ; направление УСТАНОВКИ на новом блоке
он не покрывает, а страдает именно оно. Комментарий в `git.proto` сам напоминает:
«ровно этот баг уже чинили дважды — с needs_human и danger».

**Уверенность:** confirmed по обеим сторонам.

---

### H2-006 · medium · У `repo.bundle` обработка отказа ядра — мёртвая ветка (карточка 007, не закрытая на этой поверхности)
**Место:** `src/app/[handle]/[slug]/repo.bundle/route.ts:14`

```ts
const buf = await gitCore.bundle({ owner: handle, slug })
if (!buf) return new Response('Could not build bundle', { status: 500 })
```

**Что не так.** `bundle` — **единственный** метод `gitCoreRemote`, который не обёрнут
ни в `proto()`, ни в `try/catch`, и при этом никогда не возвращает null:

```ts
// core.remote.ts:96
async bundle(repo) { const res = await client.createBundle(toRepoRef(repo)); return res.data },
```

`res.data` у protobuf-es — всегда `Uint8Array` (пустой массив истинен). Значит `if
(!buf)` не срабатывает НИКОГДА, а `ConnectError` улетает мимо роута.

**Сценарий отказа.** Ядро недоступно, человек жмёт «Скачать bundle»
(`CloneDropdown.tsx`, вкладка «Клонирование») или делает `curl -O`. Вместо
стабильного текстового ответа приходит HTML-страница ошибки Next, а в наблюдаемость не
попадает ни операции, ни репозитория. Это дословно карточка 007, описанная в
`[...git]/route.ts:39–50` как ПОЧИНЕННАЯ — но починена она была только на том маршруте.

**Почему дефект.** Инвариант 7; обработчик, который выглядит существующим и не
существует, хуже отсутствующего.

**Уверенность:** confirmed.

Рядом, не оформляю отдельной находкой (известный корень **K04**): у `/repo.bundle`
нет лимитера, хотя у `[...git]` он есть (`route.ts:88`, 240/мин), а сборка бандла
поднимает всю историю.

---

### H2-007 · medium · Ядро молчит → адрес ветки показывает содержимое main, и молча
**Место:** `src/app/[handle]/[slug]/load.ts:65`

```ts
const branches = await gitCore.listBranches({ owner, slug }).catch(() => [])
const refBranch = sp.ref && sp.ref !== 'main' && branches.some((b) => b.name === sp.ref) ? sp.ref : null
```

**Что не так.** Пустой список веток неотличим от «ядро не ответило». `refBranch`
становится null, `snapshot` не запрашивается, `allSteps` падает на `dbSteps` — то есть
на содержимое **main**.

**Сценарий отказа.** Ядро недоступно. Человек открывает `/{owner}/{slug}?ref=fix-typo`
(ссылка со страницы предложения). Страница отдаёт 200 и показывает main под адресом
ветки — без единого признака подмены. Селектор веток при этом у обычного читателя
исчезает целиком (`BranchPicker.tsx:73`: `if (own.length === 0 && !canManage) return null`),
а у владельца показывает «ничего не найдено». Ни причины, ни «Повторить».

Тот же `.catch(() => [])` — в `src/app/[handle]/[slug]/versions/page.tsx:63`, где от
него зависит `branchCount` в шапке.

**Почему дефект.** Инвариант 7 плюс вторая ступень из CLUSTERS.md («подменяет
правду»): человек получает правдоподобный неверный ответ и не видит подмены.

**Уверенность:** confirmed.

---

### H2-008 · medium · Правка ветки грузит блоки без превью картинок — ровно ловушка, от которой стережётся соседний путь
**Место:** `src/app/[handle]/[slug]/suggestions/[id]/edit/page.tsx:57`

```ts
const items: ProposedItem[] = blocksFrom(sug, snapshot)
const initial = toEditorItems(items as never, lang, {})   // ← превью не запрашиваются
```

Соседний путь, читающий те же строки из канона, так НЕ делает и объясняет почему:

```ts
// src/features/library/actions/canon.ts:79–83
// Превью картинок обязательны: канон несёт КЛЮЧ, а без подписанной ссылки блок
// покажет пустой слот — и человек решит, что применение текста стёрло скриншот
const previews = await getStepPreviews(rows.map((r) => ({ imageKey: r.imageKey ?? null })))
return { items: toEditorItems(rows, lang, previews) }
```

**Сценарий отказа.** Предложение из ветки содержит пункт с картинкой (снимок несёт
`image_key`, `snapshot-steps.ts:61`). Автор открывает «правку пунктов» — на месте
скриншота пустой слот. Дальше два исхода, оба плохие: либо он решает, что картинка
потерялась, либо сохраняет — и с учётом H2-005 для блока, которого нет в текущей
версии, ключ действительно теряется.

**Почему дефект.** Расхождение двух путей, читающих одни и те же данные; ловушка
названа вслух в коде и не закрыта во втором месте.

**Уверенность:** confirmed.

---

### H2-009 · medium · Правило #938 «запись называет базу» не дошло до трёх маршрутов, создающих версию В ЯДРЕ, и сторож их не видит
**Место:** `src/features/library/actions/suggestion-branch.ts:171`,
`src/features/library/actions/suggestion-items.ts:109`,
`tests/architecture/version-base-declared.test.ts:78`

**Что не так.** Сторож из #938 перечисляет допустимое по одному признаку:

```ts
.flatMap(({ rel, text }) => callArgs(text, 'listStore.addVersion(').map(…))
```

То есть он видит ТОЛЬКО маршруты через фасад. Версию, однако, создают ещё три пути,
идущие мимо фасада прямо в ядро — `gitCore.mergeBranch`, `gitCore.mergeResolved` и
проекция `receivePack`. Что они фасад минуют, в коде сказано прямым текстом
(`merge.ts:140`: «git-merge создаёт версию МИМО listStore.addVersion → фасадный барьер
её не ловит»). В таблице `ROUTES` их нет, и по построению не может быть — сканер ищет
другой вызов. Докблок сторожа при этом обещает ловить «ПОЯВЛЕНИЕ девятого маршрута
мимо решения».

Конкретное следствие на одном из этих маршрутов — номер версии в каноне:
```ts
// suggestion-branch.ts:166–172 (resolveBranchPr)
const content = { …, version: tpl.currentVersion + 1, … }
```
`tpl` прочитан в начале экшена, без лока. Ядро кладёт это число в `list.json`
дословно (`convert.rs: from_list_content → version: c.version`), а номер версии в
Postgres считает независимо и под локом
(`db/write.rs:103–111`: `select current_version … for update` → `let new_version = current + 1`).
Сверки между этими двумя числами нет нигде.

**Сценарий отказа.** Владелец разрешает конфликты в резолвере. Пока он выбирает
стороны, соавтор публикует версию: было 7, стало 8. Экшен подставляет
`version: 8`, ядро записывает версию 9 и вешает тег `v9`. В `list.json` коммита `v9`
навсегда стоит `"version": 8`. Канон — «источник правды» — врёт о собственном номере;
клон, бандл и редактор канона показывают это число как есть.

**Почему дефект.** Тот же класс, ради которого делался #938 («писали вслепую, и при
гонке молча побеждала последняя запись»), в маршруте, до которого правило не дошло, а
узда дотянуться не может. Инвариант 18: узда, которая по построению не видит целый
класс маршрутов, стережёт не то, что обещает.

**Уверенность:** confirmed по коду обеих сторон.

---

### H2-010 · low · Резолвер конфликтов обещает merge-коммит, а на squash-списке делает не его
**Место:** `src/features/git/ConflictResolver.tsx:144`

```tsx
{ru ? 'Результат — merge-commit в main; md-оверрайды шагов сбрасываются.'
    : 'Result is a merge commit on main; per-step md overrides are reset.'}
```
А экшен шлёт способ слияния из настроек списка:
```ts
// suggestion-branch.ts:198–201
const merged = await gitCore.mergeResolved(…, content, { mode: prs.mergeMethod, … })
```
и ядро на `mode == "squash"` делает коммит с ОДНИМ родителем
(`merge.rs:128–137`). На списке с `mergeMethod: 'squash'` подпись под кнопкой говорит
неправду о том, что произойдёт с историей.

**Уверенность:** confirmed.

---

### H2-011 · low · README блока описывает право на запись, которого нет с Ф5, и противоречит сам себе
**Место:** `src/features/git/README.md:22`, `:46`, `:100`

```
- **Write** (`git-receive-pack`): owner only, Basic auth with an API token.
```
Неверно с Ф5: пишут владелец, соавтор и ЛЮБОЙ пользователь с write-токеном, если
список открыт для предложений (`access.ts:118–148`, `push-role.ts`). Там же в
«Prod requirements» требуется «**`git` binary** at runtime (add to the container
image)», хотя двумя абзацами ниже тот же файл пишет «The TS side no longer shells git
at all».

**Уверенность:** confirmed.

---

## Проверено и признано корректным

1. **⚠️ Снятая кандидатная находка.** Докблок
   `src/app/api/internal/write-allowed/route.ts:44` утверждает, что блоки в запрос
   кладёт ядро. В рабочей копии ядра слова `blocks` не было НИГДЕ — выглядело как
   разъехавшаяся половина контракта (страж исполняемых команд на пути пуша, который
   никто не вызывает). Ложная тревога: копия ядра была на два коммита позади, а
   `082b752` («Пуш больше не проносит в канон команду, которой продукт бы не принял»)
   добавляет `ask_payload(owner, slug, commands)` и тест
   `only_the_content_question_carries_blocks`. Ровно та ловушка, про которую
   предупреждает `stale-tree-shows-fixed-bugs`, — на СОСЕДНЕМ репозитории.
2. **proto ↔ proto.** `proto/git.proto` и `proto/domain_read.proto` в двух репозиториях
   байт-в-байт идентичны; `check-proto-sync.sh` прогнан и зелёный. Он же сверяет
   множества `REASON_TO_CODE` ↔ `reason.rs`, виды списка, коды придирок канона и форму
   имени серверной ветки — четыре копии правил, которые я собирался сверять руками.
3. **Поля провода не теряются на уровне типа.** `WireStep` покрывает все 16 полей
   `SnapshotStep`, `WireContent` — все 6 полей `ListContent`. Разбор один
   (`fromWireStep`) на снимок ветки и на строгий разбор канона — инвариант 2 соблюдён.
4. **`capabilities` глушит всё в «не умею»** (`core.remote.ts:212`) — это fail-closed и
   правильно: дверь закрывается, а не открывается; кэша нет сознательно
   (`capabilities.ts`), тест на откат ядра назад есть.
5. **`receivePack`: отказ ядра не превращается в успех.** Единственная точка невозврата
   размечена (`route.ts:211–216`), всё после неё вынесено в очередь, `enqueue` глушится
   с `captureError`. Проверено `push-resilience.itest.ts`.
6. **Перечитывание роли вплотную к паку** (`route.ts:184–195`) и лимит по ФИНАЛЬНОЙ
   роли — закрыто; обхода сменой качества нет.
7. **Разбор Basic-кредитива** (`http-auth.ts:28–46`) строгий по RFC 7617, обратная
   сверка base64 на месте; авария хранилища токенов отделена от «неверный токен».
8. **Потолок тела и zip-бомба** (`http-body.ts`) — потолок применяется и к
   распакованному, ноль = «без ограничения» согласован с ядром.
9. **`mergeResolved` не теряет чужой коммит в main:** ядро читает `main_tip` ПОД локом и
   делает CAS (`merge.rs:100,140` → `update_main(…, Some(main_tip), …)`), а экшен
   перечитывает `mergeState` и пересчитывает three-way. Остаётся привязка выбора
   человека к снимку, который он видел, — это **известный корень K35**, оформляю
   ссылкой, а не находкой.
10. **`listTags` → `[]` на любом сбое** (`core.remote.ts:266`) — тот же корень, что
    H2-001, но потребителя в UI нет и не планируется (сказано в `git.proto:143`), так
    что ущерба сегодня нет. Оставляю строкой здесь, а не находкой.
11. **`renderCanonAction`/`parseCanonAction`** ловят всё и отдают `core-unavailable` с
    текстом и без тихого пустого экрана (`CanonPanel.tsx:109–116`) — редкий на этом
    стыке случай, где сделано правильно.
12. **CLI (`cli/`)** — чистые помощники покрыты `node:test`, `cloneUrl` совпадает с
    формой маршрута (`.git`-суффикс срезает `cleanSlug`), `sf raw` отличает неуспешный
    ответ от успешного. Дефектов не нашёл.
13. **`three-way.ts`** — разделение идентичности и отпечатка содержимого (`body()`
    выкидывает `blockId` и `content.bid`) сделано верно; `applyChoices` возвращает null
    при неразрешённом конфликте, то есть сдвиг main не проезжает молча.
14. **`gitMovedResponse`** — 301 (а не 308) с обоснованием из Gitea, хвост пути и query
    сохраняются, решение о видимости цели принято раньше, в гейте.

## Чего я НЕ проверил

- Поведение на живом стенде: ни один сценарий не воспроизведён на запущенном ядре.
  Все находки доказаны чтением кода обеих сторон.
- `src/shared/gen/**` — исключён из ревью по `blocks.json` (сверяется джобой CI).
- Тесты ядра (`setfork-core/tests/*.rs`) читал выборочно, только там, где нужен был
  ответ про поведение (`content_push.rs`, `write_gate.rs` — по названиям и диффу).

---

## Дочитано 22.09.2026: два файла, пришедшие с починкой #942

⚠️ **Отчёт объявлял полный охват при 43 файлах из 45.** Два файла появились в блоке уже
ПОСЛЕ прохода — их принёс коммит `e23dee5e`, чинивший находки этого же блока. Статус
`verified` при этом уже стоял, то есть блок был сертифицирован по старому дереву, вопреки
критерию приёмки из собственного манифеста («прочитаны все файлы блока, не выборка»).
Нашло это авто-ревью, не я.

**`tests/features/git/snapshot-read-failure.test.ts`** (51 строка) — проверяет ровно то
свойство, ради которого чинился адаптер: сбой связи обязан отличаться от ответа «ветки
нет». Три случая: обрыв → `GitTransportError`, `found: false` → `null`, нормальный ответ →
разобранный снимок. Свойство проверяется НА САМОМ АДАПТЕРЕ — верное место: у вызывающих
свои `catch`, и вернуть глушилку одной строкой можно именно здесь.

**`tests/features/git/snapshot-read-failure.mutants.json`** (11 строк) — одна порча:
«глушилка отказа вернулась в адаптер». То есть узда проверена тем самым изменением, от
которого защищает.

**Дефектов не найдено.** Одно наблюдение, низкой важности и не дефект кода: тест не
покрывает случай, когда ядро ОТВЕТИЛО, но снимок не разбирается (битый `list.json` с
`found: true`). После #942 `try` сужен до чтения, поэтому ошибка разбора вылетит наружу
как обычная, а не притворится недоступностью ядра — это верное поведение, но закреплено
оно только докблоком, не тестом.
