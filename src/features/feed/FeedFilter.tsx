'use client'

import { useEffect, useState } from 'react'
import { GitFork, Heart, ListChecks, MessageSquare, SlidersHorizontal, Star, Tag, UserPlus } from 'lucide-react'
import { OverlayPanel } from '@/shared/ui/OverlayPanel'
import { Button } from '@/shared/ui/button'
import { CheckboxRow } from '@/shared/ui/checkbox'
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
      <Button onClick={() => setOpen(true)}>
        <SlidersHorizontal size={13} /> {ru ? 'Фильтр' : 'Filter'}
      </Button>
      <OverlayPanel open={open} onClose={() => setOpen(false)} align="top" title={ru ? 'Фильтр' : 'Filter'} className="flex max-h-[70vh] flex-col">
              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="text-[0.78125rem] font-semibold text-ink">{ru ? 'События' : 'Events'}</div>
                <p className="mb-2 text-[0.6875rem] text-muted">
                  {ru ? 'Что показывать в ленте' : 'Activity you want to see on your feed'}
                </p>
                <div className="flex flex-col gap-1">
                  {EVENTS.map((e) => {
                    const Icon = e.icon
                    const [title, sub] = ru ? e.ru : e.en
                    return (
                      <CheckboxRow
                        key={e.key}
                        checked={prefs.events[e.key]}
                        onChange={() => toggle(e.key)}
                        icon={<Icon size={13} className="text-muted" />}
                        title={title}
                        sub={sub}
                      />
                    )
                  })}
                </div>
                <CheckboxRow
                  checked={prefs.includeStarred}
                  onChange={() => apply({ ...prefs, includeStarred: !prefs.includeStarred })}
                  title={ru ? 'События из starred-списков' : 'Include events from starred lists'}
                  sub={
                    ru
                      ? 'По умолчанию — только отслеживаемые списки и люди из подписок.'
                      : 'By default, the feed shows lists you watch and people you follow.'
                  }
                  className="mt-2 rounded-none border-t border-border pb-1 pt-2.5"
                />
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-border px-3.5 py-2.5">
                <Button variant="ghost" onClick={() => apply(DEFAULT_PREFS)}>
                  {ru ? 'Сбросить' : 'Reset to default'}
                </Button>
                <Button variant="primary" onClick={() => setOpen(false)} className="px-3">
                  OK
                </Button>
              </div>
      </OverlayPanel>
    </>
  )
}
