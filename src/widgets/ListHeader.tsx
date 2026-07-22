import Link from 'next/link'
import { notFound } from 'next/navigation'
import { BarChart3, CircleDot, GitFork, GitPullRequest, Globe, ListChecks, Lock, MessagesSquare, Settings, Star, Tag } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { isAdminHandle } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { t, tr } from '@/shared/i18n'
import { Avatar } from '@/shared/ui/Avatar'
import { forkTemplate } from '@/features/library/actions'
import { StarButton } from '@/features/library/StarButton'
import { StarFolderMenu } from '@/features/star-folders/StarFolderMenu'
import { getFoldersForTemplate, getUserFolders } from '@/features/star-folders/queries'
import { ShareButton } from '@/features/library/ShareButton'
import { WatchButton } from '@/features/watch/WatchButton'
import { getOpenSuggestionCount, isStarred } from '@/features/library/queries'
import { requireViewableMeta } from '@/features/library/guard'
import { getOpenIssueCount } from '@/features/issues/queries'
import { getDiscussionCount } from '@/features/discussions/queries'
import { getWatchCount, getWatchState } from '@/features/watch/queries'
import { isCollaborator } from '@/features/collab/queries'
import { humanModerationReason } from '@/features/moderation/reason'
import { TabItem, TabNav } from '@/shared/ui/TabNav'

type Tab = 'overview' | 'versions' | 'issues' | 'suggestions' | 'discussions' | 'insights' | 'settings'

