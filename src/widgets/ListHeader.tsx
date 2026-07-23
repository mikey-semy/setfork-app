import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Archive, GitFork, Globe, Lock, Snowflake, Star } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { isAdminHandle } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { t, tr } from '@/shared/i18n'
import { Avatar } from '@/shared/ui/Avatar'
import { PinButton } from '@/features/library/PinButton'
import { StarButton } from '@/features/library/StarButton'
import { StarFolderMenu } from '@/features/star-folders/StarFolderMenu'
import { getFoldersForTemplate, getUserFolders } from '@/features/star-folders/queries'
import { ShareButton } from '@/features/library/ShareButton'
import { ListHeaderMenu } from '@/features/library/ListHeaderMenu'
import { WatchButton } from '@/features/watch/WatchButton'
import { getOpenSuggestionCount, isStarred } from '@/features/library/queries'
import { requireViewableMeta } from '@/features/library/guard'
import { getOpenIssueCount } from '@/features/issues/queries'
import { getDiscussionCount } from '@/features/discussions/queries'
import { getWatchCount, getWatchState } from '@/features/watch/queries'
import { isCollaborator } from '@/features/collab/queries'
import { humanModerationReason } from '@/features/moderation/reason'
import { ListTabs } from './ListTabs'
import { ShowOnListRoot } from './ShowOnListRoot'

/** Общая шапка страницы списка (= «репозиторий»): owner/name, действия, вкладки.
 *  Живёт в персистентном [handle]/[slug]/layout.tsx — не перемонтируется между
 *  вкладками (меню не моргает); активная вкладка определяется в ListTabs клиентски. */
