'use client'

import Link from 'next/link'
import { useState } from 'react'
import { GitFork, ListChecks, MessageSquare, PencilLine, Star, Tag, UserPlus } from 'lucide-react'
import { Avatar } from '@/shared/ui/Avatar'
import { EmptyState } from '@/shared/ui/EmptyState'
import { UserLine } from '@/shared/ui/UserLine'
import { Markdown } from '@/shared/ui/Markdown'
import { tr, type Lang } from '@/shared/i18n'
import type { FeedEvent } from './queries'
import type { RecommendedList } from './queries'
import { DEFAULT_PREFS, type FeedPrefs } from './prefs'
import { FeedFilter } from './FeedFilter'
import { cardClass } from '@/shared/ui/card-style'

// Лента dashboard: сервер отдаёт все события (page.tsx), фильтр — клиентский
// по localStorage-настройкам (FeedFilter). В конце — «Recommended for you».

const ICONS = {
  version: Tag,
  created: ListChecks,
  forked: GitFork,
  star: Star,
  follow: UserPlus,
  issue: MessageSquare,
  suggestion: PencilLine,
} as const

// Стабильный ключ события: лента фильтруется на клиенте (prefs), поэтому ключ с
// индексом «переезжает» между карточками при смене фильтра. Собираем ключ из полей
// самого события — их комбинация однозначно его идентифицирует.
function eventKey(e: FeedEvent): string {
  return [e.type, new Date(e.createdAt).getTime(), e.actorHandle, e.targetHandle ?? '', e.ownerHandle ?? '', e.slug ?? '', e.version ?? '', e.itemId ?? ''].join(':')
}

function verb(e: FeedEvent, ru: boolean): string {
  switch (e.type) {
    case 'version':
      return ru ? `обновил до v${e.version}` : `updated to v${e.version}`
    case 'created':
      return ru ? 'создал' : 'created'
    case 'forked':
      return ru ? 'форкнул' : 'forked'
    case 'star':
      return ru ? 'поставил звезду' : 'starred'
    case 'follow':
      return ru ? 'подписался на' : 'followed'
    case 'issue':
      return ru ? 'открыл issue в' : 'opened an issue in'
    case 'suggestion':
      return ru ? 'предложил правки в' : 'suggested changes to'
  }
}