/** Общая шапка страницы списка (= «репозиторий»): back, owner/name, действия, вкладки. */
export async function ListHeader({ owner, slug, active }: { owner: string; slug: string; active: Tab }) {
  // Шапка = defense-in-depth: страницы уже гейтят через requireViewable*, но и здесь
  // не рендерим чужой приватный/черновик/снятый модерацией — через тот же чокпоинт (canViewList).
  const [lang, session, meta] = await Promise.all([getLang(), getSession(), requireViewableMeta(owner, slug)])
  if (!meta) notFound()
  const isOwner = session?.userId === meta.ownerId
  const canWrite = isOwner || (session ? await isCollaborator(meta.id, session.userId) : false)
  const isAdmin = isAdminHandle(session?.handle)
  const starred = session ? await isStarred(meta.id, session.userId) : false
  const watchState = session ? await getWatchState(session.userId, meta.id) : null
  // Папки для звёзд (организация starred по папкам, как GitHub Lists).
  const [folders, inFolders] = session
    ? await Promise.all([getUserFolders(session.userId), getFoldersForTemplate(session.userId, meta.id)])
    : [[], []]
  const [suggCount, issueCount, watchCount, discCount] = await Promise.all([
    getOpenSuggestionCount(meta.id),
    getOpenIssueCount(meta.id),
    getWatchCount(meta.id),
    getDiscussionCount(meta.id),
  ])
  const base = `/${owner}/${slug}`
  const forkBound = forkTemplate.bind(null, meta.id)

  return (
    <div>
      {/* Табы — full-width СРАЗУ под шапкой (как GitHub); единый TabNav из shared/ui. */}
      <TabNav scope="list">
        {/* Первый таб — сам список (как «Code» у GitHub-репо), не «Overview». */}
        <TabItem href={base} on={active === 'overview'} icon={<ListChecks size={15} />} label={t('listTab', lang)} />
        {meta.issuesEnabled && (
          <TabItem href={`${base}/issues`} on={active === 'issues'} icon={<CircleDot size={15} />} label={t('issuesTab', lang)} count={issueCount} />
        )}
        <TabItem href={`${base}/suggestions`} on={active === 'suggestions'} icon={<GitPullRequest size={15} />} label={t('suggestions', lang)} count={suggCount} />
        {meta.discussionsEnabled && (
          <TabItem href={`${base}/discussions`} on={active === 'discussions'} icon={<MessagesSquare size={15} />} label={lang === 'ru' ? 'Обсуждения' : 'Discussions'} count={discCount} />
        )}
        <TabItem href={`${base}/versions`} on={active === 'versions'} icon={<Tag size={15} />} label={t('versionsTab', lang)} />
        <TabItem href={`${base}/insights`} on={active === 'insights'} icon={<BarChart3 size={15} />} label={t('insightsTab', lang)} />
        {isOwner && <TabItem href={`${base}/settings`} on={active === 'settings'} icon={<Settings size={15} />} label={t('settings', lang)} />}
      </TabNav>

      <div className="mx-auto w-full max-w-[1180px] px-4 pt-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          {/* Название скрыто на узких экранах — оно уже в бредкрамбе шапки. */}
          <div className="hidden min-w-0 items-center gap-2.5 sm:flex">
            <Link href={`/${meta.ownerHandle}`} className="shrink-0">
              <Avatar handle={meta.ownerHandle} avatarUrl={meta.ownerAvatarUrl} size={26} />
            </Link>
            <h1 className="min-w-0 truncate text-[19px] font-bold text-ink">{tr(meta.title, lang)}</h1>
            <span className="shrink-0 rounded-md border border-(--accent) bg-(--accent-soft) px-2 py-0.5 font-mono text-[11px] text-accent">
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
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Start run переехал в Use-дропдаун (version-bar) — тоже «исполнение». */}
            {session && watchState && (
              <WatchButton
                templateId={meta.id}
                state={watchState}
                count={watchCount}
                labels={{
                  watch: t('watch', lang),
                  unwatch: t('unwatch', lang),
                  title: t('watchTitle', lang),
                  participating: t('watchParticipating', lang),
                  participatingDesc: t('watchParticipatingDesc', lang),
                  all: t('watchAll', lang),
                  allDesc: t('watchAllDesc', lang),
                  ignore: t('watchIgnore', lang),
                  ignoreDesc: t('watchIgnoreDesc', lang),
                  custom: t('watchCustom', lang),
                  customDesc: t('watchCustomDesc', lang),
                  customTitle: t('watchCustomTitle', lang),
                  evVersions: t('versionsTab', lang),
                  evIssues: t('issuesTab', lang),
                  evSuggestions: t('suggestions', lang),
                  apply: t('apply', lang),
                }}
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
                className="inline-flex items-center gap-2 rounded-md border border-border px-3.5 py-2 text-[13px] font-semibold text-ink hover:border-border-strong"
              >
                <Star size={14} /> <span className="hidden sm:inline">{t('star', lang)}</span> <span className="font-mono text-[12px] text-muted">{meta.starsCount}</span>
              </Link>
            )}
            <form action={forkBound}>
              <button className="inline-flex items-center gap-2 rounded-md border border-border px-3.5 py-2 text-[13px] font-semibold text-ink hover:border-border-strong">
                <GitFork size={14} /> <span className="hidden sm:inline">{t('fork', lang)}</span>{' '}
                <span className="font-mono text-[12px] text-muted">{meta.forksCount}</span>
              </button>
            </form>
            <ShareButton
              path={base}
              ru={lang === 'ru'}
              title={tr(meta.title, lang)}
              label={t('share', lang)}
              copiedLabel={t('copied', lang)}
              copyLinkLabel={t('copyLink', lang)}
              shareViaLabel={t('shareVia', lang)}
              qrHint={t('qrHint', lang)}
              className="inline-flex items-center gap-2 rounded-md border border-border px-3.5 py-2 text-[13px] font-semibold text-ink hover:border-border-strong"
            />
            {/* Use (клон) и Edit/Suggest переехали в область списка (version-bar) — как
                зелёная Code и карандаш у GitHub живут в контенте, не в шапке. */}
          </div>
        </div>

        {meta.moderation !== 'active' && (isOwner || isAdmin) && (
          <div
            className={`mt-3 rounded-md border px-3 py-2 text-[12.5px] ${
              meta.moderation === 'hidden'
                ? 'border-danger/40 bg-danger/10 text-danger'
                : 'border-warn/40 bg-warn/10 text-warn'
            }`}
          >
            {meta.moderation === 'hidden'
              ? t('hiddenNotice', lang)
              : meta.moderation === 'pending'
                ? t('pendingNotice', lang)
                : t('flaggedNotice', lang)}
            {/* В БД причина машинная (английская, для очереди админа) — владельцу её переводим. */}
            {meta.moderationReason && ` — ${humanModerationReason(meta.moderationReason, lang)}`}
            {meta.moderation === 'flagged' && isOwner && (
              <span className="ml-2">
                {meta.appealedAt ? (
                  <span className="font-medium">{t('appealSent', lang)}</span>
                ) : (
                  <form
                    action={async () => {
                      'use server'
                      const { requestModerationReview } = await import('@/features/moderation/actions')
                      await requestModerationReview(meta.id)
                    }}
                    className="inline"
                  >
                    <button type="submit" className="font-medium underline underline-offset-2 hover:opacity-80">
                      {t('requestReview', lang)}
                    </button>
                  </form>
                )}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
