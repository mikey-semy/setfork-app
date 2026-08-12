'use client'

import { useRef, useState, useTransition } from 'react'
import type { Lang } from '@/shared/i18n'
import { ActivityGraph } from './ActivityGraph'
import { ContributionActivity } from './ContributionActivity'
import { loadDayActivity } from './actions'
import type { ActivityTopic, DayKey } from './types'

/**
 * Календарь вкладов и лента активности под ним — одна связка: клетка календаря
 * это фильтр ленты, а не только подсказка с числом.
 *
 * Выбранный день живёт в состоянии страницы, адрес профиля от него не меняется
 * (так же ведёт себя календарь GitHub), поэтому день подтягивается отдельным
 * серверным вызовом, а не переходом. Ответы кэшируются: возврат на уже
 * смотренный день мгновенный и без запроса.
 */
export function ActivitySection({
  handle,
  lang,
  contributions,
  received,
  graphYear,
  graphYears,
  monthStart,
  monthTopics,
  activityNav,
}: {
  handle: string
  lang: Lang
  contributions: { date: string; count: number }[]
  received: { stars: number; forks: number }
  graphYear?: number
  graphYears: number[]
  monthStart: Date
  monthTopics: ActivityTopic[]
  activityNav?: { prev: string | null; next: string | null }
}) {
  const [day, setDay] = useState<DayKey | null>(null)
  const [dayTopics, setDayTopics] = useState<ActivityTopic[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [pending, startTransition] = useTransition()
  const cache = useRef(new Map<DayKey, ActivityTopic[]>())
  // Какой день ждём сейчас: по быстрым кликам ответы возвращаются вперемешку, и
  // без этой сверки лента могла показать день, который уже не выбран.
  const wanted = useRef<DayKey | null>(null)

  const load = (key: DayKey) => {
    setFailed(false)
    wanted.current = key
    startTransition(async () => {
      try {
        const topics = await loadDayActivity(handle, key)
        cache.current.set(key, topics)
        if (wanted.current === key) setDayTopics(topics)
      } catch {
        if (wanted.current === key) setFailed(true)
      }
    })
  }

  const reset = () => {
    wanted.current = null
    setDay(null)
    setDayTopics(null)
    setFailed(false)
  }

  const select = (key: DayKey) => {
    if (key === day) return reset() // повторный клик по клетке снимает фильтр
    setDay(key)
    setFailed(false)
    const cached = cache.current.get(key)
    setDayTopics(cached ?? null)
    if (cached) wanted.current = key
    else load(key)
  }

  return (
    <>
      <ActivityGraph
        contributions={contributions}
        starsReceived={received.stars}
        forksReceived={received.forks}
        lang={lang}
        year={graphYear}
        years={graphYears}
        base={`/${handle}`}
        selected={day}
        onSelect={select}
      />
      <ContributionActivity
        topics={day ? (dayTopics ?? []) : monthTopics}
        monthStart={monthStart}
        day={day}
        handle={handle}
        lang={lang}
        nav={activityNav}
        loading={pending && dayTopics === null && !failed}
        failed={failed}
        onReset={reset}
        onRetry={() => day && load(day)}
      />
    </>
  )
}
