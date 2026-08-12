'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronRight, Eye, GitCompare, Loader2 } from 'lucide-react'
import { Avatar } from '@/shared/ui/Avatar'
import { DiffStat } from '@/shared/ui/DiffStat'
import { timeAgo } from '@/shared/ui/timeAgo'
import type { Lang } from '@/shared/i18n'
import { getCommitDiff, type CommitDiff } from './commit-diff'
import { Tooltip } from '@/shared/ui/Tooltip'

const STATUS = {
  added: { sign: '+', cls: 'text-ok' },
  removed: { sign: '−', cls: 'text-danger' },
  changed: { sign: '~', cls: 'text-warn' },
  moved: { sign: '⇅', cls: 'text-accent' },
} as const

interface Author {
  handle: string
  name: string | null
  avatarUrl: string | null
}
interface Labels {
  current: string
  authorNotRecorded: string
  loading: string
  noChanges: string
  fullCompare: string
  viewVersion: string
  expandHint: string
}

/**
 * Строка коммита на странице «Коммиты» с аккордеоном: тап по строке разворачивает
 * ЧТО изменилось в этой версии против предыдущей (дифф пунктов, серверный экшен —
 * тап работает и на мобиле, в отличие от ховера). Точное время — в title (ховер).
 */
export function CommitRow({
  owner,
  slug,
  base,
  version,
  msg,
  createdAtMs,
  isCurrent,
  author,
  lang,
  labels,
}: {
  owner: string
  slug: string
  base: string
  version: number
  msg: string
  createdAtMs: number
  isCurrent: boolean
  author: Author | null
  lang: Lang
  labels: Labels
}) {
  const [open, setOpen] = useState(false)
  // Ссылка «v6» из строки коммита в шапке ведёт сюда якорем: строка не только
  // подсвечивается прокруткой, но и сразу раскрывает свой дифф — иначе переход по
  // номеру версии приводил бы «куда-то в список», а не к этому коммиту.
  useEffect(() => {
    if (window.location.hash === `#v${version}`) void toggle()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- один раз на монтировании
  }, [])
  // Загрузка диффа держится ОДНИМ состоянием вместе с номером запроса: флаг
  // снимался только после успеха, и сорвавшийся запрос оставлял разворот вечно
  // «загружающимся», а ответ прежнего открытия мог погасить спиннер нового.
  const [state, setState] = useState<{ req: number; loading: boolean; diff: CommitDiff | null }>({ req: 0, loading: false, diff: null })
  const { loading, diff } = state
  const createdAt = new Date(createdAtMs)

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (!next || diff || loading) return

    const req = state.req + 1
    setState((s) => ({ ...s, req, loading: true }))
    const got = await getCommitDiff(owner, slug, version, lang).catch(() => null)
    // Ответ применяет только СВОЙ запрос: чужой уже не владеет этим состоянием.
    setState((s) => (s.req !== req ? s : { ...s, loading: false, diff: got ?? s.diff }))
  }

  return (
    <div id={`v${version}`} className="relative scroll-mt-24 rounded-lg border border-border bg-surface transition-colors hover:border-border-strong">
      {/* Узел-точка на ветви (акцент — текущая версия). */}
      <span aria-hidden className={`absolute -left-5 top-[1.3125rem] size-2 rounded-full ${isCurrent ? 'bg-accent' : 'bg-muted'}`} />
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        title={labels.expandHint}
        className="flex w-full items-start gap-2 px-4 py-3 text-left"
      >
        <ChevronRight size={15} className={`mt-0.5 shrink-0 text-muted transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="min-w-0 flex-1">
          {/* Строка 1 — сообщение + версия-тег. */}
          <span className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[0.875rem] font-semibold text-ink">{msg}</span>
            <span className="shrink-0 rounded-md border border-(--accent)/50 bg-(--accent-soft) px-1.5 font-mono text-[0.6875rem] text-accent">v{version}</span>
            {isCurrent && <span className="shrink-0 rounded-full bg-ok/15 px-1.5 py-0.5 text-[0.6875rem] font-semibold text-ok">{labels.current}</span>}
          </span>
          {/* Строка 2 — кто и когда. */}
          <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.78125rem] text-muted">
            {author ? (
              <span className="inline-flex items-center gap-1.5">
                <Avatar handle={author.handle} avatarUrl={author.avatarUrl} size={18} />
                <span className="font-medium text-ink-2">{author.name || author.handle}</span>
              </span>
            ) : (
              <span>{labels.authorNotRecorded}</span>
            )}
            <span>·</span>
            <Tooltip label={createdAt.toLocaleString(lang)}>
              <span>{timeAgo(createdAt, lang)}</span>
            </Tooltip>
          </span>
        </span>
      </button>

      {open && (
        <div className="border-t border-border px-4 py-3 pl-11">
          {loading ? (
            <div className="flex items-center gap-2 text-[0.78125rem] text-muted">
              <Loader2 size={13} className="animate-spin" /> {labels.loading}
            </div>
          ) : !diff || diff.entries.length === 0 ? (
            <div className="text-[0.78125rem] text-muted">{labels.noChanges}</div>
          ) : (
            <>
              <DiffStat counts={diff.counts} squares className="mb-2" />
              <ul className="flex flex-col gap-1 text-[0.8125rem]">
                {diff.entries.map((e, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className={`shrink-0 font-mono ${STATUS[e.status].cls}`}>{STATUS[e.status].sign}</span>
                    <span className={`min-w-0 [overflow-wrap:anywhere] ${e.status === 'removed' ? 'text-muted line-through' : 'text-ink-2'}`}>{e.title}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                {version > 1 && (
                  <Link
                    href={`${base}/compare?from=${version - 1}&to=${version}`}
                    className="inline-flex items-center gap-1 py-1 text-[0.78125rem] text-accent hover:underline"
                  >
                    <GitCompare size={12} /> {labels.fullCompare}
                  </Link>
                )}
                {/* Просмотр самой версии целиком — не только «что изменилось». */}
                <Link
                  href={isCurrent ? base : `${base}?v=${version}`}
                  className="inline-flex items-center gap-1 py-1 text-[0.78125rem] text-accent hover:underline"
                >
                  <Eye size={12} /> {labels.viewVersion}
                </Link>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
