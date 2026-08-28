import { ImageResponse } from 'next/og'
import { and, eq, sql } from 'drizzle-orm'
import { db, publiclyVisible, steps, templates, templateVersions, users } from '@/shared/db'
import { tr } from '@/shared/i18n'
import { SITE_HOST } from '@/shared/site'

/**
 * Картинка списка для превью в мессенджерах и соцсетях.
 *
 * До неё на все страницы сайта уходила ОДНА статическая `/og-image.png`: ссылка
 * на конкретный список выглядела в чате как ссылка на сайт вообще, и отличить
 * два списка в ленте было нельзя.
 *
 * ⚠️ АДРЕС ЭТОЙ КАРТИНКИ ПУБЛИЧЕН И БЕЗ СЕССИИ. Поэтому содержимое достаётся
 * под тем же `publiclyVisible()`, что и карта сайта: у черновика, приватного
 * и снятого модерацией списка превью показывает нейтральную карточку, а не их
 * название. Иначе достаточно угадать адрес, чтобы прочитать заголовок чужого
 * черновика в превью.
 *
 * ⚠️ ШРИФТ. Движок картинок (Satori) принимает ttf/otf/woff и НЕ принимает woff2,
 * а в `src/shared/fonts` у нас лежат только woff2 — то есть подключить наш
 * Hanken Grotesk сюда напрямую нельзя. Проверено пробой 28.08: встроенный
 * в `@vercel/og` шрифт по умолчанию (Geist) рисует и латиницу, и кириллицу —
 * поэтому свой шрифт здесь не подключается вовсе. Если однажды понадобится
 * фирменное начертание, в репозиторий придётся положить ttf, а не woff2.
 */
export const alt = 'SetFork list'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const revalidate = 86400

const CANVAS = '#f4f4f1'
const SURFACE = '#ffffff'
const INK = '#1c1c1a'
const MUTED = '#6f6f68'
const ACCENT = '#2159d6'
const BORDER = '#e7e6e0'

export default async function Image({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const { handle, slug } = await params
  const list = await publicList(handle, slug)

  // Заголовок длиной в абзац не «уменьшается до влезания» — он обрезается: три
  // строки крупно читаются в ленте, пять строк мелко не читаются нигде.
  const title = list ? clamp(tr(list.title, 'en') || slug, 90) : 'Versioned, runnable lists'
  const subtitle = list ? clamp(tr(list.desc, 'en'), 120) : ''
  const fontSize = title.length > 60 ? 54 : title.length > 36 ? 64 : 76
  const tags = (list?.tags ?? []).slice(0, 4)

  return new ImageResponse(
    (
      <div style={{ display: 'flex', width: '100%', height: '100%', background: CANVAS, padding: 48 }}>
        <div
          style={{
            display: 'flex',
            width: '100%',
            height: '100%',
            background: SURFACE,
            border: `1px solid ${BORDER}`,
            borderRadius: 24,
            overflow: 'hidden',
          }}
        >
          {/* Полоса акцента — отдельной колонкой, а не рамкой: рамка со скруглением
              рисуется дугой и читается как случайная линия. */}
          <div style={{ display: 'flex', width: 14, height: '100%', background: ACCENT }} />

          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '48px 56px', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', fontSize: 26, color: MUTED }}>{list ? `${handle} / ${slug}` : SITE_HOST}</div>
              <div style={{ display: 'flex', marginTop: 26, fontSize, lineHeight: 1.12, color: INK, fontWeight: 700 }}>{title}</div>
              {subtitle ? (
                <div style={{ display: 'flex', marginTop: 22, fontSize: 30, lineHeight: 1.35, color: MUTED }}>{subtitle}</div>
              ) : null}
              {tags.length > 0 ? (
                <div style={{ display: 'flex', marginTop: 28, gap: 12 }}>
                  {tags.map((tag) => (
                    <div
                      key={tag}
                      style={{
                        display: 'flex',
                        fontSize: 24,
                        color: MUTED,
                        border: `1px solid ${BORDER}`,
                        borderRadius: 999,
                        padding: '8px 20px',
                      }}
                    >
                      {tag}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', gap: 28, fontSize: 26, color: MUTED }}>
                {list ? <div style={{ display: 'flex', color: INK }}>{list.ownerName || handle}</div> : null}
                {list ? <div style={{ display: 'flex' }}>{list.blocks} blocks</div> : null}
                {list ? <div style={{ display: 'flex' }}>v{list.currentVersion}</div> : null}
              </div>
              <div style={{ display: 'flex', fontSize: 26, color: ACCENT, fontWeight: 700 }}>SetFork</div>
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size },
  )
}

/** Список — только если он публичный: адрес картинки открыт всем. */
export async function publicList(handle: string, slug: string) {
  const [row] = await db
    .select({
      id: templates.id,
      title: templates.title,
      desc: templates.desc,
      currentVersion: templates.currentVersion,
      tags: templates.tags,
      ownerName: users.name,
    })
    .from(templates)
    .innerJoin(users, eq(templates.ownerId, users.id))
    .where(and(eq(users.handle, handle), eq(templates.slug, slug), publiclyVisible()))
    .limit(1)
  if (!row) return null

  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(steps)
    .innerJoin(templateVersions, eq(steps.versionId, templateVersions.id))
    .where(and(eq(templateVersions.templateId, row.id), eq(templateVersions.version, row.currentVersion)))

  return { ...row, blocks: count?.n ?? 0 }
}

/** Обрезка по границе слова: обрыв на середине слова читается как поломка. */
function clamp(text: string, max: number): string {
  const s = text.trim()
  if (s.length <= max) return s
  const cut = s.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}
