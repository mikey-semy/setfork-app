import Link from 'next/link'
import { notFound } from 'next/navigation'
import { BadgeCheck, CircleDot, GitFork, GitPullRequest, Globe, ListChecks, Lock, Pencil, PlayCircle, Settings, Star, Tag } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { isAdminHandle } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { t, tr } from '@/shared/i18n'
import { Avatar } from '@/shared/ui/Avatar'
import { forkTemplate } from '@/features/library/actions'
import { startRun } from '@/features/runs/actions'
import { StarButton } from '@/features/library/StarButton'
import { StarFolderMenu } from '@/features/star-folders/StarFolderMenu'
import { getFoldersForTemplate, getUserFolders } from '@/features/star-folders/queries'
import { ShareButton } from '@/features/library/ShareButton'
import { WatchButton } from '@/features/watch/WatchButton'
import { CloneDropdown } from '@/features/git/CloneDropdown'
import { getListMeta, getOpenSuggestionCount, isStarred } from '@/features/library/queries'
import { getOpenIssueCount } from '@/features/issues/queries'
import { getWatchCount, isWatching } from '@/features/watch/queries'
import { isCollaborator } from '@/features/collab/queries'

type Tab = 'overview' | 'versions' | 'issues' | 'suggestions' | 'settings'

/** Общая шапка страницы списка (= «репозиторий»): back, owner/name, действия, вкладки. */
export async function ListHeader({ owner, slug, active }: { owner: string; slug: string; active: Tab }) {
  const [lang, session] = await Promise.all([getLang(), getSession()])
  const meta = await getListMeta(owner, slug)
  if (!meta) return null
  const isOwner = session?.userId === meta.ownerId
  const canWrite = isOwner || (session ? await isCollaborator(meta.id, session.userId) : false)
  const isAdmin = isAdminHandle(session?.handle)
  if (meta.visibility === 'private' && !isOwner) notFound() // приватный — только владельцу
  if (meta.moderation !== 'active' && !isOwner && !isAdmin) notFound() // flagged/hidden не публичны
  const starred = session ? await isStarred(meta.id, session.userId) : false
  const watching = session ? await isWatching(session.userId, meta.id) : false
  // Папки для звёзд (организация starred по папкам, как GitHub Lists).
  const [folders, inFolders] = session
    ? await Promise.all([getUserFolders(session.userId), getFoldersForTemplate(session.userId, meta.id)])
    : [[], []]
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
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap pb-2.5 ${
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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Link href={`/${meta.ownerHandle}`} className="flex-shrink-0">
              <Avatar handle={meta.ownerHandle} avatarUrl={meta.ownerAvatarUrl} size={26} />
            </Link>
            {/* Только название списка (владелец — в бредкрамбе шапки и на аватаре). */}
            <h1 className="min-w-0 truncate text-[19px] font-bold text-ink">{meta.slug}</h1>
            <span className="shrink-0 rounded-md border border-[var(--accent)] bg-[var(--accent-soft)] px-2 py-0.5 font-mono text-[11px] text-accent">
              v{meta.currentVersion}
            </span>
            {/* Индикатор видимости: приватный или публичный (как Public/Private у GitHub). */}
            <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-0.5 text-[11px] text-ink-2">
              {meta.visibility === 'private' ? (
                <>
                  <Lock size={11} /> {t('privateLabel', lang)}
                </>
              ) : (
                <>
                  <Globe size={11} /> {t('publicLabel', lang)}
                </>
              )}
            </span>
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
                  <PlayCircle size={15} /> <span className="hidden sm:inline">{t('runStart', lang)}</span>
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
              // Split-кнопка как у GitHub: [★ Star N | ▾-папки] одной группой.
              <span className="inline-flex items-stretch">
                <StarButton templateId={meta.id} starred={starred} count={meta.starsCount} label={t('star', lang)} grouped />
                <StarFolderMenu templateId={meta.id} folders={folders} inFolders={inFolders} lang={lang} />
              </span>
            ) : (
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[13px] font-semibold text-ink hover:border-border-strong"
              >
                <Star size={14} /> <span className="hidden sm:inline">{t('star', lang)}</span> <span className="font-mono text-[12px] text-muted">{meta.starsCount}</span>
              </Link>
            )}
            <form action={forkBound}>
              <button className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[13px] font-semibold text-ink hover:border-border-strong">
                <GitFork size={14} /> <span className="hidden sm:inline">{t('fork', lang)}</span>{' '}
                <span className="font-mono text-[12px] text-muted">{meta.forksCount}</span>
              </button>
            </form>
            <ShareButton
              path={base}
              title={tr(meta.title, lang)}
              label={t('share', lang)}
              copiedLabel={t('copied', lang)}
              copyLinkLabel={t('copyLink', lang)}
              shareViaLabel={t('shareVia', lang)}
              qrHint={t('qrHint', lang)}
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[13px] font-semibold text-ink hover:border-border-strong"
            />
            <CloneDropdown base={base} slug={meta.slug} lang={lang} />
            {canWrite ? (
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

        <nav className="no-scrollbar mt-3 flex gap-5 overflow-x-auto text-[14px] font-semibold">
          {/* Первый таб — сам список (как «Code» у GitHub-репо), не «Overview». */}
          {tab('overview', base, <ListChecks size={15} />, t('listTab', lang))}
          {tab('issues', `${base}/issues`, <CircleDot size={15} />, t('issuesTab', lang), issueCount)}
          {tab('suggestions', `${base}/suggestions`, <GitPullRequest size={15} />, t('suggestions', lang), suggCount)}
          {tab('versions', `${base}/versions`, <Tag size={15} />, t('versionsTab', lang))}
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
