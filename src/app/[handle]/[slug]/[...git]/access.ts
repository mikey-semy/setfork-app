import 'server-only'
// eslint-disable-next-line no-restricted-imports -- git smart-HTTP: своя авторизация (токен/коллаборатор), не cookie-сессия
import { getListMeta } from '@/features/library/queries'
import { canEditList, canViewList, editBlockReason, isPubliclyVisible } from '@/core'
import { contributorsEnabled, openForContributions, type PushRole } from '@/features/library/push-role'
import { coreEnforcesPushRoles } from '@/features/git/capabilities'
import { isCollaborator } from '@/features/collab/queries'
import { identifyGitActor } from '@/features/git/http-auth'
import { resolveListOrMoved } from '@/shared/db/resolve-list'
import type { GitHttpFailure } from '@/features/git/http-response'

/**
 * КТО и ЧТО может делать с репозиторием списка через git smart-HTTP.
 *
 * Отдельно от транспорта, потому что причина изменения другая: здесь меняются права
 * (роли, соавторство, приём предложений, архив/заморозка), а в маршруте — форма провода.
 * Пока они жили вместе, локальное правило чтения уже отставало от `canViewList`, и
 * приватный список отдавался по `git clone` соавтору как 404 (карточка ревью 004).
 *
 * Своих копий доменных предикатов здесь нет: видимость решает `canViewList`, запись —
 * `canEditList`. Модуль лишь добывает недостающие факты (личность по токену, соавторство)
 * и переводит решение в отказ протокола.
 *
 * Лежит РЯДОМ С МАРШРУТОМ, а не в `features/git`, сознательно: решение опирается сразу на
 * три фичи (библиотека, соавторы, роли), а фиче зависеть от фичи запрещено границами
 * слоёв. Оркестрация фич — работа слоя app, и это его файл. Маршрутом Next его не делает:
 * маршруты задают только `route.ts`, `page.tsx` и `layout.tsx`.
 */

export type Meta = NonNullable<Awaited<ReturnType<typeof getListMeta>>>

/** Доступ разрешён: список и — если предъявлен кредитив — его владелец. */
export interface GitGrant {
  meta: Meta
  userId: string | null
  scope: 'read' | 'write' | null
}

/** Видит ли этот пользователь список — ОБЩИЙ предикат домена, а не своя копия правила. */
async function canRead(meta: Pick<Meta, 'id' | 'ownerId' | 'visibility' | 'status' | 'moderation'>, userId: string): Promise<boolean> {
  const isOwner = meta.ownerId === userId
  if (canViewList(meta, { isOwner })) return true
  // Соредактор ведёт список вместе с владельцем: в вебе он приватный список видит и
  // правит, а `git clone` того же списка получал 404. Проверка отдельным запросом — и
  // только когда без неё отказ, чтобы не ходить в БД на каждый публичный клон.
  return canViewList(meta, { isOwner, isCollaborator: await isCollaborator(meta.id, userId) })
}

/**
 * Куда переехал адрес — но ТОЛЬКО если цель видна этому актору; иначе null.
 *
 * Видимость проверяется до перенаправления сознательно, и здесь мы строже Gitea: там
 * редирект отдаётся безусловно, то есть по старому адресу можно узнать и текущее имя
 * списка, и сам факт его существования — даже когда он с тех пор стал приватным. У нас
 * приватная цель ведёт себя как отсутствующая, ровно как того требует остальная
 * поверхность (`/raw`, `data.json`): факт существования не утекает.
 */
async function movedTargetFor(
  repo: { owner: string; slug: string },
  actor: Awaited<ReturnType<typeof identifyGitActor>>,
): Promise<string | null> {
  const moved = await resolveListOrMoved(repo.owner, repo.slug)
  if (!moved?.movedTo) return null
  const visible = actor.kind === 'user' ? await canRead(moved.list, actor.userId) : isPubliclyVisible(moved.list)
  return visible ? moved.movedTo : null
}

/**
 * Единый гейт git-транспорта: и для рекламы рефов, и для самих сервисов.
 *
 * Порядок отказов повторяет GitHub, проверено живьём на его smart-HTTP: анонимный
 * запрос к приватному и к НЕСУЩЕСТВУЮЩЕМУ репозиторию отвечает одинаково — 401 с
 * вызовом аутентификации (публичный при этом отдаёт 200), а предъявленный, но не
 * подходящий кредитив получает 404 «Repository not found». Gitea здесь различает 401 и
 * 404, то есть оракул существования у неё остаётся; нам он не годится: `/raw` и
 * `data.json` этой же поверхности уже платят одинаковым отказом ровно ради того, чтобы
 * факт существования не утекал.
 */
