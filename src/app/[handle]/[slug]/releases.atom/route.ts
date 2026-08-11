// eslint-disable-next-line no-restricted-imports -- анонимный Atom-фид: гейт isPubliclyVisible (строже canViewList), не cookie-сессия
import { getListMeta } from '@/features/library/queries'
import { getReleases } from '@/features/releases/queries'
import { escapeHtml as esc } from '@/shared/lib/escape'
import { isPubliclyVisible } from '@/core'
import { SITE_ORIGIN } from '@/shared/site'

// GET /{handle}/{slug}/releases.atom — Atom-фид релизов (как у GitHub).
// Только для публичных списков: фид анонимный, приватное не отдаём.

// Авторитет tag: URI (RFC 4151) — ЕДИНСТВЕННОЕ место, где домен намеренно НЕ берётся
// из `shared/site.ts`. Это вечный идентификатор записи, а не адрес: смени его вместе с
// доменом — и читалки посчитают все прошлые релизы новыми и покажут их заново. Домен
// с датой здесь и означают «выдано этим сервисом тогда-то», даже если сервис переехал.
const TAG_AUTHORITY = 'setfork.com,2026'

export async function GET(req: Request, { params }: { params: Promise<{ handle: string; slug: string }> }) {
  const { handle, slug } = await params
  const meta = await getListMeta(handle, slug)
  // Публичный + опубликованный + не снят модерацией. Раньше проверялась только
  // видимость → release notes flagged/hidden/pending и публичных черновиков утекали.
  if (!meta || !isPubliclyVisible(meta)) return new Response('Not found', { status: 404 })

  // Публичный канонический адрес, а не bind-origin запроса (за прокси req.url = 0.0.0.0:3000).
  const origin = SITE_ORIGIN
  const base = `${origin}/${handle}/${slug}`
  const rels = await getReleases(meta.id)
  // Нет релизов → берём время списка (обновление/создание), НЕ эпоху 0: пустой фид
  // с <updated>1970-01-01</updated> невалиден по смыслу и путал ридеры (баг владельца).
  const updated = (rels[0]?.createdAt ?? meta.updatedAt ?? meta.createdAt ?? new Date()).toISOString()

  const entries = rels
    .map(
      (r) => `  <entry>
    <id>tag:${TAG_AUTHORITY}:${meta.id}/releases/${esc(r.tag)}</id>
    <title>${esc(r.title || r.tag)}</title>
    <link rel="alternate" type="text/html" href="${base}/releases"/>
    <updated>${r.createdAt.toISOString()}</updated>
    <author><name>${esc(r.authorHandle)}</name></author>
    <content type="text">${esc(r.notes)}</content>
  </entry>`,
    )
    .join('\n')

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>tag:${TAG_AUTHORITY}:${meta.id}/releases</id>
  <title>${esc(`${handle}/${slug}`)} — releases</title>
  <link rel="self" type="application/atom+xml" href="${base}/releases.atom"/>
  <link rel="alternate" type="text/html" href="${base}/releases"/>
  <updated>${updated}</updated>
${entries}
</feed>
`
  return new Response(xml, {
    // Короткий кэш: сокращает окно, в которое CDN отдаёт фид уже снятого модерацией списка.
    headers: { 'content-type': 'application/atom+xml; charset=utf-8', 'cache-control': 'public, max-age=60' },
  })
}
