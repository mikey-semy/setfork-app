import { getLang } from '@/shared/i18n/server'
import { isLang, type Lang } from '@/shared/i18n'
import { requireViewableDetail, requireViewableDetailFor } from '@/features/library/guard'
import { toExportList } from '@/features/library/export'
import { isPubliclyVisible } from '@/core'
import { dataEtag, toDataEnvelope } from '@/features/library/data-envelope'
import { verifyApiToken } from '@/shared/auth/api-token'
import { clientIp, rateLimit, tooMany } from '@/shared/rate-limit'

/**
 * GET /{handle}/{slug}/data.json — СПИСОК КАК ДАННЫЕ.
 *
 * Второй транспорт рядом с `/raw`: тот отдаёт список как исполняемый скрипт, этот — как
 * данные для чужого кода. До него список можно было ИСПОЛНИТЬ (raw | bash, MCP-прогон,
 * git-клон), но нельзя было ПРОЧИТАТЬ программой: справочник, который ведёт человек, коду
 * доставался только копипастой. Наш собственный прайс RU-провайдеров — первый потребитель.
 *
 *   curl -fsSL https://host/alice/prices/data.json
 *   curl -H 'Authorization: Bearer sf_…' …/data.json     # приватный список
 *
 * Авторизация: сессия (человек в браузере) ИЛИ API-токен — тот же самый, что уже носит MCP.
 * Отдельных ключей заводить не пришлось, и это правильно: один секрет на все транспорты.
 * Токену хватает области `read` — запись сюда не ходит вовсе.
 */
export const runtime = 'nodejs'

const NOT_FOUND = JSON.stringify({ error: 'not_found' })

function json(body: string, status: number, headers: Record<string, string> = {}) {
  return new Response(body, { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } })
}

export async function GET(req: Request, { params }: { params: Promise<{ handle: string; slug: string }> }) {
  const { handle, slug } = await params
  const u = new URL(req.url)

  // Частотный лимит по IP: транспорт публичный и его будут дёргать в цикле.
  const rate = await rateLimit(`list-data:${clientIp(req)}`, 120, 60_000)
  if (!rate.ok) return tooMany(rate)

  // Язык ответа: явный ?lang= важнее куки — у кода нет «своего» языка, он просит нужный.
  const asked = u.searchParams.get('lang')
  const lang: Lang = isLang(asked) ? asked : await getLang()

  // Токен важнее сессии: если он передан, читаем ОТ ЕГО ВЛАДЕЛЬЦА. Иначе чужой токен в
  // браузере с активной сессией давал бы права сессии — тихая подмена субъекта.
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  const auth = bearer ? await verifyApiToken(bearer) : null
  if (bearer && !auth) return json(JSON.stringify({ error: 'invalid_token' }), 401)

  const detail = auth ? await requireViewableDetailFor(handle, slug, auth.userId) : await requireViewableDetail(handle, slug)
  // Приватный список без прав неотличим от несуществующего — иначе 403 подтверждал бы,
  // что такой список есть.
  if (!detail) return json(NOT_FOUND, 404)

  const updatedAt = detail.tpl.updatedAt ?? new Date(0)
  const etag = dataEtag(detail.currentVersion?.version ?? detail.tpl.currentVersion, updatedAt, lang)
  /**
   * Общий кеш — ТОЛЬКО для того, что вправе увидеть аноним. Предикат берём единый
   * (isPubliclyVisible), а не пишем свой: собственная проверка `visibility === 'public' &&
   * status !== 'draft'` пропускала МОДЕРАЦИЮ. Список под флагом виден владельцу и админу,
   * ответ уходил бы с `Cache-Control: public`, и общий прокси раздал бы скрытое модерацией
   * содержимое анониму, ни разу не спросив наш guard (находка авто-ревью, P1).
   */
  const isPublic = isPubliclyVisible(detail.tpl)
  /**
   * Язык. Без явного `?lang=` представление выбирается по куке и Accept-Language — то есть
   * под одним и тем же адресом лежат два разных тела. Класть такое в ОБЩИЙ кеш нельзя: первый
   * русский ответ достанется следующему англоязычному (P2 того же ревью). Поэтому в общий кеш
   * пускаем только явно запрошенный язык, а договорный отдаём приватно и с Vary.
   */
  const explicitLang = isLang(asked)
  const shared = isPublic && explicitLang
  const cache = shared ? 'public, max-age=60, stale-while-revalidate=600' : 'private, no-store'
  const headers: Record<string, string> = { ETag: etag, 'Cache-Control': cache, Vary: 'Accept-Language, Cookie, Authorization' }
  // CORS только для публичных: браузерному коду это нужно, а приватное отдаём лишь по токену.
  if (isPublic) headers['Access-Control-Allow-Origin'] = '*'

  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers })

  const envelope = toDataEnvelope(toExportList(detail), lang, `${u.origin}/${handle}/${slug}`, updatedAt)
  return json(JSON.stringify(envelope, null, 2), 200, headers)
}
