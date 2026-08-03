import { eq } from 'drizzle-orm'
import { db, users } from '@/shared/db'
// eslint-disable-next-line no-restricted-imports -- git smart-HTTP: своя авторизация (токен/коллаборатор), не cookie-сессия
import { getListMeta } from '@/features/library/queries'
import { canEditList } from '@/core'
import { contributorsEnabled, openForContributions, type PushRole } from '@/features/library/push-role'
import { coreEnforcesPushRoles } from '@/features/git/capabilities'
import { ensureBranchSuggestion } from '@/features/library/suggestion-core'
import { captureError } from '@/shared/observability'
import { isCollaborator } from '@/features/collab/queries'
import { verifyApiToken } from '@/shared/auth/api-token'
import { gitCore } from '@/features/git/core'
import { GitBodyTooLarge, maybeGunzip, readGitBody } from '@/features/git/http-body'
import { notifyMany } from '@/features/notifications/notify'
import { getWatcherIds } from '@/features/watch/queries'
import { recordAudit } from '@/shared/audit'
import { clientIp, rateLimit, tooMany } from '@/shared/rate-limit'
import { envNumber } from '@/shared/env'
import { t, type Lang } from '@/shared/i18n'

// git smart-HTTP: `git clone/pull/push https://host/{owner}/{slug}.git`.
// Работает из VSCode. Источник правды — персистентный bare-репо внутри ядра
// (setfork-core/src/git/repo.rs); фронт сюда только проксирует с авторизацией.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const noCache = { Expires: 'Fri, 01 Jan 1980 00:00:00 GMT', Pragma: 'no-cache', 'Cache-Control': 'no-cache, max-age=0, must-revalidate' }
const unauthorized = () =>
  new Response('Authentication required', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="SetFork", charset="UTF-8"' } })

async function userFromBasic(req: Request): Promise<{ userId: string; scope: 'read' | 'write' } | null> {
  const h = req.headers.get('authorization') ?? ''
  if (!h.toLowerCase().startsWith('basic ')) return null
  try {
    const decoded = Buffer.from(h.slice(6).trim(), 'base64').toString('utf8')
    const pass = decoded.slice(decoded.indexOf(':') + 1) // git PAT = пароль (логин любой)
    return await verifyApiToken(pass)
  } catch {
    return null
  }
}

const cleanSlug = (raw: string) => raw.replace(/\.git$/, '')

type Meta = NonNullable<Awaited<ReturnType<typeof getListMeta>>>

/** Доступ на чтение (clone/pull): public — аноним; private/draft — владелец по токену. */
async function authorizeRead(req: Request, meta: Meta): Promise<'ok' | 401 | 404> {
  const needsAuth = meta.visibility === 'private' || meta.status === 'draft' || meta.moderation !== 'active'
  if (!needsAuth) return 'ok'
  const auth = await userFromBasic(req)
  if (!auth) return 401
  return auth.userId === meta.ownerId ? 'ok' : 404
}

/**
 * Сколько пушей в час разрешено ПОСТОРОННЕМУ (Ф5).
 *
 * Настройкой, а не числом в коде: величина зависит от того, как пойдёт, и
 * подкручивается без выкатки. Двадцать — это заметно больше, чем нужно человеку,
 * который правит список (пуш, посмотрел, поправил, ещё раз), и заметно меньше,
 * чем нужно скрипту, чтобы шуметь.
 */
const CONTRIB_PUSHES_PER_HOUR = envNumber('SETFORK_GIT_CONTRIB_PUSHES_PER_HOUR', 20)


/**
 * Доступ на запись (push): кто пушит и в каком качестве.
 *
 * Ф5: помимо владельца и соавтора пускаем ЛЮБОГО пользователя с write-токеном,
 * если список открыт для предложений. Раньше git-путь был строже веба без
 * причины: `allowFrom` по умолчанию `'all'`, то есть веб уже разрешал предлагать
 * правки кому угодно, а через git то же самое было нельзя. Правка из ветки ничем
 * не опаснее правки из формы — она точно так же ничего не меняет, пока владелец
 * её не сольёт.
 *
 * Роль уходит наружу, потому что ядро исполняет её МЕХАНИЧЕСКИ (посторонний
 * пишет только в `refs/heads/u/<ник>/*` и `refs/for/main`). Само решение остаётся
 * здесь: ADR-0011 §2 — пользовательской авторизации в ядре нет.
 */
async function authorizeWrite(req: Request, meta: Meta): Promise<{ userId: string; role: PushRole } | 401 | 403> {
  const auth = await userFromBasic(req)
  if (!auth || auth.scope !== 'write') return 401 // read-only токен не может пушить
  const role = await resolveRole(auth.userId, meta)
  if (!role) return 401
  // Архив и заморозка — ограничения ЗАПИСИ, и git-путь обязан их соблюдать. Проверка
  // здесь, а не в ядре: на проде git идёт в Rust-ядро (SETFORK_CORE_URL), где понятий
  // frozen/archived нет вовсе, и push замороженного списка создавал новую версию —
  // ровно то, что заморозка обязана останавливать (линза 02, F3). Роут общий для
  // обоих режимов ядра, поэтому правило остаётся в одном месте.
  if (!canEditList(meta)) return 403
  return { userId: auth.userId, role }
}

/**
 * В каком качестве этот человек пишет в ЭТОТ список — по текущему состоянию списка.
 *
 * Отдельно от `authorizeWrite`, потому что зовётся ДВАЖДЫ: до чтения тела (быстрый
 * отказ) и вплотную к передаче пака в ядро. Между этими моментами проходит всё
 * время закачки — у большого пуша это минуты, и за них владелец успевает закрыть
 * приём предложений, спрятать список или снять соавторство.
 */
async function resolveRole(userId: string, meta: Meta): Promise<PushRole | null> {
  if (userId === meta.ownerId) return 'owner'
  if (await isCollaborator(meta.id, userId)) return 'collaborator'
  // Порядок проверок — от дешёвой к дорогой: у выключенного рубильника до ядра
  // дело не доходит вовсе.
  if (!contributorsEnabled() || !openForContributions(meta)) return null
  return (await coreEnforcesPushRoles()) ? 'contributor' : null
}

/**
 * Ф0 (хвост): тело больше потолка. Текст английский, как и у соседних отказов
 * здесь: git-инструментарий англоязычен, а этот ответ читает не только человек,
 * но и лог CI. Число в тексте настоящее — без него отказ не подсказывает,
 * насколько ужиматься.
 */
const tooLarge = (e: GitBodyTooLarge) =>
  new Response(
    `Push is too large: the limit is ${Math.round(e.maxBytes / 1024 / 1024)} MB per request.\n` +
      'A list is text — this usually means binaries got committed. Keep images and attachments out of the repository.\n',
    { status: 413, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  )

const writeDisabled = () =>
  new Response('List is archived or frozen: writes are disabled', { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })

/**
 * Язык отказов, которые человек прочитает прямо в выводе `git push` (И2).
 *
 * Их печатает `pre-receive` внутри ядра, и переводить их некому — между ядром и
 * git-клиентом никого нет. Поэтому язык определяем ЗДЕСЬ и передаём ядру, а оно
 * лишь выставляет его процессу receive-pack переменной окружения.
 *
 * Порядок: осознанный выбор в профиле → локаль git-клиента → английский.
 *
 * ⚠️ «Осознанный выбор» приходится ПРИБЛИЖАТЬ. `users.lang` объявлен NOT NULL
 * DEFAULT 'en', то есть у каждого пользователя он непустой, и отличить «выбрал
 * английский» от «никогда не открывал настройки» на уровне данных нельзя. Если
 * читать профиль как есть, заголовок не сработает НИКОГДА: русскоязычный
 * пользователь, не менявший настройки уведомлений, получал бы английские отказы
 * при русском терминале (находка авто-ревью fe#632).
 *
 * Поэтому значение по умолчанию трактуем как «выбора не было» и спрашиваем
 * клиента. Цена приближения одна: тот, кто ОСОЗНАННО выбрал английский, но
 * пушит из русской локали, получит русский текст — то есть язык своего же
 * терминала. Это мягче, чем игнорировать локаль у всех остальных.
 *
 * Чинится по-настоящему отдельным признаком «язык выбран явно» (nullable-колонка
 * или флаг) — записано в трек core-i18n как открытый вопрос.
 *
 * Английский по умолчанию — решение владельца: git-инструментарий англоязычен, и
 * незнакомый язык в выводе `git push` читается как поломка, а не как забота.
 */
async function pusher(userId: string, req: Request): Promise<{ lang: Lang; handle: string }> {
  const [u] = await db
    .select({ lang: users.lang, handle: users.handle })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  return { lang: pickLang(u?.lang, req), handle: u?.handle ?? '' }
}

/** Язык из профиля и заголовка (см. док выше у `pusher`). */
function pickLang(profile: string | undefined, req: Request): Lang {
  // Не 'en' — значит язык меняли руками: это и есть осознанный выбор.
  if (profile && profile !== 'en') return profile as Lang
  // Первый тег заголовка: `ru, *;q=0.9` → `ru`. Качества не взвешиваем — языка
  // два, и предпочтительный по спецификации и так стоит первым.
  const header = req.headers.get('accept-language') ?? ''
  const first = header.split(',')[0]?.trim().split(';')[0]?.trim().toLowerCase() ?? ''
  return first.startsWith('ru') ? 'ru' : 'en'
}

export async function GET(req: Request, { params }: { params: Promise<{ handle: string; slug: string; git: string[] }> }) {
  const rl = await rateLimit(`git:${clientIp(req)}`, 240, 60_000)
  if (!rl.ok) return tooMany(rl)
  const { handle, slug: rawSlug, git } = await params
  if ((git ?? []).join('/') !== 'info/refs') return new Response('Not found', { status: 404 })
  const service = new URL(req.url).searchParams.get('service')
  const slug = cleanSlug(rawSlug)
  const meta = await getListMeta(handle, slug)
  if (!meta) return new Response('Not found', { status: 404 })
  const gitProtocol = req.headers.get('git-protocol') ?? undefined

  if (service === 'git-upload-pack') {
    const az = await authorizeRead(req, meta)
    if (az !== 'ok') return az === 401 ? unauthorized() : new Response('Not found', { status: 404 })
    const body = await gitCore.infoRefsUploadPack({ owner: handle, slug }, gitProtocol)
    if (!body) return new Response('Repository unavailable', { status: 500 })
    return new Response(new Uint8Array(body), { headers: { 'Content-Type': 'application/x-git-upload-pack-advertisement', ...noCache } })
  }

  if (service === 'git-receive-pack') {
    const az = await authorizeWrite(req, meta)
    if (az === 401) return unauthorized()
    if (az === 403) return writeDisabled()
    const body = await gitCore.infoRefsReceivePack({ owner: handle, slug }, gitProtocol)
    if (!body) return new Response('Repository unavailable', { status: 500 })
    return new Response(new Uint8Array(body), { headers: { 'Content-Type': 'application/x-git-receive-pack-advertisement', ...noCache } })
  }

  return new Response('Service not available', { status: 403 })
}

/**
 * Заголовок предложения, пришедшего из терминала.
 *
 * По умолчанию `ensureBranchSuggestion` берёт `Merge branch '<ветка>'`, а ветку
 * магическому пушу называет сервер — `u/<идентификатор>/<база>`. В списке
 * предложений это самая крупная строка карточки, и в ней торчал бы внутренний
 * идентификатор: подпись `branchLabel` прячет его в метаданных, но заголовок
 * лежит в базе отдельным полем и форматтеру не подчиняется (авто-ревью fe#662).
 *
 * Берём тему коммита — ровно как GitHub, который подставляет в заголовок PR
 * тему единственного коммита, а при нескольких переходит на имя ветки. Имя
 * ветки нам не годится, поэтому вторая ветка развилки — общая подпись.
 *
 * Ошибку глотаем: заголовок — не повод отменять уже принятый пуш.
 */
async function terminalPushNote(repo: { owner: string; slug: string }, branch: string, lang: Lang): Promise<string> {
  const commits = await gitCore.listCommits(repo, branch, { notIn: 'main', limit: 2 }).catch(() => null)
  // Первая строка сообщения: остальное — тело коммита, в заголовок ему нельзя.
  const subject = commits?.length === 1 ? (commits[0]?.message.split('\n')[0]?.trim() ?? '') : ''
  return subject || t('prFromTerminal', lang)
}

export async function POST(req: Request, { params }: { params: Promise<{ handle: string; slug: string; git: string[] }> }) {
  const rl = await rateLimit(`git:${clientIp(req)}`, 240, 60_000)
  if (!rl.ok) return tooMany(rl)
  const { handle, slug: rawSlug, git } = await params
  const path = (git ?? []).join('/')
  const slug = cleanSlug(rawSlug)
  const meta = await getListMeta(handle, slug)
  if (!meta) return new Response('Not found', { status: 404 })
  const gitProtocol = req.headers.get('git-protocol') ?? undefined

  if (path === 'git-upload-pack') {
    const az = await authorizeRead(req, meta)
    if (az !== 'ok') return az === 401 ? unauthorized() : new Response('Not found', { status: 404 })
    let body: Buffer
    try {
      body = await readGitBody(req).then((raw) => maybeGunzip(raw, req.headers.get('content-encoding')))
    } catch (e) {
      if (e instanceof GitBodyTooLarge) return tooLarge(e)
      throw e
    }
    const out = await gitCore.uploadPack({ owner: handle, slug }, body, gitProtocol)
    if (!out) return new Response('Repository unavailable', { status: 500 })
    return new Response(new Uint8Array(out), { headers: { 'Content-Type': 'application/x-git-upload-pack-result', ...noCache } })
  }

  if (path === 'git-receive-pack') {
    const az = await authorizeWrite(req, meta)
    if (az === 401) return unauthorized()
    if (az === 403) return writeDisabled()
    // Ф5: отдельный, более строгий лимит для ПОСТОРОННИХ — иначе «предлагать
    // может кто угодно» превращается в открытую дверь. Считаем по пользователю,
    // а не по IP: за NAT адрес общий, зато токен всегда именной.
    //
    // Лимит стоит ЗДЕСЬ, а не в ядре, сознательно: ADR-0011 §2 называет per-user
    // лимит в ядре инфраструктурой без потребности, а во фронте `shared/rate-limit`
    // уже есть. Проверка ДО чтения тела — чтобы не тянуть мегабайты ради отказа.
    //
    // Владельца и соавтора не касается: их пуши — обычная работа со своим
    // списком, и общий лимит по IP на них уже действует.
    if (az.role === 'contributor') {
      const rlUser = await rateLimit(`git:contrib:${az.userId}`, CONTRIB_PUSHES_PER_HOUR, 3600_000)
      if (!rlUser.ok) return tooMany(rlUser)
    }
    let body: Buffer
    try {
      body = await readGitBody(req).then((raw) => maybeGunzip(raw, req.headers.get('content-encoding')))
    } catch (e) {
      if (e instanceof GitBodyTooLarge) return tooLarge(e)
      throw e
    }
    // Заморозку и архив здесь перечитывать НЕ НАДО: с Ф1 (ADR-0015) ядро само
    // спрашивает /api/internal/write-allowed вплотную к записи и под репо-локом —
    // проверка там и свежее, и необходима всем путям записи сразу.
    //
    // А вот КТО пишет, тот колбэк не проверяет и проверять не может: он спрашивает
    // про список, а не про человека (ADR-0011 §2 — пользовательской авторизации в
    // ядре нет). Поэтому роль перечитываем здесь, вплотную к передаче пака. Пока
    // качалось тело — а у большого пуша это минуты — владелец мог закрыть приём
    // предложений, спрятать список или снять соавторство, и устаревшая роль
    // проехала бы в ядро как действующая (авто-ревью fe#662). Ранняя проверка выше
    // остаётся: она даёт отказ ДО чтения тела, чтобы не тянуть мегабайты зря.
    const fresh = await getListMeta(handle, slug)
    if (!fresh || !canEditList(fresh)) return writeDisabled()
    const role = await resolveRole(az.userId, fresh)
    if (!role) return unauthorized()
    const who = await pusher(az.userId, req)
    const res = await gitCore.receivePack(
      { owner: handle, slug },
      body,
      // Ф5: роль едет вместе с автором — ядро исполнит по ней правило пространства.
      { gitProtocol, lang: who.lang, actorId: az.userId, actorRole: role },
    )
    if (!res) return new Response('Repository unavailable', { status: 500 })
    // Ф4: магический пуш `refs/for/main` — ядро положило коммиты в ветку автора,
    // предложение делаем здесь. Ядро о нумерации, уведомлениях и аудите не знает
    // и знать не должно (ADR-0015 провёл ту же границу для предусловий записи).
    //
    // Идемпотентно по ветке: повторный пуш двигает ту же ветку и обновляет ТО ЖЕ
    // предложение — новая ревизия, а не второе предложение.
    // `?? []` — не перестраховка: фронт выкатывается РАНЬШЕ ядра, и у старого
    // ядра поля magic в ответе нет вовсе. Без этого первый же push после
    // выкатки фронта падал бы с TypeError уже ПОСЛЕ приёма пака — то есть
    // человек видел бы ошибку на успешном пуше. Убрать, когда ядро с Ф4 на проде.
    await Promise.all(
      (res.magic ?? []).map(async (m) => {
        try {
          // Ветка обязана материализоваться в список — ровно как на пути кнопки
          // «Открыть предложение». Хук требует наличия list.json, но не его
          // разбираемости: битый JSON проходит `cat-file -e`. Предложение,
          // которое не рендерится, хуже отсутствующего (авто-ревью fe#636).
          const snap = await gitCore.branchSnapshot({ owner: handle, slug }, m.branch).catch(() => null)
          if (!snap) {
            captureError(new Error('magic push: branch does not materialize as a list'), {
              where: 'git.magic-push',
              slug,
              branch: m.branch,
            })
            return
          }
          const sug = await ensureBranchSuggestion({
            templateId: meta.id,
            ownerId: meta.ownerId,
            currentVersion: meta.currentVersion,
            authorId: az.userId,
            branch: m.branch,
            note: await terminalPushNote({ owner: handle, slug }, m.branch, who.lang),
          })
          await recordAudit('git.suggest', {
            actorId: az.userId,
            targetType: 'suggestion',
            targetId: sug.id,
            meta: { slug, branch: m.branch, tip: m.tipSha, revision: sug.created ? 'first' : 'new' },
          })
        } catch (e) {
          // Пуш УЖЕ принят: git-объекты на месте, ветка автора создана. Уронить
          // здесь ответ значило бы показать человеку ошибку при успешном пуше и
          // подтолкнуть его пушить снова. Громко в лог — и живём: предложение
          // можно открыть кнопкой из этой же ветки.
          captureError(e, { where: 'git.magic-push', slug, branch: m.branch })
        }
      }),
    )
    // Уведомление наблюдателей + аудит — delivery-эффекты, вне git-ядра.
    if (res.newVersion != null) {
      const watchers = await getWatcherIds(meta.id, 'versions')
      await notifyMany(watchers, { type: 'new_version', templateId: meta.id }).catch(() => {})
      await recordAudit('git.push', { actorId: az.userId, targetType: 'list', targetId: meta.id, meta: { version: res.newVersion, slug } })
      // push меняет title/desc/tags минуя формы → пере-проверяем публичный список в фоне.
      if (meta.visibility === 'public') {
        const { recheckList } = await import('@/features/moderation/moderate-list')
        await recheckList(meta.id).catch(() => {})
      }
    }
    return new Response(new Uint8Array(res.data), { headers: { 'Content-Type': 'application/x-git-receive-pack-result', ...noCache } })
  }

  return new Response('Not found', { status: 404 })
}
