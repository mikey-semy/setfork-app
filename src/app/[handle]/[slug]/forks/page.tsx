import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, CornerDownRight, GitFork, Star } from 'lucide-react'
import { getLang } from '@/shared/i18n/server'
import { t, tr, type Lang } from '@/shared/i18n'
import { timeAgo } from '@/shared/ui/timeAgo'
import { PageHeader } from '@/shared/ui/PageHeader'
import { requireViewableMeta } from '@/features/library/guard'
import { getForkTree, type ForkNode } from '@/features/library/fork-tree'
import { PAGE } from '@/shared/ui/control'

/**
 * Дерево форков (HQ §11, Obsidian-вектор → «какие форки от какого списка
 * произошли, где активнее правят»): рекурсивный обход вниз от списка, отрисовка
 * отступами — практичное дерево вместо «линий ради линий». Свежесть правок
 * подсвечена: форк, правленный за последние 7 дней, — активная ветвь.
 *
 * Сам обход, политика видимости и границы работы живут в `features/library/fork-tree`:
 * страница знает параметры маршрута и то, как это показать, а не как обходить граф.
 */
export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('forksTitle', lang) }
}

/** Плоский порядок обхода: ветвь целиком, потом следующая — с глубиной для отступа. */
function flatten(nodes: ForkNode[], depth = 0): { node: ForkNode; depth: number }[] {
  return nodes.flatMap((node) => [{ node, depth }, ...flatten(node.children, depth + 1)])
}

export default async function ForksPage({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const [{ handle: owner, slug }, lang] = await Promise.all([params, getLang()])
  const meta = await requireViewableMeta(owner, slug)
  if (!meta) notFound()
  const tree = await getForkTree(meta.id)
  const rows = flatten(tree.roots)

  return (
    <div className={PAGE}>
      {/* Назад к списку — показываем title (как в шапке), а не технический slug. */}
      <Link href={`/${owner}/${slug}`} className="mb-4 inline-flex items-center gap-2 text-[0.8125rem] text-ink-2 hover:text-ink">
        <ArrowLeft size={15} /> {owner} / {tr(meta.title, lang)}
      </Link>
      <PageHeader icon={<GitFork size={17} />} title={t('list.forkTree', lang)} subtitle={t('list.whoGrewWhatFrom', lang)} />

      {rows.length === 0 ? (
        <p className="mt-8 text-[0.8125rem] text-muted">{t('list.noPublicForksYet', lang)}</p>
      ) : (
        <ul className="mt-5 flex flex-col gap-1.5">
          {rows.map(({ node, depth }) => (
            <ForkRow key={node.id} node={node} depth={depth} lang={lang} />
          ))}
        </ul>
      )}
    </div>
  )
}

function ForkRow({ node, depth, lang }: { node: ForkNode; depth: number; lang: Lang }) {
  // Свежесть посчитана моделью: в рендере часы читать нельзя (react-hooks/purity).
  const fresh = node.fresh
  return (
    <li style={{ paddingLeft: `${depth * 20}px` }} className="flex items-baseline gap-2 text-[0.8125rem]">
      {/* Иерархия форка (не дубль иконки заголовка «Дерево форков»). */}
      <span className={`self-center ${fresh ? 'text-accent' : 'text-muted'}`} aria-hidden>
        <CornerDownRight size={13} />
      </span>
      <Link href={`/${node.handle}/${node.slug}`} className="min-w-0 truncate font-medium text-ink hover:text-accent">
        {tr(node.title, lang) || `${node.handle}/${node.slug}`}
      </Link>
      <span className="shrink-0 text-[0.6875rem] text-muted">{node.handle}</span>
      {node.starsCount > 0 && (
        <span className="inline-flex shrink-0 items-center gap-0.5 text-[0.6875rem] text-muted">
          <Star size={10} /> {node.starsCount}
        </span>
      )}
      <span className={`ml-auto shrink-0 text-[0.6875rem] ${fresh ? 'font-medium text-accent' : 'text-muted'}`}>
        {timeAgo(node.updatedAt, lang)}
      </span>
    </li>
  )
}
