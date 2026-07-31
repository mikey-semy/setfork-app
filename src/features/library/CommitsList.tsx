import { FileCode2, GitMerge } from 'lucide-react'
import type { GitCommit } from '@/core'
import Link from 'next/link'
import { Avatar } from '@/shared/ui/Avatar'
import { CopyButton } from '@/shared/ui/CopyButton'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Tooltip } from '@/shared/ui/Tooltip'
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
  diffBase,
  snapshotBase,
}: {
  commits: GitCommit[]
  /** handle по e-mail — подпись коммита не обязана совпадать с нашим аккаунтом. */
  authors: Record<string, CommitAuthor>
  lang: Lang
  labels: { count: string; empty: string; merge: string; diff: string; openAt: string }
  /** База ссылки на дифф коммита; без неё строки не кликабельны. */
  diffBase?: string
  /** База ссылки на СНИМОК списка (`?ref=sha`) — «открыть как обычный список». */
  snapshotBase?: string
}) {
  if (commits.length === 0) return <EmptyState variant="plain" hint={labels.empty} />

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="border-b border-border bg-surface-2 px-3.5 py-2 text-[0.78125rem] font-semibold text-ink-2">
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
                  {/* Заголовок ведёт в дифф ЭТОГО коммита: список коммитов без
                      возможности посмотреть, что в нём, отвечает только на
                      «сколько», но не на «что». */}
                  {diffBase ? (
                    <Link
                      href={`${diffBase}${diffBase.includes('?') ? '&' : '?'}commit=${c.sha}`}
                      className="min-w-0 flex-1 text-[0.8125rem] font-semibold text-ink hover:text-accent [overflow-wrap:anywhere]"
                      title={rest || labels.diff}
                    >
                      {title || '—'}
                    </Link>
                  ) : (
                    <span className="min-w-0 flex-1 text-[0.8125rem] font-semibold text-ink [overflow-wrap:anywhere]" title={rest || undefined}>
                      {title || '—'}
                    </span>
                  )}
                  {c.parents > 1 && (
                    <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full bg-accent/15 px-1.5 py-0.5 text-[0.6875rem] font-semibold text-accent">
                      <GitMerge size={11} /> {labels.merge}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.78125rem] text-muted">
                  <span className="font-medium text-ink-2">{user?.name || user?.handle || c.authorName || c.authorEmail}</span>
                  <span>·</span>
                  <span title={c.at.toLocaleString(lang)}>{timeAgo(c.at, lang)}</span>
                </div>
              </div>
              {/* Правый край строки: sha (им коммит называют в терминале, отсюда
                  и копируют) и вход в СНИМОК списка на этом коммите. Иконка с
                  тултипом, а не подпись: на мобиле текст сюда не влезает, а
                  тач-цель добирается padding'ом до полной. */}
              <span className="flex shrink-0 items-center gap-1.5 font-mono text-[0.78125rem] text-ink-2">
                {c.sha.slice(0, 7)}
                <CopyButton text={c.sha} />
                {snapshotBase && (
                  <Tooltip label={labels.openAt}>
                    <Link
                      href={`${snapshotBase}${snapshotBase.includes('?') ? '&' : '?'}ref=${c.sha}`}
                      aria-label={labels.openAt}
                      className="grid size-9 place-items-center rounded-md text-muted hover:text-ink"
                    >
                      <FileCode2 size={14} />
                    </Link>
                  </Tooltip>
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
