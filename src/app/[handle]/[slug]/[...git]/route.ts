import { eq } from 'drizzle-orm'
import { db, users } from '@/shared/db'
// eslint-disable-next-line no-restricted-imports -- git smart-HTTP: своя авторизация (токен/коллаборатор), не cookie-сессия
import { getListMeta } from '@/features/library/queries'
import { canEditList, canViewList, GitTransportError, isPubliclyVisible } from '@/core'
import { contributorsEnabled, openForContributions, type PushRole } from '@/features/library/push-role'
import { coreEnforcesPushRoles } from '@/features/git/capabilities'
import { captureError } from '@/shared/observability'
import { isCollaborator } from '@/features/collab/queries'
import { gitCore } from '@/features/git/core'
import { GitBodyMalformed, GitBodyTooLarge, maybeGunzip, readGitBody } from '@/features/git/http-body'
import { identifyGitActor } from '@/features/git/http-auth'
import { GIT_CONTENT_TYPE, parseGitHttpRequest, type GitHttpOperation } from '@/features/git/http-request'
import { gitBytesResponse, gitFailureResponse, type GitHttpFailure } from '@/features/git/http-response'
import { scheduleAcceptedPushEffects } from '@/features/git/push-effects'
import { clientIp, rateLimit } from '@/shared/rate-limit'
import { envNumber } from '@/shared/env'
import type { Lang } from '@/shared/i18n'

// git smart-HTTP: `git clone/pull/push https://host/{owner}/{slug}.git`.
// Работает из VSCode. Источник правды — персистентный bare-репо внутри ядра
// (setfork-core/src/git/repo.rs); фронт сюда только проксирует с авторизацией.
//
// Роль файла — ОРКЕСТРАЦИЯ границы: разбор запроса, авторизация, вызов ядра, ответ.
// Форма провода живёт в http-request/http-response, кредитив — в http-auth, тело — в
// http-body. Правило простое: этот файл меняется, когда меняется HTTP-провод git, и не
// меняется, когда меняются коды отказов, разбор Basic или потолок тела.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Meta = NonNullable<Awaited<ReturnType<typeof getListMeta>>>

/**
 * Отказ ядра → стабильный ответ протокола вместо 500 фреймворка.
 *
 * Роут рассчитывал на ветку `if (!body) return 'Repository unavailable'`, но адаптер в
 * этом случае ничего не возвращал: он бросал ошибку транспорта, и она уходила мимо
 * роута — git-клиент получал HTML страницы ошибки, а в наблюдаемость не попадало ни
 * операции, ни репозитория (карточка 007).
 *
 * Коды разделены по смыслу: недоступность и дедлайн временные, их стоит повторить;
 * «ядро не знает такого репозитория» — рассинхрон с базой, для клиента это 404;
 * остальное — сломались не мы и не запрос, а ответ ядра.
 */
function coreFailure(e: unknown, repo: { owner: string; slug: string }): GitHttpFailure {
  const err = e instanceof GitTransportError ? e : new GitTransportError('internal', 'unknown', { cause: e })
  captureError(err, { where: 'git.core', op: err.op, code: err.code, owner: repo.owner, slug: repo.slug })
  if (err.code === 'unavailable' || err.code === 'timeout') return { code: 'core_unavailable', kind: err.code }
  if (err.code === 'not-found') return { code: 'not_found' }
  return { code: 'core_error' }
}

/** Видит ли этот пользователь список — ОБЩИЙ предикат домена, а не своя копия правила. */
async function canRead(meta: Meta, userId: string): Promise<boolean> {
  const isOwner = meta.ownerId === userId
  if (canViewList(meta, { isOwner })) return true
  // Соредактор ведёт список вместе с владельцем: в вебе он приватный список видит и
  // правит, а `git clone` того же списка получал 404. Проверка отдельным запросом — и
  // только когда без неё отказ, чтобы не ходить в БД на каждый публичный клон.
  return canViewList(meta, { isOwner, isCollaborator: await isCollaborator(meta.id, userId) })
}

