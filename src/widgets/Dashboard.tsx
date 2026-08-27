import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import { countUserTemplates, getActivity, getUserTemplates } from '@/features/library/queries'
import { getImprovementFeed } from '@/features/improve/queries'
import { getFollowingIds } from '@/features/follows/queries'
import { getWatchedIds } from '@/features/watch/queries'
import { getFeedEvents, getRecommended, getStarredIds, type FeedEvent } from '@/features/feed/queries'
import { Feed } from '@/features/feed/Feed'
import type { Lang } from '@/shared/i18n'
import { ListsPanel } from './ListsPanel'
import { DASHBOARD_LISTS } from '@/shared/lib/paging'
import { loadMyLists, searchMyLists } from '@/features/library/actions/my-lists'
import { t, tr } from '@/shared/i18n'
import { PromoCard } from './PromoCard'
import { ChangelogCard } from './ChangelogCard'
import { cardClass } from '@/shared/ui/card-style'
import { listVisibilityState } from '@/features/library/list-visibility'

// Dashboard залогиненного (GitHub-стиль, full-width):
//   слева — Your lists (переиспользуемая панель с фильтром),
//   центр — AI-area + Feed из подписок (клиентский фильтр событий) + Recommended,
//   справа — промо-слот + публичный changelog.

export async function Dashboard({ lang, userId }: { lang: Lang; userId: string }) {
  const [mine, mineTotal, following, watched, starred] = await Promise.all([
    getUserTemplates(userId, userId, { limit: DASHBOARD_LISTS }),
    countUserTemplates(userId, userId),
    getFollowingIds(userId),
    getWatchedIds(userId),
    getStarredIds(userId),
  ])
  const hasScope = following.length > 0 || watched.length > 0 || starred.length > 0
  let events: FeedEvent[] = hasScope
    ? await getFeedEvents({ followingIds: following, watchedIds: watched, starredIds: starred }, 40)
    : []
  // Пустые подписки → общая лента версий (с подсказкой «подпишись»), как раньше.
  const emptyHint = events.length === 0
  if (emptyHint) {
    const global = await getActivity(30, userId)
    events = global.map((a) => ({
      type: a.version === 1 ? (a.origin === 'forked' ? ('forked' as const) : ('created' as const)) : ('version' as const),
      actorHandle: a.ownerHandle,
      actorAvatarUrl: a.ownerAvatarUrl,
      ownerHandle: a.ownerHandle,
      slug: a.slug,
      title: a.title,
      version: a.version,
      note: a.note,
      createdAt: a.createdAt,
    }))
  }
  const [recommended, improve] = await Promise.all([getRecommended(userId, starred, 4), getImprovementFeed(userId, 3)])

  // ТРИ КОЛОНКИ ВКЛЮЧАЮТСЯ НЕ НА lg. На 1024px в этот же момент появляется левое меню
  // приложения (240px), и на ленту оставалось ~70px: слова переносились по одному, а сама
  // лента читалась как сломанная вёрстка. Считаем честно: 1024 − 240 меню − 64 поля =
  // 720px, из которых 300+300 забирают боковые колонки.
  // Поэтому на lg — ДВЕ колонки (списки + лента), три — только с xl, где ширины хватает:
  // 1280 − 240 − 64 = 976, минус 260+260 боковых = ~410 на ленту.
  // grid-cols-1 НА МОБИЛЕ ОБЯЗАТЕЛЕН, хотя колонка там и так одна. Без него трек
  // неявный (auto), его min-функция — auto, а значит для содержимого включается
  // content-based автоминимум: колонка раздувается до min-content потомков. Строка
  // панели списков — truncate, то есть white-space: nowrap, и её min-content равен
  // ПОЛНОЙ длине названия (min-w-0 разрешает сжатие при заданной ширине, но
  // intrinsic min-content не уменьшает). Один длинный заголовок раздувал колонку до
  // 464px при экране 390: страница уезжала вправо на ~90px, у поиска, «Создать»,
  // «Фильтр» и карточек ленты срезало правый край, а truncate не срабатывал вовсе.
  // grid-cols-1 = repeat(1, minmax(0,1fr)): min-функция 0 → автоминимум выключен.
  return (
    <div className="grid w-full grid-cols-1 gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[280px_minmax(0,1fr)] lg:px-8 xl:grid-cols-[260px_minmax(0,1fr)_260px] 2xl:grid-cols-[300px_minmax(0,1fr)_300px]">
      {/* Слева: твои списки (переиспользуемая панель). top = высота шапки (57) + верхний
          паддинг сетки (py-6 = 24) → панель НЕ подпрыгивает к шапке при скролле. */}
      <aside className="lg:sticky lg:top-[5.0625rem] lg:self-start">
        <ListsPanel
          lang={lang}
          title={t('yourLists', lang)}
          // visibility обязателен и здесь: `loadMyLists` его отдаёт, и без него замок
          // у приватного списка появлялся бы только со второй страницы панели.
          items={mine.map((m) => ({
            handle: m.ownerHandle,
            slug: m.slug,
            title: m.title,
            avatarUrl: m.ownerAvatarUrl,
            visibility: listVisibilityState(m),
          }))}
          total={mineTotal}
          loadPage={loadMyLists}
          remoteSearch={searchMyLists}
          initialLimit={DASHBOARD_LISTS}
          showNew
          emptyText={t('emptyMyLists', lang)}
        />
      </aside>

      {/* Центр: лента (AI-строка убрана — дублировала кнопку «Создать» из шапки/списков). */}
      <div className="min-w-0">
        {improve.length > 0 && (
          <div className={cardClass({ pad: 'sm', className: 'mb-4' })}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-body-sm font-semibold text-ink-2">
                <Sparkles size={14} className="text-accent" /> {lang === 'ru' ? 'Что улучшить' : 'What to improve'}
              </span>
              <Link href="/improve" className="text-body-sm text-accent hover:underline">{lang === 'ru' ? 'все' : 'all'}</Link>
            </div>
            <ul className="flex flex-col gap-1.5">
              {improve.map((it) => (
                <li key={it.id} className="flex items-center justify-between gap-2 text-body">
                  <Link href={`/${it.ownerHandle}/${it.slug}`} className="min-w-0 truncate text-accent hover:underline">{tr(it.title, lang)}</Link>
                  <span className="shrink-0 font-mono text-caption text-muted">
                    {it.openSuggestions > 0 && <span className="text-accent">⑂{it.openSuggestions} </span>}
                    {it.openIssues > 0 && <span className="text-warn">◍{it.openIssues}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Feed events={events} recommended={recommended} lang={lang} emptyHint={emptyHint} />
      </div>

      {/* Справа: промо-слот + changelog */}
      {/* Промо и changelog — только там, где под них есть третья колонка (см. выше). */}
      <aside className="hidden xl:sticky xl:top-[5.0625rem] xl:flex xl:flex-col xl:gap-4 xl:self-start">
        <PromoCard lang={lang} />
        <ChangelogCard lang={lang} />
      </aside>
    </div>
  )
}
