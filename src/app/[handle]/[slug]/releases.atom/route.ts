import { getListMeta } from '@/features/library/queries'
import { getReleases } from '@/features/releases/queries'

// GET /{handle}/{slug}/releases.atom — Atom-фид релизов (как у GitHub).
// Только для публичных списков: фид анонимный, приватное не отдаём.

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export async function GET(req: Request, { params }: { params: Promise<{ handle: string; slug: string }> }) {
  const { handle, slug } = await params
  const meta = await getListMeta(handle, slug)
  if (!meta || meta.visibility !== 'public') return new Response('Not found', { status: 404 })

  const origin = new URL(req.url).origin
  const base = `${origin}/${handle}/${slug}`
  const rels = await getReleases(meta.id)
  const updated = (rels[0]?.createdAt ?? new Date(0)).toISOString()

  const entries = rels
    .map(
      (r) => `  <entry>
    <id>tag:setfork.com,2026:${meta.id}/releases/${esc(r.tag)}</id>
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
  <id>tag:setfork.com,2026:${meta.id}/releases</id>
  <title>${esc(`${handle}/${slug}`)} — releases</title>
  <link rel="self" type="application/atom+xml" href="${base}/releases.atom"/>
  <link rel="alternate" type="text/html" href="${base}/releases"/>
  <updated>${updated}</updated>
${entries}
</feed>
`
  return new Response(xml, {
    headers: { 'content-type': 'application/atom+xml; charset=utf-8', 'cache-control': 'public, max-age=300' },
  })
}