/** Доступ разрешён: список и — если предъявлен кредитив — его владелец. */
type Granted = { meta: Meta; userId: string | null; scope: 'read' | 'write' | null }

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
async function gitAccess(req: Request, op: GitHttpOperation): Promise<Granted | GitHttpFailure> {
  const actor = await identifyGitActor(req.headers.get('authorization'))
  if (actor.kind === 'unavailable') return { code: 'auth_unavailable' }

  const meta = await getListMeta(op.repo.owner, op.repo.slug)

  // Единственный путь без кредитива — чтение того, что и так открыто всем.
  if (op.need === 'read' && actor.kind === 'anonymous' && meta && isPubliclyVisible(meta)) {
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

/**
 * Сколько пушей в час разрешено ПОСТОРОННЕМУ (Ф5).
 *
 * Настройкой, а не числом в коде: величина зависит от того, как пойдёт, и
 * подкручивается без выкатки. Двадцать — это заметно больше, чем нужно человеку,
 * который правит список (пуш, посмотрел, поправил, ещё раз), и заметно меньше, чем
 * нужно скрипту, чтобы шуметь.
 */
const CONTRIB_PUSHES_PER_HOUR = envNumber('SETFORK_GIT_CONTRIB_PUSHES_PER_HOUR', 20)

/** Запись запрещена состоянием списка — причину домен знает, и она едет в ответ. */
const writeDisabled = (meta: Meta): GitHttpFailure => ({ code: 'write_disabled', reason: meta.archivedAt ? 'archived' : 'frozen' })

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
async function authorizeWrite(granted: Granted): Promise<{ userId: string; role: PushRole } | GitHttpFailure> {
  const { meta, userId, scope } = granted
  // Сюда приходят только с доказанной личностью: гейт выше уже отдал 401 анониму и 404
  // тому, кому список не виден.
  if (!userId) return { code: 'auth_required' }
  // Дальше отказы ЧЕСТНЫЕ: 403, а не 401. Личность доказана, список человек видит, и
  // повторный запрос пароля ничего не изменит — git-клиент же по 401 идёт к credential
  // helper и просит ввести секрет заново (карточка 012).
  if (scope !== 'write') return { code: 'access_denied', detail: 'Token has no write scope' }
  const role = await resolveRole(userId, meta)
  if (!role) return { code: 'access_denied', detail: 'You are not allowed to push to this list' }
  // Архив и заморозка — ограничения ЗАПИСИ, и git-путь обязан их соблюдать. Проверка
  // здесь, а не в ядре: на проде git идёт в Rust-ядро (SETFORK_CORE_URL), где понятий
  // frozen/archived нет вовсе, и push замороженного списка создавал новую версию —
  // ровно то, что заморозка обязана останавливать (линза 02, F3). Роут общий для обоих
  // режимов ядра, поэтому правило остаётся в одном месте.
  if (!canEditList(meta)) return writeDisabled(meta)
  return { userId, role }
}

/**
 * В каком качестве этот человек пишет в ЭТОТ список — по текущему состоянию списка.
 *
 * Отдельно от `authorizeWrite`, потому что зовётся ДВАЖДЫ: до чтения тела (быстрый
 * отказ) и вплотную к передаче пака в ядро. Между этими моментами проходит всё время
 * закачки — у большого пуша это минуты, и за них владелец успевает закрыть приём
 * предложений, спрятать список или снять соавторство.
 */
async function resolveRole(userId: string, meta: Meta): Promise<PushRole | null> {
  if (userId === meta.ownerId) return 'owner'
  if (await isCollaborator(meta.id, userId)) return 'collaborator'
  // Порядок проверок — от дешёвой к дорогой: у выключенного рубильника до ядра дело не
  // доходит вовсе.
  if (!contributorsEnabled() || !openForContributions(meta)) return null
  return (await coreEnforcesPushRoles()) ? 'contributor' : null
}

/**
 * Язык отказов, которые человек прочитает прямо в выводе `git push` (И2).
 *
 * Их печатает `pre-receive` внутри ядра, и переводить их некому — между ядром и
 * git-клиентом никого нет. Поэтому язык определяем ЗДЕСЬ и передаём ядру, а оно лишь
 * выставляет его процессу receive-pack переменной окружения.
 *
 * Порядок: осознанный выбор в профиле → локаль git-клиента → английский.
 *
 * ⚠️ «Осознанный выбор» приходится ПРИБЛИЖАТЬ. `users.lang` объявлен NOT NULL DEFAULT
 * 'en', то есть у каждого пользователя он непустой, и отличить «выбрал английский» от
 * «никогда не открывал настройки» на уровне данных нельзя. Если читать профиль как
 * есть, заголовок не сработает НИКОГДА: русскоязычный пользователь, не менявший
 * настройки уведомлений, получал бы английские отказы при русском терминале (находка
 * авто-ревью fe#632).
 *
 * Поэтому значение по умолчанию трактуем как «выбора не было» и спрашиваем клиента.
 * Цена приближения одна: тот, кто ОСОЗНАННО выбрал английский, но пушит из русской
 * локали, получит русский текст — то есть язык своего же терминала. Это мягче, чем
 * игнорировать локаль у всех остальных.
 *
 * Чинится по-настоящему отдельным признаком «язык выбран явно» (nullable-колонка или
 * флаг) — записано в трек core-i18n как открытый вопрос.
 *
 * Английский по умолчанию — решение владельца: git-инструментарий англоязычен, и
 * незнакомый язык в выводе `git push` читается как поломка, а не как забота.
 */
async function pusher(userId: string, req: Request): Promise<{ lang: Lang; handle: string }> {
  const [u] = await db.select({ lang: users.lang, handle: users.handle }).from(users).where(eq(users.id, userId)).limit(1)
  return { lang: pickLang(u?.lang, req), handle: u?.handle ?? '' }
}

/** Язык из профиля и заголовка (см. док выше у `pusher`). */
function pickLang(profile: string | undefined, req: Request): Lang {
  // Не 'en' — значит язык меняли руками: это и есть осознанный выбор.
  if (profile && profile !== 'en') return profile as Lang
  // Первый тег заголовка: `ru, *;q=0.9` → `ru`. Качества не взвешиваем — языка два, и
  // предпочтительный по спецификации и так стоит первым.
  const header = req.headers.get('accept-language') ?? ''
  const first = header.split(',')[0]?.trim().split(';')[0]?.trim().toLowerCase() ?? ''
  return first.startsWith('ru') ? 'ru' : 'en'
}

/** Тело POST с потолком и распаковкой: обе беды — про запрос, а не про сервер. */
async function readBody(req: Request, operation: 'read' | 'write'): Promise<Buffer | GitHttpFailure> {
  try {
    return await readGitBody(req).then((raw) => maybeGunzip(raw, req.headers.get('content-encoding')))
  } catch (e) {
    if (e instanceof GitBodyTooLarge) return { code: 'body_too_large', maxBytes: e.maxBytes, operation }
    if (e instanceof GitBodyMalformed) return { code: 'bad_request', detail: `Request body is not valid ${e.encoding}` }
    throw e
  }
}

const isFailure = (x: unknown): x is GitHttpFailure => !!x && typeof x === 'object' && 'code' in x

type RouteContext ={ params: Promise<{ handle: string; slug: string; git: string[] }> }

export async function GET(req: Request, ctx: RouteContext) {
  return dispatch(req, ctx, 'GET')
}

export async function POST(req: Request, ctx: RouteContext) {
  return dispatch(req, ctx, 'POST')
}

/**
 * Единая точка входа обоих методов: лимит → разбор → доступ → операция.
 *
 * Четыре ветки протокола раньше повторяли этот порядок каждая по-своему, и разъезд уже
 * случался: мета читалась до авторизации в одной ветке и после — в другой, отчего
 * разница «401 против 404» выдавала анониму существование закрытого списка.
 */
async function dispatch(req: Request, ctx: RouteContext, method: 'GET' | 'POST'): Promise<Response> {
  const rl = await rateLimit(`git:${clientIp(req)}`, 240, 60_000)
  if (!rl.ok) return gitFailureResponse({ code: 'rate_limited', retryAfter: rl.retryAfter })

  const { handle, slug, git } = await ctx.params
  const op = parseGitHttpRequest({
    method,
    handle,
    slug,
    path: git ?? [],
    url: req.url,
    gitProtocol: req.headers.get('git-protocol') ?? undefined,
  })
  if (isFailure(op)) return gitFailureResponse(op)

  const granted = await gitAccess(req, op)
  if (isFailure(granted)) return gitFailureResponse(granted)

  // Запись требует не только видимости, но и роли: проверяем ДО чтения тела, чтобы не
  // тянуть мегабайты ради отказа.
  let write: { userId: string; role: PushRole } | null = null
  if (op.need === 'write') {
    const az = await authorizeWrite(granted)
    if (isFailure(az)) return gitFailureResponse(az)
    write = az
  }

  if (op.kind === 'advertise-upload' || op.kind === 'advertise-receive') return advertise(op)
  if (op.kind === 'upload') return uploadPack(req, op)
  return receivePack(req, op, granted.meta, write!)
}

/** Реклама рефов: ядро отдаёт готовый advertisement, роут только подписывает MIME. */
async function advertise(op: GitHttpOperation): Promise<Response> {
  try {
    const body =
      op.kind === 'advertise-upload'
        ? await gitCore.infoRefsUploadPack(op.repo, op.gitProtocol)
        : await gitCore.infoRefsReceivePack(op.repo, op.gitProtocol)
    if (!body) return gitFailureResponse(coreFailure(new GitTransportError('internal', `info/refs ${op.kind}`), op.repo))
    return gitBytesResponse(body, GIT_CONTENT_TYPE[op.kind])
  } catch (e) {
    return gitFailureResponse(coreFailure(e, op.repo))
  }
}

/** Чтение (clone/fetch): тело запроса → ядро → байты протокола. */
async function uploadPack(req: Request, op: GitHttpOperation): Promise<Response> {
  const body = await readBody(req, 'read')
  if (isFailure(body)) return gitFailureResponse(body)
  try {
    const out = await gitCore.uploadPack(op.repo, body, op.gitProtocol)
    if (!out) return gitFailureResponse(coreFailure(new GitTransportError('internal', 'upload-pack'), op.repo))
    return gitBytesResponse(out, GIT_CONTENT_TYPE.upload)
  } catch (e) {
    return gitFailureResponse(coreFailure(e, op.repo))
  }
}

/**
 * Запись (push). Здесь единственная точка невозврата всей поверхности:
 * `gitCore.receivePack` либо отказал, либо пак уже принят и версия создана.
 */
async function receivePack(req: Request, op: GitHttpOperation, meta: Meta, early: { userId: string; role: PushRole }): Promise<Response> {
  const { owner: handle, slug } = op.repo
  // Ф5: отдельный, более строгий лимит для ПОСТОРОННИХ — иначе «предлагать может кто
  // угодно» превращается в открытую дверь. Считаем по пользователю, а не по IP: за NAT
  // адрес общий, зато токен всегда именной.
  //
  // Лимит стоит ЗДЕСЬ, а не в ядре, сознательно: ADR-0011 §2 называет per-user лимит в
  // ядре инфраструктурой без потребности, а во фронте `shared/rate-limit` уже есть.
  // Проверка ДО чтения тела — чтобы не тянуть мегабайты ради отказа.
  //
  // Владельца и соавтора не касается: их пуши — обычная работа со своим списком, и общий
  // лимит по IP на них уже действует.
  if (early.role === 'contributor') {
    const rlUser = await rateLimit(`git:contrib:${early.userId}`, CONTRIB_PUSHES_PER_HOUR, 3600_000)
    if (!rlUser.ok) return gitFailureResponse({ code: 'rate_limited', retryAfter: rlUser.retryAfter })
  }

  const body = await readBody(req, 'write')
  if (isFailure(body)) return gitFailureResponse(body)

  // Заморозку и архив здесь перечитывать НЕ НАДО: с Ф1 (ADR-0015) ядро само спрашивает
  // /api/internal/write-allowed вплотную к записи и под репо-локом — проверка там и
  // свежее, и необходима всем путям записи сразу.
  //
  // А вот КТО пишет, тот колбэк не проверяет и проверять не может: он спрашивает про
  // список, а не про человека (ADR-0011 §2 — пользовательской авторизации в ядре нет).
  // Поэтому роль перечитываем здесь, вплотную к передаче пака. Пока качалось тело — а у
  // большого пуша это минуты — владелец мог закрыть приём предложений, спрятать список
  // или снять соавторство, и устаревшая роль проехала бы в ядро как действующая
  // (авто-ревью fe#662). Ранняя проверка выше остаётся: она даёт отказ ДО чтения тела.
  const fresh = await getListMeta(handle, slug)
  if (!fresh || !canEditList(fresh)) return gitFailureResponse(writeDisabled(fresh ?? meta))
  const role = await resolveRole(early.userId, fresh)
  if (!role) return gitFailureResponse({ code: 'auth_required' })
  // Лимит считается по ФИНАЛЬНОЙ роли, иначе его обходят сменой качества: соавтор
  // открывает пуши, лишается соавторства за время закачки — и приходит как посторонний,
  // ни разу не тронув счётчик (авто-ревью fe#662). Второй раз с того же пуша не
  // списываем: у пришедшего посторонним счётчик уже двинулся выше, до чтения тела.
  if (role === 'contributor' && early.role !== 'contributor') {
    const rlLate = await rateLimit(`git:contrib:${early.userId}`, CONTRIB_PUSHES_PER_HOUR, 3600_000)
    if (!rlLate.ok) return gitFailureResponse({ code: 'rate_limited', retryAfter: rlLate.retryAfter })
  }

  const who = await pusher(early.userId, req)
  let res: Awaited<ReturnType<typeof gitCore.receivePack>>
  try {
    res = await gitCore.receivePack(op.repo, body, {
      gitProtocol: op.gitProtocol,
      lang: who.lang,
      // Ф5: роль едет вместе с автором — ядро исполнит по ней правило пространства.
      // `actorHandle` — переходное поле для СТАРОГО ядра: пока на проде Ф4, ветку правки
      // оно называет по нику и без него отвергает магический реф. Новое ядро его
      // игнорирует. Убрать, когда ядро с Ф5 везде (трек git-surface).
      actorId: early.userId,
      actorHandle: who.handle,
      actorRole: role,
    })
  } catch (e) {
    // ВАЖНО: это единственное место, где ошибка ядра ещё означает «пак не принят». Всё,
    // что ниже, происходит уже ПОСЛЕ записи, и туда отказ пробрасывать нельзя.
    return gitFailureResponse(coreFailure(e, op.repo))
  }
  if (!res) return gitFailureResponse(coreFailure(new GitTransportError('internal', 'receive-pack'), op.repo))

  // Дальше пак УЖЕ принят. Единственное, что делается синхронно, — запись намерения в
  // очередь: предложение из ветки, уведомления, аудит и модерация исполняются фоном и
  // не имеют права держать байты протокола (карточка 008).
  await scheduleAcceptedPushEffects({
    repo: op.repo,
    listId: meta.id,
    ownerId: meta.ownerId,
    currentVersion: meta.currentVersion,
    actorId: early.userId,
    actorHandle: who.handle,
    lang: who.lang,
    newVersion: res.newVersion ?? null,
    // `?? []` — не перестраховка: фронт выкатывается РАНЬШЕ ядра, и у старого ядра поля
    // magic в ответе нет вовсе. Убрать, когда ядро с Ф4 на проде.
    magic: (res.magic ?? []).map((m) => ({ branch: m.branch, tipSha: m.tipSha })),
    isPublic: meta.visibility === 'public',
    // Адрес берём ЗДЕСЬ: у фоновой задачи request-контекста нет, и без явного значения
    // аудит записался бы без адреса (см. док у `AcceptedPush.ip`).
    ip: clientIp(req),
  })
  return gitBytesResponse(res.data, GIT_CONTENT_TYPE.receive)
}
