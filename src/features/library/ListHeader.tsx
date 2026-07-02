import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, BadgeCheck, CircleDot, GitFork, GitPullRequest, ListChecks, Lock, Pencil, PlayCircle, Settings, Star, Tag } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { isAdminHandle } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { Avatar } from '@/shared/ui/Avatar'
import { forkTemplate } from '@/features/library/actions'
import { startRun } from '@/features/runs/actions'
import { StarButton } from '@/features/library/StarButton'
import { ShareButton } from '@/features/library/ShareButton'
import { WatchButton } from '@/features/watch/WatchButton'
import { getListMeta, getOpenSuggestionCount, isStarred } from '@/features/library/queries'
import { getOpenIssueCount } from '@/features/issues/queries'
import { getWatchCount, isWatching } from '@/features/watch/queries'

type Tab = 'overview' | 'versions' | 'issues' | 'suggestions' | 'settings'

/** Общая шапка страницы списка (= «репозиторий»): back, owner/name, действия, вкладки. */
export async function ListHeader({ owner, slug, active }: { owner: string; slug: string; active: Tab }) {
  const [lang, session] = await Promise.all([getLang(), getSession()])
  const meta = await getListMeta(owner, slug)
  if (!meta) return null
  const isOwner = session?.userId === meta.ownerId
  const isAdmin = isAdminHandle(session?.handle)
  if (meta.visibility === 'private' && !isOwner) notFound() // приватный — только владельцу
  if (meta.moderation !== 'active' && !isOwner && !isAdmin) notFound() // flagged/hidden не публичны
  const starred = session ? await isStarred(meta.id, session.userId) : false
  const watching = session ? await isWatching(session.userId, meta.id) : false
  const [suggCount, issueCount, watchCount] = await Promise.all([
    getOpenSuggestionCount(meta.id),
    getOpenIssueCount(meta.id),
    getWatchCount(meta.id),
  ])
  const base = `/${owner}/${slug}`
  const forkBound = forkTemplate.bind(null, meta.id)

  const tab = (key: Tab, href: string, icon: React.ReactNode, label: string, count?: number) => (
    <Link
      href={href}
      className={`inline-flex items-center gap-1.5 pb-2.5 ${
        active === key ? 'border-b-2 border-ink text-ink' : 'text-ink-2 hover:text-ink'
      }`}
    >
      {icon} {label}
      {count != null && count > 0 && (
        <span className="rounded-full bg-surface-2 px-1.5 text-[11px] text-ink-2">{count}</span>
      )}
    </Link>
  )

  return (
    <div className="border-b border-border">
      <div className="mx-auto w-full max-w-[1180px] px-4 pt-6">
        <Link href="/explore" className="mb-4 inline-flex items-center gap-2 text-[13px] text-ink-2 hover:text-ink">
          <ArrowLeft size={15} /> {t('backToExplore', lang)}
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Link href={`/${meta.ownerHandle}`} className="flex-shrink-0">
              <Avatar handle={meta.ownerHandle} avatarUrl={meta.ownerAvatarUrl} size={26} />
            </Link>
            <h1 className="text-[19px] font-bold">
              <Link href={`/${meta.ownerHandle}`} className="text-ink-2 hover:text-accent">
                {meta.ownerHandle}
              </Link>
              <span className="text-ink-2">/</span>
              <span className="text-ink">{meta.slug}</span>
            </h1>
            <span className="rounded-md border border-[var(--accent)] bg-[var(--accent-soft)] px-2 py-0.5 font-mono text-[11px] text-accent">
              v{meta.currentVersion}
            </span>
            {meta.visibility === 'private' && (
              <span className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-0.5 text-[11px] text-ink-2">
                <Lock size={11} /> {t('privateLabel', lang)}
              </span>
            )}
            {meta.verified && (
              <span className="inline-flex items-center gap-1 rounded-md border border-ok/40 bg-ok/10 px-2 py-0.5 text-[11px] font-medium text-ok">
                <BadgeCheck size={12} /> {t('verifiedLabel', lang)}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {session && active === 'overview' && (
              <form action={startRun.bind(null, meta.id)}>
                <button className="inline-flex items-center gap-2 rounded-md bg-primary px-3.5 py-1.5 text-[13px] font-semibold text-primary-fg">
                  <PlayCircle size={15} /> {t('runStart', lang)}
                </button>
              </form>
            )}
            {session && (
              <WatchButton
                templateId={meta.id}
                watching={watching}
                count={watchCount}
                watchLabel={t('watch', lang)}
                unwatchLabel={t('unwatch', lang)}
              />
            )}
            {session ? (
              <StarButton templateId={meta.id} starred={starred} count={meta.starsCount} label={t('star', lang)} />
            ) : (
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[13px] font-semibold text-ink hover:border-border-strong"
              >
                <Star size={14} /> {t('star', lang)} <span className="font-mono text-[12px] text-muted">{meta.starsCount}</span>
              </Link>
            )}
            <form action={forkBound}>
              <button className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[13px] font-semibold text-ink hover:border-border-strong">
                <GitFork size={14} /> {t('fork', lang)}{' '}
                <span className="font-mono text-[12px] text-muted">{meta.forksCount}</span>
              </button>
            </form>
            <ShareButton
              path={base}
              title={meta.slug}
              label={t('share', lang)}
              copiedLabel={t('copied', lang)}
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[13px] font-semibold text-ink hover:border-border-strong"
            />
            {isOwner ? (
              <Link
                href={`${base}/edit`}
                className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[13px] font-semibold text-ink hover:border-border-strong"
              >
                <Pencil size={14} /> {t('edit', lang)}
              </Link>
            ) : (
              <Link
                href={`${base}/suggest`}
                className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[13px] font-semibold text-ink hover:border-border-strong"
              >
                <Pencil size={14} /> {t('suggestEdit', lang)}
              </Link>
            )}
          </div>
        </div>

        <nav className="mt-3 flex gap-5 text-[14px] font-semibold">
          {tab('overview', base, <ListChecks size={15} />, t('overviewTab', lang))}
          {tab('versions', `${base}/versions`, <Tag size={15} />, t('versionsTab', lang))}
          {tab('issues', `${base}/issues`, <CircleDot size={15} />, t('issuesTab', lang), issueCount)}
          {tab('suggestions', `${base}/suggestions`, <GitPullRequest size={15} />, t('suggestions', lang), suggCount)}
          {isOwner && tab('settings', `${base}/settings`, <Settings size={15} />, t('settings', lang))}
        </nav>

        {meta.moderation !== 'active' && (isOwner || isAdmin) && (
          <div
            className={`mt-3 rounded-md border px-3 py-2 text-[12.5px] ${
              meta.moderation === 'hidden'
                ? 'border-danger/40 bg-danger/10 text-danger'
                : 'border-warn/40 bg-warn/10 text-warn'
            }`}
          >
            {meta.moderation === 'hidden' ? t('hiddenNotice', lang) : t('flaggedNotice', lang)}
            {meta.moderationReason && ` — ${meta.moderationReason}`}
          </div>
        )}
      </div>
    </div>
  )
}