export function Feed({
  events,
  recommended,
  lang,
  emptyHint,
}: {
  events: FeedEvent[]
  recommended: RecommendedList[]
  lang: Lang
  emptyHint: boolean
}) {
  const ru = lang === 'ru'
  const [prefs, setPrefs] = useState<FeedPrefs>(DEFAULT_PREFS)
  const shown = events.filter((e) => prefs.events[e.type] && (prefs.includeStarred || !e.viaStarred))

  return (
    <section className="min-w-0">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[1rem] font-semibold text-ink">{ru ? 'Лента' : 'Feed'}</h2>
        <FeedFilter lang={lang} onChange={setPrefs} />
      </div>
      {emptyHint && (
        <p className="mb-3 text-[0.78125rem] text-muted">
          {ru
            ? 'Лента собирается из подписок: подпишись на людей и списки в '
            : 'Your feed is built from people and lists you follow. Find them on '}
          <Link href="/explore" className="text-accent hover:underline">
            Explore
          </Link>
        </p>
      )}
      {shown.length === 0 ? (
        <EmptyState hint={ru ? 'Пока пусто' : 'Nothing here yet'} />
      ) : (
        <div className="flex flex-col gap-2.5">
          {shown.map((e) => {
            // Версия/релиз — богатая карточка с содержимым (заметка = changelog), как на GitHub.
            if (e.type === 'version') return <ReleaseCard key={eventKey(e)} e={e} lang={lang} ru={ru} />
            const Icon = ICONS[e.type as keyof typeof ICONS] ?? Tag
            return (
              <div key={eventKey(e)} className={cardClass({ className: 'flex gap-3' })}>
                <Link href={`/${e.actorHandle}`} aria-label={e.actorHandle} className="shrink-0">
                  <Avatar handle={e.actorHandle} avatarUrl={e.actorAvatarUrl} size={34} />
                </Link>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem]">
                    <Icon size={13} className="shrink-0 text-muted" />
                    <Link href={`/${e.actorHandle}`} className="text-ink-2 hover:text-accent">
                      {e.actorHandle}
                    </Link>
                    <span className="text-ink-2">{verb(e, ru)}</span>
                    {e.type === 'follow' ? (
                      <Link href={`/${e.targetHandle}`} className="font-semibold text-accent hover:underline">
                        {e.targetHandle}
                      </Link>
                    ) : (
                      <Link href={`/${e.ownerHandle}/${e.slug}`} className="min-w-0 truncate font-semibold text-accent hover:underline">
                        {tr(e.title, lang) || `${e.ownerHandle}/${e.slug}`}
                      </Link>
                    )}
                  </div>
                  {/* заголовок списка теперь в самой строке события выше (человеческое имя, не slug) */}
                  {e.type === 'issue' && e.itemTitle && (
                    <div className="mt-1 truncate text-[0.78125rem] text-muted">“{e.itemTitle}”</div>
                  )}
                </div>
                <span className="shrink-0 font-mono text-[0.6875rem] text-muted">
                  {new Intl.DateTimeFormat(ru ? 'ru' : 'en', { month: 'short', day: 'numeric' }).format(new Date(e.createdAt))}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {prefs.events.recommended && recommended.length > 0 && (
        <div className={cardClass({ className: 'mt-4' })}>
          <div className="mb-2 flex items-center gap-1.5 text-[0.78125rem] font-semibold text-ink">
            <Star size={13} className="text-muted" /> {ru ? 'Рекомендации для тебя' : 'Recommended for you'}
          </div>
          <div className="flex flex-col">
            {recommended.map((r) => (
              <Link
                key={`${r.ownerHandle}/${r.slug}`}
                href={`/${r.ownerHandle}/${r.slug}`}
                className="group flex items-center gap-2 rounded-md px-2 py-2 hover:bg-surface-2"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[0.8125rem] font-semibold text-ink group-hover:text-accent">
                    {tr(r.title, lang)}
                  </span>
                  <span className="block truncate text-[0.78125rem] text-muted">{r.ownerHandle}</span>
                </span>
                <span className="ml-auto inline-flex shrink-0 items-center gap-1 font-mono text-[0.6875rem] text-muted">
                  <Star size={11} /> {r.starsCount}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <Link
        href="/explore"
        className="mt-3 block rounded-lg border border-border py-2.5 text-center text-[0.8125rem] font-semibold text-accent hover:bg-surface"
      >
        {ru ? 'Ещё' : 'More'}
      </Link>
    </section>
  )
}

/** Карточка релиза (событие version): шапка + бейдж vN + заголовок списка +
 *  заметка версии (changelog) в врезке + ссылки. Аналог release-карточки GitHub. */
function ReleaseCard({ e, lang, ru }: { e: FeedEvent; lang: Lang; ru: boolean }) {
  const base = `/${e.ownerHandle}/${e.slug}`
  const note = e.note && !['initial', 'edit', 'seeded'].includes(e.note) ? e.note : ''
  const date = new Intl.DateTimeFormat(ru ? 'ru' : 'en', { month: 'short', day: 'numeric' }).format(new Date(e.createdAt))
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      {/* Шапка: кто выпустил + когда */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-[0.8125rem]">
        <UserLine handle={e.actorHandle} avatarUrl={e.actorAvatarUrl} size="sm" />
        <span className="text-ink-2">{ru ? 'выпустил' : 'released'}</span>
        <Tag size={13} className="shrink-0 text-muted" />
        <span className="ml-auto shrink-0 font-mono text-[0.6875rem] text-muted">{date}</span>
      </div>
      {/* Тело: версия + заголовок + changelog */}
      <div className="px-4 py-3.5">
        {/* mb как у прежней строки со слагом: без неё заголовок прижимался к заметке. */}
        <div className="mb-2.5 flex flex-wrap items-center gap-2">
          <span className="rounded-md border border-(--accent)/40 bg-(--accent-soft) px-2 py-0.5 font-mono text-[0.78125rem] font-semibold text-accent">
            v{e.version}
          </span>
          <Link href={base} className="min-w-0 truncate text-[1rem] font-semibold text-ink hover:text-accent">
            {tr(e.title, lang) || `${e.ownerHandle}/${e.slug}`}
          </Link>
        </div>
        {/* Строки «owner/slug» здесь НЕТ намеренно: слаг — технический адрес, его
            не показывают человеку (как и в строках событий выше). Список назван
            заголовком в ссылке над этой врезкой, а сам адрес виден в браузере. */}
        {note ? (
          <Markdown className="border-l-2 border-border pl-3 text-[0.8125rem] text-ink-2">{note}</Markdown>
        ) : (
          <p className="text-[0.78125rem] italic text-muted">{ru ? 'Без заметок к версии' : 'No release notes'}</p>
        )}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[0.78125rem]">
          <Link href={`${base}/versions`} className="font-medium text-accent hover:underline">
            {ru ? 'Изменения' : 'Changes'} →
          </Link>
          <Link href={base} className="text-ink-2 hover:text-ink">
            {ru ? 'Открыть список' : 'Open list'}
          </Link>
        </div>
      </div>
    </div>
  )
}
