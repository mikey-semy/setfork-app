import { canEditList, GitTransportError } from '@/core'
import type { PushRole } from '@/features/library/push-role'
import { captureError } from '@/shared/observability'
import { gitCore } from '@/features/git/core'
import { GitBodyMalformed, GitBodyTooLarge, maybeGunzip, readGitBody } from '@/features/git/http-body'
import { authorizeGitRead, authorizeGitWrite, freshMeta, resolvePushRole, writeDisabled, type Meta } from './access'
import { gitActorContext } from '@/features/git/actor-context'
import { GIT_CONTENT_TYPE, parseGitHttpRequest, type GitHttpOperation } from '@/features/git/http-request'
import { gitBytesResponse, gitFailureResponse, type GitHttpFailure } from '@/features/git/http-response'
import { gitMovedResponse } from '@/features/git/moved'
import { scheduleAcceptedPushEffects } from '@/features/git/push-effects'
import { clientIp, rateLimit } from '@/shared/rate-limit'
import { envNumber } from '@/shared/env'

// git smart-HTTP: `git clone/pull/push https://host/{owner}/{slug}.git`.
// Работает из VSCode. Источник правды — персистентный bare-репо внутри ядра
// (setfork-core/src/git/repo.rs); фронт сюда только проксирует с авторизацией.
//
// Файл — ОРКЕСТРАЦИЯ и ничего больше: лимит → разбор → доступ → ядро → ответ. Форма
// провода живёт в http-request/http-response, кредитив и права — в http-auth/http-access,
// тело — в http-body, доставка после принятой записи — в push-effects.
//
// Проверка границы: этот файл обязан меняться, когда меняется HTTP-провод git, и НЕ
// должен — когда меняются роли соавторов, коды отказов, выбор языка или уведомления.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Сколько пушей в час разрешено ПОСТОРОННЕМУ (Ф5).
 *
 * Настройкой, а не числом в коде: величина зависит от того, как пойдёт, и подкручивается
 * без выкатки. Двадцать — это заметно больше, чем нужно человеку, который правит список
 * (пуш, посмотрел, поправил, ещё раз), и заметно меньше, чем нужно скрипту, чтобы шуметь.
 */
const CONTRIB_PUSHES_PER_HOUR = envNumber('SETFORK_GIT_CONTRIB_PUSHES_PER_HOUR', 20)

const isFailure = (x: unknown): x is GitHttpFailure => !!x && typeof x === 'object' && 'code' in x

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

type RouteContext = { params: Promise<{ handle: string; slug: string; git: string[] }> }

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

  const grant = await authorizeGitRead(req.headers.get('authorization'), op.repo, op.need)
  if (isFailure(grant)) {
    // «Нет такого репозитория» может означать «его переименовали»: адрес живёт в
    // git remote у каждого, кто клонировал, и обязан доводить до места.
    if (grant.code === 'not_found') {
      const moved = await gitMovedResponse(req, op.repo)
      if (moved) return moved
    }
    return gitFailureResponse(grant)
  }

  // Запись требует не только видимости, но и роли: проверяем ДО чтения тела, чтобы не
  // тянуть мегабайты ради отказа.
  let write: { userId: string; role: PushRole } | null = null
  if (op.need === 'write') {
    const az = await authorizeGitWrite(grant)
    if (isFailure(az)) return gitFailureResponse(az)
    write = az
  }

  if (op.kind === 'advertise-upload' || op.kind === 'advertise-receive') return advertise(op)
  if (op.kind === 'upload') return uploadPack(req, op)
  return receivePack(req, op, grant.meta, write!)
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
  const fresh = await freshMeta(op.repo)
  if (!fresh || !canEditList(fresh)) return gitFailureResponse(writeDisabled(fresh ?? meta))
  const role = await resolvePushRole(early.userId, fresh)
  if (!role) return gitFailureResponse({ code: 'auth_required' })
  // Лимит считается по ФИНАЛЬНОЙ роли, иначе его обходят сменой качества: соавтор
  // открывает пуши, лишается соавторства за время закачки — и приходит как посторонний,
  // ни разу не тронув счётчик (авто-ревью fe#662). Второй раз с того же пуша не
  // списываем: у пришедшего посторонним счётчик уже двинулся выше, до чтения тела.
  if (role === 'contributor' && early.role !== 'contributor') {
    const rlLate = await rateLimit(`git:contrib:${early.userId}`, CONTRIB_PUSHES_PER_HOUR, 3600_000)
    if (!rlLate.ok) return gitFailureResponse({ code: 'rate_limited', retryAfter: rlLate.retryAfter })
  }

  const who = await gitActorContext(early.userId, req.headers.get('accept-language'))
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

  // `?? []` у magic — не перестраховка: фронт выкатывается РАНЬШЕ ядра, и у старого ядра
  // этого поля в ответе нет вовсе. Убрать, когда ядро с Ф4 на проде.
  const magic = (res.magic ?? []).map((m) => ({ branch: m.branch, tipSha: m.tipSha }))
  // Доставлять нечего — задачу не ставим: пуш, не создавший ни версии, ни ветки правки,
  // иначе клал бы в очередь пустое намерение на каждый вызов.
  if (res.newVersion != null || magic.length > 0) {
    await scheduleAcceptedPushEffects({
      repo: op.repo,
      listId: meta.id,
      ownerId: meta.ownerId,
      currentVersion: meta.currentVersion,
      actorId: early.userId,
      actorHandle: who.handle,
      lang: who.lang,
      newVersion: res.newVersion ?? null,
      magic,
      isPublic: meta.visibility === 'public',
      // Адрес берём ЗДЕСЬ: у фоновой задачи request-контекста нет, и без явного значения
      // аудит записался бы без адреса (см. док у `AcceptedPush.ip`).
      ip: clientIp(req),
    })
  }
  return gitBytesResponse(res.data, GIT_CONTENT_TYPE.receive)
}
