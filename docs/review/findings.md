# Находки ревью

> Файл СГЕНЕРИРОВАН из `findings.jsonl` командой `make review-findings`.
> Не редактируй его руками — правь jsonl и перегенерируй.

Открыто: **9** из 13 записей.

## high (1 открыто / 2)

| id | блок | статус | место | что не так |
|---|---|---|---|---|
| H2-002 | H2 | fixed | `src/features/library/suggestion-core/merge.ts:94` | страж исполняемых команд на пути слияния получает пустой список блоков при недоступном снимке и проходит вхолостую |
| H2-012 | H2 | open | `src/features/library/actions/suggestion-items.ts:109` | предсказанный фронтом номер версии замерзает в list.json ветки, и после двух опубликованных версий git конфликтует по этой строке — а продукт такой конфликт не видит и разрешить не даёт |

## medium (4 открыто / 6)

| id | блок | статус | место | что не так |
|---|---|---|---|---|
| H2-001 | H2 | open | `src/features/git/core.remote.ts:113` | branchSnapshot отдаёт null и на сбое связи, поэтому страница предложения утверждает «ветка удалена» про живую ветку |
| H2-003 | H2 | open | `src/features/library/suggestion-core/merge.ts:103` | настройка linearOnly пропускается, когда mergeState вернул null: `if (state && …)` |
| H2-004 | H2 | open | `src/features/git/push-effects.ts:128` | сбой связи при материализации магической ветки записывается как «ветка не разворачивается в список», задача завершается успешно и повтора не будет |
| H2-005 | H2 | fixed | `src/features/git/list-content.ts:45` | toWireContent не шлёт danger/imageKey/needsHuman, а ядро переносит их только по block_id из ТЕКУЩЕЙ версии — у блока, которого там нет, пометки теряются молча |
| H2-007 | H2 | open | `src/app/[handle]/[slug]/load.ts:65` | listBranches().catch(() => []) делает пустой список веток неотличимым от отказа ядра, и адрес ветки показывает содержимое main |
| H2-009 | H2 | fixed | `tests/architecture/version-base-declared.test.ts:78` | сторож правила #938 сканирует только вызовы listStore.addVersion и по построению не видит три маршрута, создающих версию в ядре (mergeBranch, mergeResolved, проекция receivePack) |

## low (4 открыто / 5)

| id | блок | статус | место | что не так |
|---|---|---|---|---|
| H2-006 | H2 | open | `src/app/[handle]/[slug]/repo.bundle/route.ts:14` | gitCore.bundle — единственный метод адаптера без обёртки ошибок, и он никогда не возвращает null, поэтому ветка `if (!buf) return 500` мертва |
| H2-008 | H2 | open | `src/app/[handle]/[slug]/suggestions/[id]/edit/page.tsx:57` | правка пунктов ветки зовёт toEditorItems с пустыми превью — единственный из четырёх вызовов, тогда как соседние пути считают превью обязательными |
| H2-010 | H2 | open | `src/features/git/ConflictResolver.tsx:144` | подпись под кнопкой обещает merge-коммит, а экшен шлёт mode из настроек списка и на squash ядро делает коммит с одним родителем |
| H2-011 | H2 | open | `src/features/git/README.md:22` | README блока говорит «Write: owner only», хотя с Ф5 пишут владелец, соавтор и любой с write-токеном на открытом списке; там же «git binary at runtime» противоречит тексту ниже |
| H2-013 | H2 | fixed | `tests/architecture/version-base-declared.test.ts:40` | докблок сторожа обещает ловить «появление девятого маршрута мимо решения», хотя признак у него один — вызов фасада; границу надо назвать прямо, иначе зелёный сторож примут за доказательство |

