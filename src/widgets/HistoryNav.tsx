import Link from 'next/link'
import { GitCommitHorizontal, GitCompare, Tag } from 'lucide-react'
import { CONTROL_H } from '@/shared/ui/control'
import { cardClass } from '@/shared/ui/card-style'

// Под-навигация раздела истории: Коммиты / Релизы / Сравнение — три страницы
// одного раздела (как Repository → Commits/Tags/Compare в GitLab). Главный таб-бар
// не раздуваем: восьмая вкладка на мобиле только ухудшает ряд, а без под-навигации
// на «Релизах» подсвечивались «Коммиты» — и было непонятно, где ты находишься.
export type HistorySection = 'commits' | 'releases' | 'compare'

export interface HistoryNavLabels {
  commits: string
  releases: string
  compare: string
}

export function HistoryNav({
  base,
  active,
  labels,
  canCompare,
}: {
  base: string
  active: HistorySection
  labels: HistoryNavLabels
  /** Сравнивать нечего при одной версии — пункт не показываем. */
  canCompare: boolean
}) {
  const item = (href: string, on: boolean, icon: React.ReactNode, label: string) => (
    <Link
      href={href}
      aria-current={on ? 'page' : undefined}
      className={`inline-flex ${CONTROL_H.md} shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-[0.78125rem] font-medium ${
        on ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:text-ink'
      }`}
    >
      <span className={on ? 'text-ink' : 'text-muted'}>{icon}</span>
      {label}
    </Link>
  )
  return (
    // Ряд листается в СВОЁМ контейнере (страница горизонтально не едет).
    <div className={cardClass({ pad: 'xs', className: 'no-scrollbar mb-4 flex gap-1 overflow-x-auto' })}>
      {item(`${base}/versions`, active === 'commits', <GitCommitHorizontal size={14} />, labels.commits)}
      {item(`${base}/releases`, active === 'releases', <Tag size={14} />, labels.releases)}
      {canCompare && item(`${base}/compare`, active === 'compare', <GitCompare size={14} />, labels.compare)}
    </div>
  )
}
