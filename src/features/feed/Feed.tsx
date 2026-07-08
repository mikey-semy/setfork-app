'use client'

import Link from 'next/link'
import { useState } from 'react'
import { GitFork, ListChecks, MessageSquare, PencilLine, Star, Tag, UserPlus } from 'lucide-react'
import { Avatar } from '@/shared/ui/Avatar'
import { Markdown } from '@/shared/ui/Markdown'
import { tr, type Lang } from '@/shared/i18n'
import type { FeedEvent } from './queries'
import type { RecommendedList } from './queries'
import { DEFAULT_PREFS, type FeedPrefs } from './prefs'
import { FeedFilter } from './FeedFilter'

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
        <h2 className="text-[15px] font-semibold text-ink">{ru ? 'Лента' : 'Feed'}</h2>
        <FeedFilter lang={lang} onChange={setPrefs} />
      </div>
      {emptyHint && (
        <p className="mb-3 text-[12.5px] text-muted">
          {ru
            ? 'Лента собирается из подписок: подпишись на людей и списки в '
            : 'Your feed is built from people and lists you follow. Find them on '}
          <Link href="/explore" className="text-accent hover:underline">
            Explore
          </Link>
        </p>
      )}
      {shown.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center text-[13.5px] text-muted">
          {ru ? 'Пока пусто' : 'Nothing here yet'}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {shown.map((e) => {
            // Версия/релиз — богатая карточка с содержимым (заметка = changelog), как на GitHub.
            if (e.type === 'version') return <ReleaseCard key={eventKey(e)} e={e} lang={lang} ru={ru} />
            const Icon = ICONS[e.type as keyof typeof ICONS] ?? Tag
            return (
              <div key={eventKey(e)} className="flex gap-3 rounded-lg border border-border bg-surface p-3.5">
                <Link href={`/${e.actorHandle}`} className="flex-shrink-0">
                  <Avatar handle={e.actorHandle} avatarUrl={e.actorAvatarUrl} size={34} />
                </Link>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px]">
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
                        {e.ownerHandle}/{e.slug}
                      </Link>
                    )}
                  </div>
                  {e.title && <div className="mt-0.5 truncate text-[13px] text-ink-2">{tr(e.title, lang)}</div>}
                  {e.type === 'issue' && e.itemTitle && (
                    <div className="mt-1 truncate text-[12.5px] text-muted">“{e.itemTitle}”</div>
                  )}
                </div>
                <span className="flex-shrink-0 font-mono text-[11px] text-muted">
                  {new Intl.DateTimeFormat(ru ? 'ru' : 'en', { month: 'short', day: 'numeric' }).format(new Date(e.createdAt))}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {prefs.events.recommended && recommended.length > 0 && (
        <div className="mt-4 rounded-lg border border-border bg-surface p-3.5">
          <div className="mb-2 flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
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
                  <span className="block truncate text-[13.5px] font-semibold text-ink group-hover:text-accent">
                    {r.ownerHandle}/{r.slug}
                  </span>
                  <span className="block truncate text-[12px] text-muted">{tr(r.title, lang)}</span>
                </span>
                <span className="ml-auto inline-flex shrink-0 items-center gap-1 font-mono text-[11.5px] text-muted">
                  <Star size={11} /> {r.starsCount}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <Link
        href="/explore"
        className="mt-3 block rounded-lg border border-border py-2.5 text-center text-[13px] font-semibold text-accent hover:bg-surface"
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
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-[13px]">
        <Link href={`/${e.actorHandle}`} className="flex-shrink-0">
          <Avatar handle={e.actorHandle} avatarUrl={e.actorAvatarUrl} size={22} />
        </Link>
        <Link href={`/${e.actorHandle}`} className="font-medium text-ink-2 hover:text-accent">
          {e.actorHandle}
        </Link>
        <span className="text-ink-2">{ru ? 'выпустил' : 'released'}</span>
        <Tag size={13} className="shrink-0 text-muted" />
        <span className="ml-auto flex-shrink-0 font-mono text-[11px] text-muted">{date}</span>
      </div>
      {/* Тело: версия + заголовок + changelog */}
      <div className="px-4 py-3.5">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="rounded-md border border-[var(--accent)]/40 bg-[var(--accent-soft)] px-2 py-0.5 font-mono text-[12px] font-semibold text-accent">
            v{e.version}
          </span>
          <Link href={base} className="min-w-0 truncate text-[15px] font-semibold text-ink hover:text-accent">
            {tr(e.title, lang) || `${e.ownerHandle}/${e.slug}`}
          </Link>
        </div>
        <div className="mb-2.5 font-mono text-[11px] text-muted">
          {e.ownerHandle}/{e.slug}
        </div>
        {note ? (
          <Markdown className="border-l-2 border-border pl-3 text-[13px] text-ink-2">{note}</Markdown>
        ) : (
          <p className="text-[12.5px] italic text-muted">{ru ? 'Без заметок к версии' : 'No release notes'}</p>
        )}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
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
