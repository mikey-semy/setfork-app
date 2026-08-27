'use client'

import { CircleDot, GitCommitHorizontal, GitPullRequest, Rocket, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { fill, plural, type Lang } from '@/shared/i18n'
import { DisclosureToggle } from '@/shared/ui/DisclosureToggle'
import { fmtNumber } from '@/shared/lib/count'
import { TopicLists } from './TopicDetails'
import type { ActivityKind, ActivityTopic } from './types'

// Одна тема ленты активности: кружок с иконкой на полоске таймлайна, сводка —
// и раскрытие вглубь, к спискам и самим событиям.

/** Иконка темы. Новый вид работы = строка здесь плюс ветка в Summary. */
const ICON: Record<ActivityKind, LucideIcon> = {
  versions: GitCommitHorizontal,
  lists: Rocket,
  issues: CircleDot,
  suggestions: GitPullRequest,
}

export function ActivityTopicItem({
  topic,
  handle,
  windowKey,
  lang,
}: {
  topic: ActivityTopic
  handle: string
  /** Окно ленты (`YYYY-MM` или `YYYY-MM-DD`) — с ним идут запросы деталей. */
  windowKey: string
  lang: Lang
}) {
  const Icon = ICON[topic.kind]
  // Раскрытием владеет тема; перечень списков грузится, когда блок смонтирован.
  const [open, setOpen] = useState(false)

  return (
    <li className="flex gap-3">
      {/* Кружок непрозрачный — он перекрывает полоску таймлайна, а не висит поверх. */}
      <span className="relative z-10 mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border border-border bg-surface-2 text-muted">
        <Icon size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <DisclosureToggle open={open} onToggle={() => setOpen((was) => !was)} label={summaryText(topic, lang)}>
          <span className="min-w-0 flex-1 text-body font-medium text-ink">{summaryText(topic, lang)}</span>
        </DisclosureToggle>
        {open && <TopicLists handle={handle} kind={topic.kind} windowKey={windowKey} lang={lang} />}
      </div>
    </li>
  )
}

/** Сводка темы одной строкой — счётчики со склонением по языку профиля. */
function summaryText(topic: ActivityTopic, lang: Lang): string {
  const n = fmtNumber(topic.total, lang)
  switch (topic.kind) {
    case 'versions':
      return fill('profile.activity.publishedVersions', lang, {
        n,
        versions: plural(topic.total, 'versions', lang),
        m: fmtNumber(topic.listsTotal, lang),
        lists: plural(topic.listsTotal, 'listsIn', lang),
      })
    case 'lists':
      return fill('profile.activity.createdLists', lang, { n, lists: plural(topic.total, 'lists', lang) })
    case 'issues':
      return fill('profile.activity.openedIssues', lang, {
        n,
        issues: plural(topic.total, 'issues', lang),
        m: fmtNumber(topic.listsTotal, lang),
        lists: plural(topic.listsTotal, 'listsIn', lang),
      })
    case 'suggestions':
      return fill('profile.activity.proposedSuggestions', lang, { n, suggestions: plural(topic.total, 'suggestions', lang) })
  }
}
