'use client'

import { usePathname } from 'next/navigation'
import { BarChart3, CircleDot, GitPullRequest, ListChecks, MessagesSquare, Settings, Tag } from 'lucide-react'
import { TabItem, TabNav } from '@/shared/ui/TabNav'

type Tab = 'overview' | 'versions' | 'issues' | 'suggestions' | 'discussions' | 'insights' | 'settings'

// Активная вкладка вычисляется КЛИЕНТСКИ из pathname. Шапка списка живёт в
// персистентном layout ([handle]/[slug]/layout.tsx) и НЕ перемонтируется между
// вкладками, поэтому серверный `active`-проп не подходит: полоска должна переезжать
// сразу по клику, а не ждать серверный рендер новой страницы. Так меню списка
// перестаёт «моргать» (тот же приём подсветки-вкладки, что уже в профиле).
function activeFor(base: string, pathname: string): Tab {
  const rest = pathname.startsWith(base) ? pathname.slice(base.length).replace(/^\/+/, '').split('/')[0] : ''
  if (rest === 'issues' || rest === 'milestones') return 'issues'
  if (rest === 'suggestions') return 'suggestions'
  if (rest === 'discussions') return 'discussions'
  if (rest === 'versions' || rest === 'releases' || rest === 'compare') return 'versions'
  if (rest === 'insights') return 'insights'
  if (rest === 'settings') return 'settings'
  return 'overview' // сам список + blame/certificate/leaderboard подсвечивают «Список»
}

export interface ListTabLabels {
  list: string
  issues: string
  suggestions: string
  discussions: string
  versions: string
  insights: string
  settings: string
  /** Подписи стрелок листания ряда вкладок (узкий экран). */
  scrollPrev: string
  scrollNext: string
}

export function ListTabs({
  base,
  labels,
  counts,
  flags,
}: {
  base: string
  labels: ListTabLabels
  counts: { issues: number; suggestions: number; discussions: number }
  flags: { issues: boolean; discussions: boolean; owner: boolean }
}) {
  const pathname = usePathname()
  const active = activeFor(base, pathname)
  return (
    <TabNav scope="list" arrows={{ prev: labels.scrollPrev, next: labels.scrollNext }}>
      {/* Первый таб — сам список (как «Code» у GitHub-репо), не «Overview». */}
      <TabItem href={base} on={active === 'overview'} icon={<ListChecks size={15} />} label={labels.list} />
      {flags.issues && (
        <TabItem href={`${base}/issues`} on={active === 'issues'} icon={<CircleDot size={15} />} label={labels.issues} count={counts.issues} />
      )}
      <TabItem href={`${base}/suggestions`} on={active === 'suggestions'} icon={<GitPullRequest size={15} />} label={labels.suggestions} count={counts.suggestions} />
      {flags.discussions && (
        <TabItem href={`${base}/discussions`} on={active === 'discussions'} icon={<MessagesSquare size={15} />} label={labels.discussions} count={counts.discussions} />
      )}
      <TabItem href={`${base}/versions`} on={active === 'versions'} icon={<Tag size={15} />} label={labels.versions} />
      <TabItem href={`${base}/insights`} on={active === 'insights'} icon={<BarChart3 size={15} />} label={labels.insights} />
      {flags.owner && <TabItem href={`${base}/settings`} on={active === 'settings'} icon={<Settings size={15} />} label={labels.settings} />}
    </TabNav>
  )
}
