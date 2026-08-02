import { eq } from 'drizzle-orm'
import { db, users } from '@/shared/db'
// eslint-disable-next-line no-restricted-imports -- git smart-HTTP: своя авторизация (токен/коллаборатор), не cookie-сессия
import { getListMeta } from '@/features/library/queries'
import { canEditList } from '@/core'
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

/** Доступ на запись (push): владелец/коллаборатор по токену со scope 'write' и список,
 *  в который вообще можно писать. Возвращает userId пушащего (для аудита), 401 или 403. */
async function authorizeWrite(req: Request, meta: Meta): Promise<string | 401 | 403> {
  const auth = await userFromBasic(req)
  if (!auth || auth.scope !== 'write') return 401 // read-only токен не может пушить
  const allowed = auth.userId === meta.ownerId || (await isCollaborator(meta.id, auth.userId))
  if (!allowed) return 401
  // Архив и заморозка — ограничения ЗАПИСИ, и git-путь обязан их соблюдать. Проверка
  // здесь, а не в ядре: на проде git идёт в Rust-ядро (SETFORK_CORE_URL), где понятий
  // frozen/archived нет вовсе, и push замороженного списка создавал новую версию —
  // ровно то, что заморозка обязана останавливать (линза 02, F3). Роут общий для
  // обоих режимов ядра, поэтому правило остаётся в одном месте.
  if (!canEditList(meta)) return 403
  return auth.userId
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
async function pusher(userId: string, req: Request): Promise<{ lang: string; handle: string }> {
  const [u] = await db
    .select({ lang: users.lang, handle: users.handle })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  return { lang: pickLang(u?.lang, req), handle: u?.handle ?? '' }
}

/** Язык из профиля и заголовка (см. док выше у `pusher`). */
function pickLang(profile: string | undefined, req: Request): string {
  // Не 'en' — значит язык меняли руками: это и есть осознанный выбор.
  if (profile && profile !== 'en') return profile
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
    let body: Buffer
    try {
      body = await readGitBody(req).then((raw) => maybeGunzip(raw, req.headers.get('content-encoding')))
    } catch (e) {
      if (e instanceof GitBodyTooLarge) return tooLarge(e)
      throw e
    }
    // Второго перечитывания состояния здесь БОЛЬШЕ НЕТ. Оно стояло тут потому, что
    // большой push висит минутами и владелец может заморозить список ровно в это
    // окно, а ядро о заморозке не знало. С Ф1 (ADR-0015) знает: ядро само спрашивает
    // /api/internal/write-allowed вплотную к записи и под репо-локом — то есть
    // проверка стала не только не устаревшей, но и не обходимой другими путями.
    // Ранняя проверка выше (authorizeWrite → canEditList) остаётся: она даёт быстрый
    // отказ ДО чтения тела, чтобы не тянуть мегабайты ради заведомого 403.
    const who = await pusher(az, req)
    const res = await gitCore.receivePack(
      { owner: handle, slug },
      body,
      { gitProtocol, lang: who.lang, actorHandle: who.handle },
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
            authorId: az,
            branch: m.branch,
          })
          await recordAudit('git.suggest', {
            actorId: az,
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
      await recordAudit('git.push', { actorId: az, targetType: 'list', targetId: meta.id, meta: { version: res.newVersion, slug } })
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