export async function authorizeGitRead(
  authorization: string | null,
  repo: { owner: string; slug: string },
  need: 'read' | 'write',
): Promise<GitGrant | GitHttpFailure> {
  const actor = await identifyGitActor(authorization)
  if (actor.kind === 'unavailable') return { code: 'auth_unavailable' }

  const meta = await getListMeta(repo.owner, repo.slug)

  // Адрес мог переехать (переименование списка или смена ника владельца), а в git remote
  // у клонов остался прежний. Проверяем ДО отказов: иначе анонимный клон переехавшего
  // ПУБЛИЧНОГО списка получал бы 401 вместо перенаправления — ветка `auth_required`
  // ниже срабатывает раньше, чем «не найдено».
  if (!meta) {
    const to = await movedTargetFor(repo, actor)
    if (to) return { code: 'moved', to }
  }

  // Единственный путь без кредитива — чтение того, что и так открыто всем.
  if (need === 'read' && actor.kind === 'anonymous' && meta && isPubliclyVisible(meta)) {
    return { meta, userId: null, scope: null }
  }
  // Кредитива нет или он не принят: вызов аутентификации, одинаковый для всего
  // остального — существует список или нет, отсюда не видно.
  if (actor.kind !== 'user') return { code: 'auth_required' }

  // Дальше личность известна, и отказы уже могут быть по существу — но чужого закрытого
  // списка это по-прежнему не касается.
  if (!meta || !(await canRead(meta, actor.userId))) return { code: 'not_found' }
  return { meta, userId: actor.userId, scope: actor.scope }
}

/** Запись запрещена состоянием списка — причину домен знает, и она едет в ответ. */
export const writeDisabled = (meta: Meta): GitHttpFailure => ({
  code: 'write_disabled',
  reason: editBlockReason(meta) ?? 'frozen',
})

/**
 * Доступ на запись (push): кто пушит и в каком качестве.
 *
 * Ф5: помимо владельца и соавтора пускаем ЛЮБОГО пользователя с write-токеном, если
 * список открыт для предложений. Раньше git-путь был строже веба без причины:
 * `allowFrom` по умолчанию `'all'`, то есть веб уже разрешал предлагать правки кому
 * угодно, а через git то же самое было нельзя. Правка из ветки ничем не опаснее правки
 * из формы — она точно так же ничего не меняет, пока владелец её не сольёт.
 *
 * Роль уходит наружу, потому что ядро исполняет её МЕХАНИЧЕСКИ (посторонний пишет
 * только в `refs/for/main`, а имя ветки придумывает сервер). Само решение остаётся
 * здесь: ADR-0011 §2 — пользовательской авторизации в ядре нет.
 */
export async function authorizeGitWrite(grant: GitGrant): Promise<{ userId: string; role: PushRole } | GitHttpFailure> {
  const { meta, userId, scope } = grant
  // Сюда приходят только с доказанной личностью: гейт выше уже отдал 401 анониму и 404
  // тому, кому список не виден.
  if (!userId) return { code: 'auth_required' }
  // Дальше отказы ЧЕСТНЫЕ: 403, а не 401. Личность доказана, список человек видит, и
  // повторный запрос пароля ничего не изменит — git-клиент же по 401 идёт к credential
  // helper и просит ввести секрет заново (карточка 012).
  if (scope !== 'write') return { code: 'access_denied', detail: 'Token has no write scope' }
  const role = await resolvePushRole(userId, meta)
  if (!role) return { code: 'access_denied', detail: 'You are not allowed to push to this list' }
  // Архив и заморозка — ограничения ЗАПИСИ, и git-путь обязан их соблюдать. Проверка
  // здесь, а не в ядре: на проде git идёт в Rust-ядро (SETFORK_CORE_URL), где понятий
  // frozen/archived нет вовсе, и push замороженного списка создавал новую версию —
  // ровно то, что заморозка обязана останавливать (линза 02, F3). Правило общее для
  // обоих режимов ядра, поэтому живёт в одном месте.
  if (!canEditList(meta)) return writeDisabled(meta)
  return { userId, role }
}

/**
 * В каком качестве этот человек пишет в ЭТОТ список — по текущему состоянию списка.
 *
 * Отдельно от `authorizeGitWrite`, потому что зовётся ДВАЖДЫ: до чтения тела (быстрый
 * отказ) и вплотную к передаче пака в ядро. Между этими моментами проходит всё время
 * закачки — у большого пуша это минуты, и за них владелец успевает закрыть приём
 * предложений, спрятать список или снять соавторство.
 */
export async function resolvePushRole(userId: string, meta: Meta): Promise<PushRole | null> {
  if (userId === meta.ownerId) return 'owner'
  if (await isCollaborator(meta.id, userId)) return 'collaborator'
  // Порядок проверок — от дешёвой к дорогой: у выключенного рубильника до ядра дело не
  // доходит вовсе.
  if (!contributorsEnabled() || !openForContributions(meta)) return null
  return (await coreEnforcesPushRoles()) ? 'contributor' : null
}

/** Перечитать список вплотную к записи: см. док у `resolvePushRole`. */
export async function freshMeta(repo: { owner: string; slug: string }): Promise<Meta | null> {
  return getListMeta(repo.owner, repo.slug)
}
