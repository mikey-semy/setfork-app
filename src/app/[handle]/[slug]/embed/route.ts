import { getLang } from '@/shared/i18n/server'
import { t, type Lang } from '@/shared/i18n'
// eslint-disable-next-line no-restricted-imports -- анонимный embed на внешние сайты: гейт isPubliclyVisible, не cookie-сессия
import { getTemplateDetail } from '@/features/library/queries'
import { isPubliclyVisible } from '@/core'
import { embedHtml, toExportList } from '@/features/library/export'
import { cacheHeaders, noStoreHeaders, notModified } from '@/shared/http/cache'

// GET /{handle}/{slug}/embed — самодостаточный HTML списка для вставки в <iframe>.
// Только публичные опубликованные списки (embed идёт на внешние сайты).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const notFoundHtml = (lang: Lang) =>
  new Response(
    `<!doctype html><html lang="${lang}"><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#faf9f7;color:#6b6b66;font:14px ui-sans-serif,system-ui,sans-serif">${t('embedNotFound', lang)}</body></html>`,
    // Отказ не хранит никто: иначе опубликованный позже список ещё какое-то время
    // показывался бы в чужом iframe как «не найдено».
    { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', ...noStoreHeaders() } },
  )

export async function GET(req: Request, { params }: { params: Promise<{ handle: string; slug: string }> }) {
  const { handle, slug } = await params
  const [lang, detail] = await Promise.all([getLang(), getTemplateDetail(handle, slug)])
  if (!detail) return notFoundHtml(lang)
  if (!isPubliclyVisible(detail.tpl)) return notFoundHtml(lang)

  const list = toExportList(detail)
  const origin = new URL(req.url).origin
  const html = embedHtml(list, lang, `${origin}/${handle}/${slug}`)

  // Язык здесь ДОГОВОРНЫЙ: параметра ?lang= у embed нет, тело выбирается по куке и
  // Accept-Language. Значит под одним адресом живут разные представления, и общий кеш
  // обязан их различать — раньше он об этом не знал и мог отдать русский iframe
  // англоязычному сайту. Язык входит и в ETag: ревалидация не выдаст чужое тело.
  const version = detail.currentVersion?.version ?? detail.tpl.currentVersion
  const updatedAt = detail.tpl.updatedAt ?? new Date(0)
  const etag = `W/"v${version}-${updatedAt.getTime()}-${lang}"`
  const headers: Record<string, string> = {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': 'frame-ancestors *', // разрешаем вставку на любые сайты
    ...cacheHeaders({ shared: true, etag, negotiated: true }),
  }

  const cached = notModified(req, etag, headers)
  if (cached) return cached

  return new Response(html, { headers })
}