export async function ListHeader({ owner, slug }: { owner: string; slug: string }) {
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

  return (
    <div>
      {/* Табы — full-width СРАЗУ под шапкой (как GitHub). Активная вкладка — клиентски
          (ListTabs/usePathname), чтобы полоска переезжала мгновенно и меню не моргало. */}
      <ListTabs
        base={base}
        labels={{
          list: t('listTab', lang),
          issues: t('issuesTab', lang),
          suggestions: t('suggestions', lang),
          discussions: lang === 'ru' ? 'Обсуждения' : 'Discussions',
          versions: t('versionsTab', lang),
          insights: t('insightsTab', lang),
          settings: t('settings', lang),
        }}
        counts={{ issues: issueCount, suggestions: suggCount, discussions: discCount }}
        flags={{ issues: meta.issuesEnabled, discussions: meta.discussionsEnabled, owner: isOwner }}
      />

      <div className="mx-auto w-full max-w-[1180px] px-4 pt-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          {/* Название скрыто на узких экранах — оно уже в бредкрамбе шапки. */}
          <div className="hidden min-w-0 items-center gap-2.5 sm:flex">
            <Link href={`/${meta.ownerHandle}`} className="shrink-0">
              <Avatar handle={meta.ownerHandle} avatarUrl={meta.ownerAvatarUrl} size={26} />
            </Link>
            <h1 className="min-w-0 truncate text-[19px] font-bold text-ink">{tr(meta.title, lang)}</h1>
            {/* Версию у заголовка НЕ показываем: она живёт в сайдбаре Releases (как у GitHub —
                номер версии/релиза только в блоке Releases, а не рядом с именем). Убран дубль. */}
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
            {/* Ограниченные состояния — рядом с видимостью (архив строже заморозки). */}
            {meta.archivedAt != null ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-warn/40 bg-warn/10 px-2 py-0.5 text-[11px] text-warn">
                <Archive size={11} /> {t('badgeArchived', lang)}
              </span>
            ) : meta.frozenAt != null ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-0.5 text-[11px] text-ink-2">
                <Snowflake size={11} /> {t('badgeFrozen', lang)}
              </span>
            ) : null}
          </div>

          {/* Действия репозитория — только на корне «Список» (как GitHub: на
              под-вкладках видны только табы, без Watch/Fork/Star). */}
          <ShowOnListRoot base={base}>
          <div className="flex flex-wrap items-center gap-2">
            {/* Pin — свой публичный. Кнопкой на широком экране (как GitHub);
                на мобиле уезжает в «...» (см. ниже). */}
            {isOwner && meta.visibility === 'public' && (
              <span className="hidden sm:inline-flex">
                <PinButton templateId={meta.id} pinned={meta.pinned} pinLabel={t('pin', lang)} unpinLabel={t('unpin', lang)} />
              </span>
            )}
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
              // h-9 на группе + items-stretch → оба дочерних ровно 36px.
              <span className="inline-flex h-9 items-stretch">
                <StarButton templateId={meta.id} starred={starred} count={meta.starsCount} label={t('star', lang)} grouped />
                <StarFolderMenu templateId={meta.id} folders={folders} inFolders={inFolders} lang={lang} />
              </span>
            ) : (
              <Link
                href="/login"
                className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3.5 text-[13px] font-semibold text-ink hover:border-border-strong"
              >
                <Star size={14} /> <span className="hidden sm:inline">{t('star', lang)}</span> <span className="font-mono text-[12px] text-muted">{meta.starsCount}</span>
              </Link>
            )}
            {/* Fork как split на GitHub: кнопка (диалог для чужого / неактивна для своего /
                логин для гостя) + счётчик-ссылка в дерево форков (HQ §11, #395). */}
            <span className="inline-flex h-9 items-stretch overflow-hidden rounded-md border border-border">
              {isOwner ? (
                // Свой список форкнуть нельзя (как на GitHub свой репозиторий) — кнопка неактивна.
                <button
                  disabled
                  title={t('cantForkOwn', lang)}
                  className="inline-flex h-full cursor-not-allowed items-center gap-2 px-3.5 text-[13px] font-semibold text-muted opacity-60"
                >
                  <GitFork size={14} /> <span className="hidden sm:inline">{t('fork', lang)}</span>
                </button>
              ) : session ? (
                // Форк — отдельной страницей /fork (как GitHub), не модалкой.
                <Link
                  href={`${base}/fork`}
                  className="inline-flex h-full items-center gap-2 px-3.5 text-[13px] font-semibold text-ink hover:bg-surface-2"
                >
                  <GitFork size={14} /> <span className="hidden sm:inline">{t('fork', lang)}</span>
                </Link>
              ) : (
                <Link
                  href="/login"
                  className="inline-flex h-full items-center gap-2 px-3.5 text-[13px] font-semibold text-ink hover:bg-surface-2"
                >
                  <GitFork size={14} /> <span className="hidden sm:inline">{t('fork', lang)}</span>
                </Link>
              )}
              {/* Счётчик — ссылка в дерево форков (HQ §11): кто что вырастил из списка. */}
              <Link
                href={`${base}/forks`}
                aria-label={t('fork', lang)}
                className="inline-flex h-full items-center border-l border-border px-2.5 font-mono text-[12px] text-muted hover:bg-surface-2 hover:text-ink"
              >
                {meta.forksCount}
              </Link>
            </span>
            {/* Share — кнопкой на широком экране; на мобиле уезжает в «...». */}
            <ShareButton
              path={base}
              ru={lang === 'ru'}
              title={tr(meta.title, lang)}
              label={t('share', lang)}
              copiedLabel={t('copied', lang)}
              copyLinkLabel={t('copyLink', lang)}
              shareViaLabel={t('shareVia', lang)}
              qrHint={t('qrHint', lang)}
              className="hidden h-9 items-center gap-2 rounded-md border border-border px-3.5 text-[13px] font-semibold text-ink hover:border-border-strong sm:inline-flex"
            />
            {/* «...» — вторичное (Pin + Поделиться) ТОЛЬКО на мобиле, где ряд не
                вмещает всё. На широком экране всё видно кнопками — как в GitHub. */}
            <span className="inline-flex sm:hidden">
              <ListHeaderMenu
                moreLabel={t('moreActions', lang)}
                canPin={isOwner && meta.visibility === 'public'}
                templateId={meta.id}
                pinned={meta.pinned}
                pinLabel={t('pin', lang)}
                unpinLabel={t('unpin', lang)}
                path={base}
                shareTitle={tr(meta.title, lang)}
                ru={lang === 'ru'}
                share={{
                  label: t('share', lang),
                  copiedLabel: t('copied', lang),
                  copyLinkLabel: t('copyLink', lang),
                  shareViaLabel: t('shareVia', lang),
                  qrHint: t('qrHint', lang),
                }}
              />
            </span>
            {/* Use (клон) и Edit/Suggest переехали в область списка (version-bar) — как
                зелёная Code и карандаш у GitHub живут в контенте, не в шапке. */}
          </div>
          </ShowOnListRoot>
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

        {/* Баннер ограниченного состояния — виден всем (не только владельцу). */}
        {meta.archivedAt != null ? (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[12.5px] text-warn">
            <Archive size={14} className="shrink-0" /> {t('bannerArchived', lang)}
          </div>
        ) : meta.frozenAt != null ? (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-[12.5px] text-ink-2">
            <Snowflake size={14} className="shrink-0" /> {t('bannerFrozen', lang)}
          </div>
        ) : null}
      </div>
    </div>
  )
}
