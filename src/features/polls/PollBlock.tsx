'use client'

import { useState, useTransition } from 'react'
import { BarChart3, Check, Clock, LineChart } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import { pollHistory, votePoll } from './actions'
import type { PollHistoryEvent, PollResult } from './queries'
import { PollHistoryChart } from './PollHistoryChart'

export interface PollContent {
  question: string
  options: { id: string; text: string }[]
  multi?: boolean
  deadline?: string
}

/** Poll-блок на странице списка: вопрос + варианты со счётчиками/процентами.
 *  Голосуют авторизованные до дедлайна; результаты видны после голоса/закрытия. */
export function PollBlock({
  templateId,
  bid,
  content,
  result,
  canVote,
  closed,
  lang,
}: {
  templateId: string
  bid: string
  content: PollContent
  result: PollResult
  canVote: boolean
  closed: boolean // дедлайн прошёл (считает сервер; votePoll всё равно перепроверяет)
  lang: Lang
}) {
  const ru = lang === 'ru'
  const [pending, start] = useTransition()
  const total = result.voters
  const votable = canVote && !closed && !pending
  const showResults = result.myVotes.length > 0 || closed || !canVote

  // Динамика голосов во времени (грузим по клику).
  const [histOpen, setHistOpen] = useState(false)
  const [hist, setHist] = useState<PollHistoryEvent[] | null>(null)
  const [histPending, startHist] = useTransition()
  const toggleHistory = () => {
    const next = !histOpen
    setHistOpen(next)
    if (next && hist === null) {
      startHist(async () => {
        const res = await pollHistory(templateId, bid)
        setHist('error' in res ? [] : res.events)
      })
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-2.5 flex items-center gap-2">
        <BarChart3 size={15} className="shrink-0 text-accent" />
        <span className="text-[0.875rem] font-semibold text-ink">{content.question || (ru ? 'Опрос' : 'Poll')}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {content.options.map((o) => {
          const c = result.counts[o.id] ?? 0
          const pct = total > 0 ? Math.round((c / total) * 100) : 0
          const mine = result.myVotes.includes(o.id)
          return (
            <button
              key={o.id}
              type="button"
              disabled={!votable}
              onClick={() => votable && start(() => votePoll(templateId, bid, o.id))}
              className={`relative overflow-hidden rounded-md border px-3 py-2 text-left text-[0.8125rem] transition-colors ${
                mine ? 'border-accent' : 'border-border'
              } ${votable ? 'hover:border-border-strong' : 'cursor-default'}`}
            >
              {showResults && (
                <span className="absolute inset-y-0 left-0 bg-(--accent-soft)" style={{ width: `${pct}%` }} aria-hidden />
              )}
              <span className="relative flex items-center justify-between gap-2">
                <span className="inline-flex min-w-0 items-center gap-1.5 text-ink">
                  {mine && <Check size={13} className="shrink-0 text-accent" />}
                  <span className="truncate">{o.text}</span>
                </span>
                {showResults && <span className="shrink-0 font-mono text-[0.78125rem] text-muted">{pct}% · {c}</span>}
              </span>
            </button>
          )
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.6875rem] text-muted">
        <span>
          {total} {ru ? 'голос.' : 'votes'}
        </span>
        {content.multi && <span>· {ru ? 'мультивыбор' : 'multi-select'}</span>}
        {content.deadline && (
          <span className="inline-flex items-center gap-1">
            <Clock size={11} />
            {closed ? (ru ? 'закрыт' : 'closed') : `${ru ? 'до' : 'until'} ${new Date(content.deadline).toLocaleDateString(ru ? 'ru' : 'en')}`}
          </span>
        )}
        {!canVote && <span>· {ru ? 'войдите, чтобы голосовать' : 'log in to vote'}</span>}
        {total > 0 && (
          <button type="button" onClick={toggleHistory} className="ml-auto inline-flex items-center gap-1 text-muted hover:text-accent">
            <LineChart size={12} />
            {ru ? 'динамика' : 'dynamics'}
          </button>
        )}
      </div>
      {histOpen && (
        <div className="mt-2.5 border-t border-border pt-2.5">
          {histPending || hist === null ? (
            <p className="py-2 text-center text-[0.78125rem] text-muted">{ru ? 'Загрузка…' : 'Loading…'}</p>
          ) : (
            <PollHistoryChart events={hist} options={content.options} lang={lang} />
          )}
        </div>
      )}
    </div>
  )
}
