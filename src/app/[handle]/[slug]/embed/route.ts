import { getLang } from '@/shared/i18n/server'
import { t, type Lang } from '@/shared/i18n'
// eslint-disable-next-line no-restricted-imports -- анонимный embed на внешние сайты: гейт isPubliclyVisible, не cookie-сессия
import { getTemplateDetail } from '@/features/library/queries'
import { isPubliclyVisible } from '@/core'
import { embedHtml, toExportList } from '@/features/library/export'

// GET /{handle}/{slug}/embed — самодостаточный HTML списка для вставки в <iframe>.
// Только публичные опубликованные списки (embed идёт на внешние сайты).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const notFoundHtml = (lang: Lang) =>
  new Response(
    `<!doctype html><html lang="${lang}"><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#faf9f7;color:#6b6b66;font:14px ui-sans-serif,system-ui,sans-serif">${t('embedNotFound', lang)}</body></html>`,
    { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )

export async function GET(req: Request, { params }: { params: Promise<{ handle: string; slug: string }> }) {
  const { handle, slug } = await params
  const [lang, detail] = await Promise.all([getLang(), getTemplateDetail(handle, slug)])
  if (!detail) return notFoundHtml(lang)

  const { tpl, currentVersion, steps } = detail
  if (!isPubliclyVisible(tpl)) return notFoundHtml(lang)

  const list = toExportList(detail)

  const origin = new URL(req.url).origin
  const html = embedHtml(list, lang, `${origin}/${handle}/${slug}`)

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Короткий кэш: сокращает окно, в которое CDN отдаёт embed уже снятого модерацией списка.
      'Cache-Control': 'public, max-age=60',
      'Content-Security-Policy': 'frame-ancestors *', // разрешаем вставку на любые сайты
    },
  })
}
