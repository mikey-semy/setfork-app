'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { GitFork, Heart, ListChecks, MessageSquare, SlidersHorizontal, Star, Tag, UserPlus, X } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import type { FeedEventType } from './prefs'
import { DEFAULT_PREFS, loadPrefs, savePrefs, type FeedPrefs } from './prefs'

// Filter-поповер ленты (как GitHub Feed → Filter): чекбоксы типов событий +
// «включать события из starred-списков». Хранение — localStorage (prefs.ts);
// сама лента уже загружена сервером, фильтрация — на клиенте (см. Feed.tsx).

const EVENTS: { key: FeedEventType; icon: typeof Star; en: [string, string]; ru: [string, string] }[] = [
  { key: 'version', icon: Tag, en: ['Versions', 'New versions of lists you watch or follow'], ru: ['Версии', 'Новые версии списков из подписок'] },
  { key: 'created', icon: ListChecks, en: ['Lists', 'Lists created by people you follow'], ru: ['Списки', 'Созданные людьми из подписок'] },
  { key: 'forked', icon: GitFork, en: ['Forks', 'Lists forked by people you follow'], ru: ['Форки', 'Форкнутые людьми из подписок'] },
  { key: 'star', icon: Star, en: ['Stars', 'Lists being starred by people'], ru: ['Звёзды', 'Кому люди ставят звёзды'] },
  { key: 'issue', icon: MessageSquare, en: ['Issues', 'Issues from lists you watch'], ru: ['Issues', 'Из отслеживаемых списков'] },
  { key: 'suggestion', icon: MessageSquare, en: ['Suggestions', 'Suggested edits from lists you watch'], ru: ['Предложения', 'Правки в отслеживаемых списках'] },
  { key: 'follow', icon: UserPlus, en: ['Follows', 'Who people are following'], ru: ['Подписки', 'На кого подписываются люди'] },
  { key: 'recommended', icon: Heart, en: ['Recommendations', 'Lists you may like'], ru: ['Рекомендации', 'Списки, которые могут понравиться'] },
]

export function FeedFilter({ lang, onChange }: { lang: Lang; onChange: (p: FeedPrefs) => void }) {
  const ru = lang === 'ru'
  const [open, setOpen] = useState(false)
  const [prefs, setPrefs] = useState<FeedPrefs>(DEFAULT_PREFS)

  useEffect(() => {
    const p = loadPrefs()
    setPrefs(p)
    onChange(p)
    // onChange стабилен по месту использования (setState родителя)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const apply = (next: FeedPrefs) => {
    setPrefs(next)
    savePrefs(next)
    onChange(next)
  }

  const toggle = (key: FeedEventType) =>
    apply({ ...prefs, events: { ...prefs.events, [key]: !prefs.events[key] } })

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12.5px] font-semibold text-ink hover:border-border-strong"
      >
        <SlidersHorizontal size={13} /> {ru ? 'Фильтр' : 'Filter'}
      </button>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/30 p-4 pt-24 sm:justify-end sm:pr-8" onClick={() => setOpen(false)}>
            <div onClick={(e) => e.stopPropagation()} className="flex max-h-[70vh] w-[340px] max-w-full flex-col rounded-lg border border-border bg-surface shadow-card">
              <div className="flex items-center justify-between border-b border-border px-3.5 py-2.5">
                <span className="text-[13.5px] font-semibold text-ink">{ru ? 'Фильтр' : 'Filter'}</span>
                <button type="button" onClick={() => setOpen(false)} className="rounded p-1 text-muted hover:text-ink">
                  <X size={14} />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-2.5">
                <div className="text-[12.5px] font-semibold text-ink">{ru ? 'События' : 'Events'}</div>
                <p className="mb-2 text-[11.5px] text-muted">
                  {ru ? 'Что показывать в ленте' : 'Activity you want to see on your feed'}
                </p>
                <div className="flex flex-col gap-1">
                  {EVENTS.map((e) => {
                    const Icon = e.icon
                    const [title, sub] = ru ? e.ru : e.en
                    return (
                      <label key={e.key} className="flex cursor-pointer items-start gap-2.5 rounded-md px-1.5 py-1.5 hover:bg-surface-2">
                        <input
                          type="checkbox"
                          checked={prefs.events[e.key]}
                          onChange={() => toggle(e.key)}
                          className="mt-0.5 accent-[var(--accent)]"
                        />
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                            <Icon size={13} className="text-muted" /> {title}
                          </span>
                          <span className="block text-[11.5px] leading-snug text-muted">{sub}</span>
                        </span>
                      </label>
                    )
                  })}
                </div>
                <label className="mt-2 flex cursor-pointer items-start gap-2.5 border-t border-border px-1.5 pb-1 pt-2.5 hover:bg-surface-2">
                  <input
                    type="checkbox"
                    checked={prefs.includeStarred}
                    onChange={() => apply({ ...prefs, includeStarred: !prefs.includeStarred })}
                    className="mt-0.5 accent-[var(--accent)]"
                  />
                  <span className="min-w-0">
                    <span className="text-[13px] font-semibold text-ink">
                      {ru ? 'События из starred-списков' : 'Include events from starred lists'}
                    </span>
                    <span className="block text-[11.5px] leading-snug text-muted">
                      {ru
                        ? 'По умолчанию — только отслеживаемые списки и люди из подписок.'
                        : 'By default, the feed shows lists you watch and people you follow.'}
                    </span>
                  </span>
                </label>
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-border px-3.5 py-2.5">
                <button
                  type="button"
                  onClick={() => apply(DEFAULT_PREFS)}
                  className="rounded-md px-2.5 py-1.5 text-[12.5px] font-semibold text-ink-2 hover:text-ink"
                >
                  {ru ? 'Сбросить' : 'Reset to default'}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-semibold text-white hover:opacity-90"
                >
                  OK
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
