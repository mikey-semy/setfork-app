import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CornerDownRight, GitFork, Star } from 'lucide-react'
import { getLang } from '@/shared/i18n/server'
import { t, tr, type Lang } from '@/shared/i18n'
import { timeAgo } from '@/shared/ui/timeAgo'
import { PageHeader } from '@/shared/ui/PageHeader'
import { BackLink } from '@/shared/ui/BackLink'
import { EmptyState } from '@/shared/ui/EmptyState'
import { requireViewableMeta } from '@/features/library/guard'
import { getForkTree, type ForkNode } from '@/features/library/fork-tree'
import { PAGE } from '@/shared/ui/control'

/**
 * Дерево форков (HQ §11, Obsidian-вектор → «какие форки от какого списка произошли, где
 * активнее правят»). Свежесть правок подсвечена: ветвь, правленная за последнюю неделю, —
 * активная.
 *
 * Обход, политика видимости и границы работы живут в `features/library/fork-tree`:
 * страница знает параметры маршрута и то, как это показать, а не как обходить граф.
 *
 * Дерево рисуется ВЛОЖЕННЫМИ списками, а не плоским с отступом по уровню: заголовок
 * обещает дерево, и оно должно существовать не только в пикселях, но и в разметке —
 * иначе экранный диктор читает равноправную кучу строк (карточка ревью forks/002).
 */
export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('forksTitle', lang) }
}

export default async function ForksPage({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const [{ handle: owner, slug }, lang] = await Promise.all([params, getLang()])
  const meta = await requireViewableMeta(owner, slug)
  if (!meta) notFound()
  const tree = await getForkTree(meta.id)
  const truncated = tree.truncated.depth || tree.truncated.width || tree.truncated.nodes

  return (
    <div className={PAGE}>
      <BackLink href={`/${owner}/${slug}`} label={`${owner} / ${tr(meta.title, lang)}`} className="mb-1" />
      <PageHeader icon={<GitFork size={17} />} title={t('list.forkTree', lang)} subtitle={t('list.whoGrewWhatFrom', lang)} />

      {tree.roots.length === 0 ? (
        <EmptyState className="mt-6" icon={<GitFork size={20} />} hint={t('list.noPublicForksYet', lang)} />
      ) : (
        <>
          <ForkBranches nodes={tree.roots} lang={lang} className="mt-5" />
          {/* Усечение видно человеку: раньше дерево молча обрывалось, и неполная
              родословная выглядела полной (forks/004). */}
          {truncated && <p className="mt-4 text-caption-lg text-muted">{t('list.forkTreeTruncated', lang)}</p>}
        </>
      )}
    </div>
  )
}

/** Ветви одного уровня. Вложенность списков — это и есть дерево для диктора и для глаза. */
function ForkBranches({ nodes, lang, className }: { nodes: ForkNode[]; lang: Lang; className?: string }) {
  return (
    <ul className={className}>
      {nodes.map((node) => (
        <li key={node.id} className="min-w-0">
          <ForkRow node={node} lang={lang} />
          {node.children.length > 0 && (
            // Ступень 16px (8 + 8 у линии) вместо прежних 20: на экране 360px шесть
            // ступеней по 20px съедали треть ширины, и названия обрезались раньше времени.
            <ForkBranches nodes={node.children} lang={lang} className="ml-2 border-l border-border pl-2" />
          )}
        </li>
      ))}
    </ul>
  )
}

function ForkRow({ node, lang }: { node: ForkNode; lang: Lang }) {
  // Свежесть посчитана моделью: в рендере часы читать нельзя (react-hooks/purity).
  const accent = node.fresh ? 'text-accent' : 'text-muted'
  return (
    <div className="flex min-h-11 min-w-0 items-center gap-2 text-body">
      {/* Иерархия форка (не дубль иконки заголовка «Дерево форков»). */}
      <span className={`shrink-0 ${accent}`} aria-hidden>
        <CornerDownRight size={13} />
      </span>
      <Link href={`/${node.handle}/${node.slug}`} className="min-w-0 truncate font-medium text-ink hover:text-accent">
        {tr(node.title, lang) || `${node.handle}/${node.slug}`}
      </Link>
      {/* Второстепенное на узком экране прячем: ник и звёзды не стоят того, чтобы из-за
          них обрезалось название списка. */}
      <span className="hidden shrink-0 text-caption text-muted sm:inline">{node.handle}</span>
      {node.starsCount > 0 && (
        <span className="hidden shrink-0 items-center gap-0.5 text-caption text-muted sm:inline-flex">
          <Star size={10} /> {node.starsCount}
        </span>
      )}
      <span className={`ml-auto shrink-0 text-caption ${node.fresh ? 'font-medium text-accent' : 'text-muted'}`}>
        {timeAgo(node.updatedAt, lang)}
      </span>
    </div>
  )
}
