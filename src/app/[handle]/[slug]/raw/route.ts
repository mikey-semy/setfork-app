import { getLang } from '@/shared/i18n/server'
import { requireViewableDetail, requireViewableDetailFor } from '@/features/library/guard'
import { dialectExt, dialectMime, normalizeDialect, toRunnableScript, toExportList } from '@/features/library/export'
import { isPubliclyVisible } from '@/core'
import { appOrigin } from '@/shared/auth/app-origin'
import { verifyApiToken } from '@/shared/auth/api-token'
import { clientIp, rateLimit, tooMany } from '@/shared/rate-limit'
import { cacheHeaders, noStoreHeaders, notModified } from '@/shared/http/cache'

/**
 * GET /{handle}/{slug}/raw[?lang=sh|ps1|py] — СПИСОК КАК ИСПОЛНЯЕМЫЙ СКРИПТ (gist-стиль).
 *
 *   curl -fsSL https://host/{owner}/{slug}/raw | bash
 *   irm "https://host/{owner}/{slug}/raw?lang=ps1" | iex
 *
 * Машинный контракт держится ТЕМ ЖЕ набором правил, что у близнеца `data.json`: тот отдаёт
 * список как данные, этот — как код. Раньше правила были только у близнеца, и правки,
 * сделанные там по находкам авто-ревью (общий кеш только для публично видимого, язык в
 * ключе кеша), в эту половину пары не переносили. Здесь не было ни кеш-политики, ни ETag,
 * ни разбора Authorization, ни лимита частоты — при том, что отдаётся исполняемый код.
 */
export const runtime = 'nodejs'

const plain = (body: string, status: number, mime: string) =>
  new Response(body, { status, headers: { 'Content-Type': mime, ...noStoreHeaders() } })

/**
 * Имя файла для Content-Disposition. Слаг приходит из АДРЕСА, а адреса старых списков
 * создавались правилами, которых больше нет: в базе живут слаги вида `-`, и такой файл
 * скачивается как `-.sh`, после чего обычное `bash *.sh` разворачивается в аргумент,
 * начинающийся с дефиса. Санитайзер на выдаче, а не доверие к хранилищу.
 */
function safeFilename(slug: string, ext: string): string {
  const base = slug.replace(/[^A-Za-z0-9._-]/g, '').replace(/^[-.]+/, '')
  return `${base || 'list'}.${ext}`
}

export async function GET(req: Request, { params }: { params: Promise<{ handle: string; slug: string }> }) {
  const { handle, slug } = await params
  const u = new URL(req.url)
  const dialect = normalizeDialect(u.searchParams.get('lang'))
  const mime = dialectMime(dialect)

  // Частотный лимит по IP: транспорт публичный, без аутентификации, и его дёргают в цикле.
  // Тот же бюджет, что у близнеца — один контракт на обе машинные поверхности.
  const rate = await rateLimit(`list-raw:${clientIp(req)}`, 120, 60_000)
  if (!rate.ok) return tooMany(rate)

  // Токен важнее сессии: если он передан, читаем ОТ ЕГО ВЛАДЕЛЬЦА. Предъявленный кредитив
  // обязан быть либо принят, либо отклонён — раньше заголовок не читался вовсе, поэтому
  // отозванный токен получал 200 как аноним (отзыв на этой поверхности был ненаблюдаем),
  // а владелец приватного списка не мог забрать собственный скрипт ничем, кроме браузера.
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  const auth = bearer ? await verifyApiToken(bearer) : null
  if (bearer && !auth) return plain('# Invalid token\n', 401, mime)

  const [lang, detail] = await Promise.all([
    getLang(),
    auth ? requireViewableDetailFor(handle, slug, auth.userId) : requireViewableDetail(handle, slug),
  ])
  // Приватный список без прав неотличим от несуществующего — та же политика, что у близнеца.
  if (!detail) return plain('# Not found\n', 404, mime)

  // Происхождение и команда повторного запуска — из КОНФИГУРАЦИИ, а не из адреса запроса.
  // На проде `req.url` строится из адреса привязки сервера, и скрипт называл своим
  // источником `https://0.0.0.0:3000`: артефакт не имел проверяемого происхождения, а
  // напечатанная в нём команда запуска была нерабочей.
  const rawUrl = `${appOrigin()}/${handle}/${slug}/raw`
  // Выбор пунктов: ?bid=<id> (можно несколько раз) или ?bids=a,b. Справочник на
  // тридцать пунктов не нужно тащить целиком ради одного — тот же адрес блока,
  // что отдаёт get_list. Неизвестный адрес — явный отказ, а не тихо весь список.
  const list = toExportList(detail)
  const only = [...u.searchParams.getAll('bid'), ...(u.searchParams.get('bids') ?? '').split(',')]
    .map((b) => b.trim())
    .filter(Boolean)
  const known = new Set(list.steps.flatMap((s) => (s.bid ? [s.bid] : [])))
  const unknown = only.filter((b) => !known.has(b))
  if (unknown.length) return plain(`# No such block: ${unknown.join(', ')}\n`, 404, mime)

  const version = detail.currentVersion?.version ?? detail.tpl.currentVersion
  const updatedAt = detail.tpl.updatedAt ?? new Date(0)
  // Выборка — часть ответа, значит и часть ключа кеша: без неё общий прокси отдал
  // бы скрипт одного пункта тому, кто просил другой.
  const etag = `W/"v${version}-${updatedAt.getTime()}-${lang}-${dialect}${only.length ? `-${only.join('.')}` : ''}"`

  // Общий кеш — только для того, что вправе увидеть аноним, и предикат единый:
  // собственная проверка «публичный и не черновик» пропускала МОДЕРАЦИЮ, и общий прокси
  // раздал бы анониму скрытое содержимое, ни разу не спросив guard.
  // Язык текста здесь ДОГОВОРНЫЙ: `?lang=` у этой поверхности выбирает диалект скрипта,
  // а не язык шагов — тот приходит из куки и Accept-Language, и кеш обязан их различать.
  const shared = isPubliclyVisible(detail.tpl) && !auth
  const headers: Record<string, string> = {
    'Content-Type': mime,
    'Content-Disposition': `inline; filename="${safeFilename(slug, dialectExt(dialect))}"`,
    ...cacheHeaders({ shared, etag, negotiated: true }),
  }

  // Условный запрос: у машинной поверхности, которую опрашивают в цикле, повторный
  // ответ не должен стоить ни генерации, ни трафика.
  const cached = notModified(req, etag, headers)
  if (cached) return cached

  return new Response(toRunnableScript(list, lang, rawUrl, dialect, { only }), { headers })
}
