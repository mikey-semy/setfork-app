import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Archive, Eye, GitFork, Globe, Lock, Snowflake, Star } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { isAdminHandle } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { t, tr } from '@/shared/i18n'
import { Avatar } from '@/shared/ui/Avatar'
import { Badge } from '@/shared/ui/badge'
import { Tooltip } from '@/shared/ui/Tooltip'
import { Alert } from '@/shared/ui/Alert'
import { PinButton } from '@/features/library/PinButton'
import { StarSplit } from './StarSplit'
import { SplitButton } from '@/shared/ui/SplitButton'
import { splitSegment } from '@/shared/ui/split-segment'
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
          insights: t('insightsTab', lang),
          settings: t('settings', lang),
          more: t('moreTabs', lang),
        }}
        counts={{ issues: issueCount, suggestions: suggCount, discussions: discCount }}
        flags={{ issues: meta.issuesEnabled, discussions: meta.discussionsEnabled, owner: isOwner }}
      />

      <div className="mx-auto w-full max-w-[1180px] px-4 pt-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          {/* Название скрыто на узких экранах — оно уже в бредкрамбе шапки. На
              под-вкладках (Задачи/Предложения/…) скрыто и на широких: там оно
              дублировало бредкрамб сверху, отнимая экран у самого содержимого.
              Тот же приём, что у действий репозитория ниже — как GitHub, где на
              под-вкладках видны только табы. */}
          <ShowOnListRoot base={base}>
          <div className="hidden min-w-0 items-center gap-2.5 sm:flex">
            <Link href={`/${meta.ownerHandle}`} className="shrink-0">
              <Avatar handle={meta.ownerHandle} avatarUrl={meta.ownerAvatarUrl} size={26} />
            </Link>
            <h1 className="min-w-0 truncate text-[19px] font-bold text-ink">{tr(meta.title, lang)}</h1>
            {/* Версию у заголовка НЕ показываем: она живёт в сайдбаре Releases (как у GitHub —
                номер версии/релиза только в блоке Releases, а не рядом с именем). Убран дубль. */}
            {/* Видимость — ТОЛЬКО ИКОНКОЙ, подпись в тултипе: слово рядом с названием
                занимало место, которое нужно самому названию, и повторяло то же, что
                видно значком. Пока этот значок на экране, статус НЕ дублируется в
                сводке показателей (см. ListStats) — как у GitHub, где бейдж стоит у
                имени, а строка статистики его не повторяет. */}
            <Tooltip label={meta.visibility === 'private' ? t('privateLabel', lang) : t('publicLabel', lang)}>
              <span
                className="grid size-6 shrink-0 place-items-center rounded-md border border-border bg-surface-2 text-ink-2"
                aria-label={meta.visibility === 'private' ? t('privateLabel', lang) : t('publicLabel', lang)}
              >
                {meta.visibility === 'private' ? <Lock size={12} /> : <Globe size={12} />}
              </span>
            </Tooltip>
            {/* Ограниченные состояния — рядом с видимостью (архив строже заморозки). */}
            {meta.archivedAt != null ? (
              <Badge variant="warn" className="shrink-0">
                <Archive size={11} /> {t('badgeArchived', lang)}
              </Badge>
            ) : meta.frozenAt != null ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-0.5 text-[11px] text-ink-2">
                <Snowflake size={11} /> {t('badgeFrozen', lang)}
              </span>
            ) : null}
          </div>
          </ShowOnListRoot>

          {/* Действия репозитория — только на корне «Список» (как GitHub: на
              под-вкладках видны только табы, без Watch/Fork/Star). */}
          <ShowOnListRoot base={base}>
          <div className="flex flex-wrap items-center gap-2">
            {/* Pin — свой публичный. Кнопкой ВЕЗДЕ: на мобиле она иконкой, и «...»-меню
                ради одного пункта больше не нужно (владелец: «Поделиться влезла бы»). */}
            {isOwner && meta.visibility === 'public' && (
              <PinButton templateId={meta.id} pinned={meta.pinned} pinLabel={t('pin', lang)} unpinLabel={t('unpin', lang)} />
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
            {/* Гостю «Следить» тоже видно — ведёт на вход (как звезда и форк). Иначе
                ряд кнопок у гостя и у вошедшего разный, и кажется, что кнопка пропала. */}
            {!session && (
              // Гостю тот же сплит, что вошедшему: анатомия ряда не должна зависеть от входа.
              <SplitButton>
                <Link href="/login" className={splitSegment({ className: 'text-ink' })}>
                  <Eye size={14} /> <span className="hidden sm:inline">{t('watch', lang)}</span>
                </Link>
                {watchCount > 0 ? <span className={splitSegment({ interactive: false, muted: true })}>{watchCount}</span> : null}
              </SplitButton>
            )}
            {session ? (
              // Split-кнопка как у GitHub: [★ Отметить N | ▾-папки] одной группой,
              // рамка — по всему периметру (см. StarSplit).
              <StarSplit
                templateId={meta.id}
                starred={starred}
                count={meta.starsCount}
                label={t('star', lang)}
                folders={folders}
                inFolders={inFolders}
                lang={lang}
              />
            ) : (
              // Гостю — та же кнопка, но ведёт на вход. Счётчик так же за разделителем
              // и так же скрыт при нуле: вид кнопки не должен зависеть от того, вошёл ты или нет.
              <SplitButton>
                <Link href="/login" className={splitSegment({ className: 'text-ink' })}>
                  <Star size={14} /> <span className="hidden sm:inline">{t('star', lang)}</span>
                </Link>
                {meta.starsCount > 0 ? <span className={splitSegment({ interactive: false, muted: true })}>{meta.starsCount}</span> : null}
              </SplitButton>
            )}
            {/* Fork как split на GitHub: кнопка (диалог для чужого / неактивна для своего /
                логин для гостя) + счётчик-ссылка в дерево форков (HQ §11, #395). */}
            <SplitButton>
              {isOwner ? (
                // Свой список форкнуть нельзя (как на GitHub свой репозиторий) — кнопка неактивна.
                <Tooltip label={t('cantForkOwn', lang)}>
                  <button type="button" disabled className={splitSegment({ interactive: false, className: 'cursor-not-allowed text-muted opacity-60' })}>
                    <GitFork size={14} /> <span className="hidden sm:inline">{t('fork', lang)}</span>
                  </button>
                </Tooltip>
              ) : (
                // Форк — отдельной страницей /fork (как GitHub), не модалкой. Гостя ведём на вход.
                <Link href={session ? `${base}/fork` : '/login'} className={splitSegment({ className: 'text-ink' })}>
                  <GitFork size={14} /> <span className="hidden sm:inline">{t('fork', lang)}</span>
                </Link>
              )}
              {/* Счётчик — ссылка в дерево форков (HQ §11): кто что вырастил из списка.
                  Нуля нет: не из чего дерево, и место в ряду не занимаем. */}
              {meta.forksCount > 0 ? (
                <Link href={`${base}/forks`} aria-label={t('fork', lang)} className={splitSegment({ muted: true })}>
                  {meta.forksCount}
                </Link>
              ) : null}
            </SplitButton>
            {/* Share — кнопкой ВЕЗДЕ: на мобиле иконкой (текст прячет сама кнопка).
                В «...» на мобиле остаётся только Pin, поэтому у чужого списка «...»
                там вообще не рисуется. */}
            <ShareButton
              path={base}
              ru={lang === 'ru'}
              title={tr(meta.title, lang)}
              label={t('share', lang)}
              copiedLabel={t('copied', lang)}
              copyLinkLabel={t('copyLink', lang)}
              shareViaLabel={t('shareVia', lang)}
              qrHint={t('qrHint', lang)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-[13px] font-semibold text-ink hover:border-border-strong sm:w-auto sm:gap-2 sm:px-3.5"
            />
            {/* Use (клон) и Edit/Suggest переехали в область списка (version-bar) — как
                зелёная Code и карандаш у GitHub живут в контенте, не в шапке. */}
          </div>
          </ShowOnListRoot>
        </div>

        {meta.moderation !== 'active' && (isOwner || isAdmin) && (
          <Alert variant={meta.moderation === 'hidden' ? 'danger' : 'warn'} className="mt-3">
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
          </Alert>
        )}

        {/* Баннер ограниченного состояния — виден всем (не только владельцу). */}
        {meta.archivedAt != null ? (
          <Alert variant="warn" className="mt-3">
            {t('bannerArchived', lang)}
          </Alert>
        ) : meta.frozenAt != null ? (
          <Alert variant="info" className="mt-3">
            {t('bannerFrozen', lang)}
          </Alert>
        ) : null}
      </div>
    </div>
  )
}
