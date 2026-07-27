import { GitMerge } from 'lucide-react'
import type { GitCommit } from '@/core'
import { Avatar } from '@/shared/ui/Avatar'
import { CopyButton } from '@/shared/ui/CopyButton'
import { timeAgo } from '@/shared/ui/timeAgo'
import type { Lang } from '@/shared/i18n'

/** Наш пользователь, опознанный по e-mail подписи коммита (может не найтись). */
export interface CommitAuthor {
  handle: string
  name: string | null
  avatarUrl: string | null
}

/**
 * Коммиты ветки правки — что именно она принесёт в main.
 *
 * Это git-коммиты, а не версии списка, поэтому строка не разворачивается в дифф
 * (у ветки нет спроецированных версий): «что изменилось» целиком живёт на вкладке
 * изменений, а здесь — история, авторство и sha. Строка коммита версии
 * (CommitRow на странице «Коммиты») сознательно не переиспользована: у неё
 * центральная сущность — номер версии, которого тут не существует.
 */
export function CommitsList({
  commits,
  authors,
  lang,
  labels,
}: {
  commits: GitCommit[]
  /** handle по e-mail — подпись коммита не обязана совпадать с нашим аккаунтом. */
  authors: Record<string, CommitAuthor>
  lang: Lang
  labels: { count: string; empty: string; merge: string }
}) {
  if (commits.length === 0) return <div className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-[13px] text-muted">{labels.empty}</div>

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="border-b border-border bg-surface-2 px-3.5 py-2 text-[12.5px] font-semibold text-ink-2">
        {labels.count}: {commits.length}
      </div>
      <ul className="flex flex-col divide-y divide-border">
        {commits.map((c) => {
          const user = authors[c.authorEmail.toLowerCase()]
          // Первая строка — заголовок коммита, остальное — тело (как у git).
          const [title, ...body] = c.message.split('\n')
          const rest = body.join('\n').trim()
          return (
            <li key={c.sha} className="flex items-start gap-2.5 px-3.5 py-2.5">
              {user ? (
                <Avatar handle={user.handle} avatarUrl={user.avatarUrl} size={22} />
              ) : (
                <Avatar handle={c.authorName || c.authorEmail} avatarUrl={null} size={22} />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-1.5">
                  <span className="min-w-0 flex-1 text-[13.5px] font-semibold text-ink [overflow-wrap:anywhere]" title={rest || undefined}>
                    {title || '—'}
                  </span>
                  {c.parents > 1 && (
                    <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full bg-accent/15 px-1.5 py-0.5 text-[10.5px] font-semibold text-accent">
                      <GitMerge size={11} /> {labels.merge}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
                  <span className="font-medium text-ink-2">{user?.name || user?.handle || c.authorName || c.authorEmail}</span>
                  <span>·</span>
                  <span title={c.at.toLocaleString(lang)}>{timeAgo(c.at, lang)}</span>
                </div>
              </div>
              {/* sha — то, чем коммит называют в терминале; отсюда его и копируют. */}
              <span className="flex shrink-0 items-center gap-1.5 font-mono text-[12px] text-ink-2">
                {c.sha.slice(0, 7)}
                <CopyButton text={c.sha} />
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
