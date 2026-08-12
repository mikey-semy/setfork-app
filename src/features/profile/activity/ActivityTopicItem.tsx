import Link from 'next/link'
import { CircleDot, GitCommitHorizontal, GitPullRequest, Rocket, type LucideIcon } from 'lucide-react'
import { fill, plural, tr, type Lang } from '@/shared/i18n'
import type { ActivityKind, ActivityTopic } from './types'

// Одна тема ленты активности: кружок с иконкой на полоске таймлайна, сводка и —
// там, где есть что перечислить, — сами списки.

/** Иконка темы. Новый вид работы = строка здесь плюс ветка в Summary. */
const ICON: Record<ActivityKind, LucideIcon> = {
  versions: GitCommitHorizontal,
  lists: Rocket,
  issues: CircleDot,
  suggestions: GitPullRequest,
}

export function ActivityTopicItem({ topic, handle, lang }: { topic: ActivityTopic; handle: string; lang: Lang }) {
  const Icon = ICON[topic.kind]
  return (
    <li className="flex gap-3">
      {/* Кружок непрозрачный — он перекрывает полоску таймлайна, а не висит поверх. */}
      <span className="relative z-10 mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border border-border bg-surface-2 text-muted">
        <Icon size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[0.8125rem] font-medium text-ink">
          <Summary topic={topic} lang={lang} />
        </div>
        {topic.kind === 'versions' && (
          <ul className="mt-2 flex flex-col gap-1">
            {topic.lists.map((v) => (
              <li key={v.slug} className="flex items-center justify-between gap-3 text-[0.8125rem]">
                <Link href={`/${handle}/${v.slug}`} className="truncate text-accent hover:underline">
                  {tr(v.title, lang)}
                </Link>
                <span className="shrink-0 font-mono text-[0.6875rem] text-muted">
                  {v.count} {plural(v.count, 'versions', lang)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {topic.kind === 'lists' && (
          <ul className="mt-2 flex flex-col gap-1">
            {topic.lists.map((l) => (
              <li key={l.slug}>
                {/* Название списка пишет человек: слово без пробелов иначе уносит
                    страницу за край. Перенос, а не truncate — строка тут одна, места
                    под неё хватает, и обрезать название незачем. */}
                <Link href={`/${handle}/${l.slug}`} className="text-[0.8125rem] text-accent hover:underline [overflow-wrap:anywhere]">
                  {tr(l.title, lang)}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  )
}

/** Сводка темы одной строкой — счётчики со склонением по языку профиля. */
function Summary({ topic, lang }: { topic: ActivityTopic; lang: Lang }) {
  switch (topic.kind) {
    case 'versions':
      return (
        <>
          {fill('profile.activity.publishedVersions', lang, {
            n: topic.total,
            versions: plural(topic.total, 'versions', lang),
            m: topic.listsTotal,
            lists: plural(topic.listsTotal, 'listsIn', lang),
          })}
        </>
      )
    case 'lists':
      return <>{fill('profile.activity.createdLists', lang, { n: topic.total, lists: plural(topic.total, 'lists', lang) })}</>
    case 'issues':
      return (
        <>
          {fill('profile.activity.openedIssues', lang, {
            n: topic.total,
            issues: plural(topic.total, 'issues', lang),
            m: topic.listsTotal,
            lists: plural(topic.listsTotal, 'listsIn', lang),
          })}
        </>
      )
    case 'suggestions':
      return <>{fill('profile.activity.proposedSuggestions', lang, { n: topic.total, suggestions: plural(topic.total, 'suggestions', lang) })}</>
  }
}
