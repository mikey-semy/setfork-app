import { Fragment } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { GitBranch, GitCommitHorizontal, GitCompare } from 'lucide-react'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { Avatar } from '@/shared/ui/Avatar'
import { timeAgo } from '@/shared/ui/timeAgo'
import { requireViewableMeta } from '@/features/library/guard'
import { getCommits } from '@/features/library/queries'
import { gitCore } from '@/features/git/core'

export async function generateMetadata({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const { handle, slug } = await params
  return { title: `Commits · ${handle}/${slug}` }
}

// «Коммиты» списка (как история коммитов GitHub): версии сгруппированы по дате,
// строка = сообщение + автор (аватар/ник) + когда. Читаем прямым Postgres-запросом
// (getCommits), в обход домен-порта — независимо от Rust-read-пути.
export default async function CommitsPage({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const [{ handle: owner, slug }, lang] = await Promise.all([params, getLang()])
  const meta = await requireViewableMeta(owner, slug)
  if (!meta) notFound()
  const [commits, branches] = await Promise.all([
    getCommits(meta.id),
    gitCore.listBranches({ owner, slug }).catch(() => [] as { name: string }[]),
  ])
  const base = `/${owner}/${slug}`
  const branchCount = Math.max(1, branches.length) // как минимум main

  // Группировка по локальному дню (коммиты уже по убыванию версии).
  const dayFmt = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', year: 'numeric' })
  const groups: { day: string; items: typeof commits }[] = []
  for (const c of commits) {
    const day = dayFmt.format(new Date(c.createdAt))
    const last = groups[groups.length - 1]
    if (last && last.day === day) last.items.push(c)
    else groups.push({ day, items: [c] })
  }

  return (
    <div className="mx-auto w-full max-w-[900px] px-4 py-6">
      {/* Шапка: ветка + счётчики коммитов/веток + сравнение (как у GitHub Commits). */}
      <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
        <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 font-semibold text-ink">
          <GitBranch size={14} className="text-muted" /> main
        </span>
        <span className="text-ink-2">
          <b className="text-ink">{commits.length}</b> {t('commitsLabel', lang)}
        </span>
        <span className="inline-flex items-center gap-1 text-ink-2">
          <GitBranch size={13} className="text-muted" /> <b className="text-ink">{branchCount}</b> {t('branchesLabel', lang)}
        </span>
        {meta.currentVersion > 1 && (
          <Link href={`${base}/compare`} className="ml-auto inline-flex items-center gap-1.5 text-ink-2 hover:text-accent">
            <GitCompare size={14} /> {t('compareTitle', lang)}
          </Link>
        )}
      </div>

      {groups.map((g) => (
        <Fragment key={g.day}>
          {/* Заголовок-дата группы. */}
          <div className="mb-2 mt-4 flex items-center gap-2 text-[12.5px] font-medium text-ink-2 first:mt-0">
            <GitCommitHorizontal size={15} className="text-muted" /> {t('versionsTab', lang)} · {g.day}
          </div>
          {/* Ветвь-линия слева, как в GitHub. */}
          <div className="ml-2 flex flex-col gap-2 border-l border-border pl-4">
            {g.items.map((c) => {
              const msg = c.note && !['seeded', 'initial', 'edit', 'ai draft'].includes(c.note) ? c.note : t('noCommitMessage', lang)
              return (
                <div key={c.id} className="rounded-lg border border-border bg-surface px-4 py-3">
                  {/* Строка 1 — сообщение + версия-тег. */}
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">{msg}</span>
                    <span className="shrink-0 rounded border border-(--accent)/50 bg-(--accent-soft) px-1.5 font-mono text-[11px] text-accent">v{c.version}</span>
                    {c.version === meta.currentVersion && (
                      <span className="shrink-0 rounded-full bg-ok/15 px-1.5 py-0.5 text-[10px] font-semibold text-ok">{t('currentVersion', lang)}</span>
                    )}
                  </div>
                  {/* Строка 2 — кто и когда (аватар + ник + время). */}
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
                    {c.author ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Avatar handle={c.author.handle} avatarUrl={c.author.avatarUrl} size={18} />
                        <Link href={`/${c.author.handle}`} className="font-medium text-ink-2 hover:text-accent">
                          {c.author.name || c.author.handle}
                        </Link>
                      </span>
                    ) : (
                      <span>{t('authorNotRecorded', lang)}</span>
                    )}
                    <span>·</span>
                    <span>{timeAgo(new Date(c.createdAt), lang)}</span>
                    {c.version > 1 && (
                      <Link href={`${base}/compare?from=${c.version - 1}&to=${c.version}`} className="ml-auto inline-flex items-center gap-1 hover:text-accent">
                        <GitCompare size={12} /> {t('compareVersions', lang)} v{c.version - 1}
                      </Link>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </Fragment>
      ))}
    </div>
  )
}
