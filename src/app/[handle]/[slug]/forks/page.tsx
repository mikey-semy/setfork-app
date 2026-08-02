import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, CornerDownRight, GitFork, Star } from 'lucide-react'
import { sql } from 'drizzle-orm'
import { db } from '@/shared/db'
import { getLang } from '@/shared/i18n/server'
import { t, tr, type Lang, type LocaleText } from '@/shared/i18n'
import { timeAgo } from '@/shared/ui/timeAgo'
import { PageHeader } from '@/shared/ui/PageHeader'
import { requireViewableMeta } from '@/features/library/guard'
import { PAGE } from '@/shared/ui/control'

/**
 * Дерево форков (HQ §11, Obsidian-вектор → «какие форки от какого списка
 * произошли, где активнее правят»): рекурсивный CTE вниз от списка, отрисовка
 * отступами — практичное дерево вместо «линий ради линий». Свежесть правок
 * подсвечена: форк, правленный за последние 7 дней, — активная ветвь.
 */
export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('forksTitle', lang) }
}

interface ForkRow {
  id: string
  slug: string
  title: LocaleText
  handle: string
  stars_count: number
  updated_at: string
  level: number
}

async function forkTree(rootId: string): Promise<ForkRow[]> {
  // Только публичные активные ветви; глубина ≤ 6, размер ≤ 200 — предохранители.
  const res = await db.execute(sql`
    WITH RECURSIVE tree AS (
      SELECT t.id, t.slug, t.title, t.owner_id, t.stars_count, t.updated_at, 1 AS level
      FROM templates t
      WHERE t.forked_from_id = ${rootId}
        AND t.status = 'published' AND t.visibility = 'public' AND t.moderation = 'active'
      UNION ALL
      SELECT t.id, t.slug, t.title, t.owner_id, t.stars_count, t.updated_at, tree.level + 1
      FROM templates t
      JOIN tree ON t.forked_from_id = tree.id
      WHERE t.status = 'published' AND t.visibility = 'public' AND t.moderation = 'active'
        AND tree.level < 6
    )
    SELECT tree.id, tree.slug, tree.title, u.handle, tree.stars_count, tree.updated_at, tree.level
    FROM tree JOIN users u ON u.id = tree.owner_id
    ORDER BY tree.level, tree.updated_at DESC
    LIMIT 200
  `)
  return res.rows as unknown as ForkRow[]
}

export default async function ForksPage({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const [{ handle: owner, slug }, lang] = await Promise.all([params, getLang()])
  const meta = await requireViewableMeta(owner, slug)
  if (!meta) notFound()
  const rows = await forkTree(meta.id)
  const fresh = (iso: string) => Date.now() - new Date(iso).getTime() < 7 * 24 * 60 * 60 * 1000

  return (
    <div className={PAGE}>
      {/* Назад к списку — показываем title (как в шапке), а не технический slug. */}
      <Link href={`/${owner}/${slug}`} className="mb-4 inline-flex items-center gap-2 text-[0.8125rem] text-ink-2 hover:text-ink">
        <ArrowLeft size={15} /> {owner} / {tr(meta.title, lang)}
      </Link>
      <PageHeader
        icon={<GitFork size={17} />}
        title={t('list.forkTree', lang)}
        subtitle={t('list.whoGrewWhatFrom', lang)}
      />

      {rows.length === 0 ? (
        <p className="mt-8 text-[0.8125rem] text-muted">{t('list.noPublicForksYet', lang)}</p>
      ) : (
        <ul className="mt-5 flex flex-col gap-1.5">
          {rows.map((r) => (
            <li key={r.id} style={{ paddingLeft: `${(r.level - 1) * 20}px` }} className="flex items-baseline gap-2 text-[0.8125rem]">
              {/* Иерархия форка (не дубль иконки заголовка «Дерево форков»). */}
              <span className={`self-center ${fresh(r.updated_at) ? 'text-accent' : 'text-muted'}`} aria-hidden>
                <CornerDownRight size={13} />
              </span>
              <Link href={`/${r.handle}/${r.slug}`} className="min-w-0 truncate font-medium text-ink hover:text-accent">
                {tr(r.title, lang) || `${r.handle}/${r.slug}`}
              </Link>
              <span className="shrink-0 text-[0.6875rem] text-muted">{r.handle}</span>
              {r.stars_count > 0 && (
                <span className="inline-flex shrink-0 items-center gap-0.5 text-[0.6875rem] text-muted">
                  <Star size={10} /> {r.stars_count}
                </span>
              )}
              <span className={`ml-auto shrink-0 text-[0.6875rem] ${fresh(r.updated_at) ? 'font-medium text-accent' : 'text-muted'}`}>
                {timeAgo(new Date(r.updated_at), lang)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
