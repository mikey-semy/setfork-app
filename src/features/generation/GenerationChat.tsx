'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUp, Check, ChevronDown, ChevronRight, Loader2, RotateCw } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import type { GenerationCandidate } from '@/shared/db'
import type { GenMessage } from '@/shared/ai/generation-messages'
import type { GenerationStatus } from './queries'
import { CouncilBubble } from './CouncilBubble'
import { CandidateCard } from './CandidateCard'
import { acceptCandidate, answerClarify, refineInChat, regenerateCandidate } from './actions'

/**
 * Экран генерации — беседа, от первой реплики до результата.
 *
 * Почему так: раньше это был «лоадер, потом результат с табами вариантов», и четыре
 * взаимоисключающие ветки флагов (showGnome / showClarify / showRetry / genFailed). Теперь шелл один:
 * что бы ни происходило — это очередная реплика. Варианты не подменяют друг друга, а остаются в
 * истории: «никогда не теряю то, что генерировал».
 *
 * История живёт в БД (generation_messages), поэтому ушёл и вернулся — видишь продолжение, а не пустоту.
 */

// Пока идёт — следим часто; после DEGRADE_AFTER_MS реже. НЕ сдаёмся совсем: джоба живая, врать
// «зависло» неправильно — честнее сказать «идёт в фоне» и дождаться.
const POLL_FAST_MS = 2000
const POLL_SLOW_MS = 10_000
const DEGRADE_AFTER_MS = 2 * 60_000

/** Реплики совета — второстепенное: их сворачиваем. Реплики пользователя и карточка — нет. */
const COUNCIL_KINDS = new Set<GenMessage['kind']>(['plan', 'summon', 'seek', 'draft', 'innovate', 'critique', 'synth'])

/** Ход совета: пока виток идёт — раскрыт (это и есть лоадер), отработал — свёрнут в одну строку. */
function CouncilTrail({ messages, lang, defaultOpen }: { messages: GenMessage[]; lang: Lang; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const say = (en: string, ru: string) => (lang === 'ru' ? ru : en)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-md py-0.5 text-[11.5px] text-muted hover:text-ink-2"
      >
        <ChevronRight size={12} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
        {say(`Council: ${messages.length} lines`, `Ход совета: ${messages.length}`)}
      </button>
      {open && (
        <ol className="mt-2 flex flex-col gap-3">
          {messages.map((m) => (
            <li key={m.id} className="animate-fadein">
              <CouncilBubble who={m.who ?? undefined} name={m.name ?? undefined}>
                {m.text}
              </CouncilBubble>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/**
 * Прыжок по вариантам: на мобилке лента длинная, и доскроллить до нужного варианта — мучение.
 * Заголовки в меню, потому что «Вариант 2» ни о чём не говорит, а «Настройка CI…» — говорит.
 */
function VariantJump({
  candidates,
  lang,
  selId,
  onPick,
}: {
  candidates: GenerationCandidate[]
  lang: Lang
  selId?: string
  onPick: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const say = (en: string, ru: string) => (lang === 'ru' ? ru : en)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const jump = (c: GenerationCandidate) => {
    onPick(c.id)
    setOpen(false)
    // Выбор — не только подсветка: ещё и доводим карточку до глаз.
    document.getElementById(`cand-${c.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return (
    <div ref={ref} className="relative ml-auto">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] text-muted hover:text-ink"
      >
        {say(`Variants: ${candidates.length}`, `Вариантов: ${candidates.length}`)}
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+4px)] z-20 w-[260px] overflow-hidden rounded-md border border-border bg-surface shadow-card">
          {candidates.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => jump(c)}
              className={`flex w-full items-start gap-2 px-2.5 py-2 text-left hover:bg-surface-2 ${c.id === selId ? 'bg-surface-2' : ''}`}
            >
              <span className="mt-px shrink-0 text-[11px] tabular-nums text-muted">{c.idx}</span>
              <span className="min-w-0">
                <span className="block truncate text-[12.5px] text-ink">{c.title}</span>
                {c.summary && <span className="mt-0.5 block truncate text-[11px] text-muted">{c.summary}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface Props {
  generationId: string
  lang: Lang
  candidates: GenerationCandidate[]
  status: GenerationStatus
  messages: GenMessage[]
  error?: string
  clarifyQuestions?: string[]
}

export function GenerationChat({ generationId, lang, candidates, status, messages, error, clarifyQuestions }: Props) {
  const ru = lang === 'ru'
  const say = (en: string, rus: string) => (ru ? rus : en) // строки-аргументы, не тернар-с-литералами (i18n-lint)
  const router = useRouter()
  const [pending, start] = useTransition()

  const last = candidates[candidates.length - 1]
  const [selId, setSelId] = useState<string | undefined>(last?.id)
  const [note, setNote] = useState('')
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const [slow, setSlow] = useState(false)
  const startedAt = useRef(0) // ставим в эффекте: Date.now() в рендере — нечистый вызов

  const working = status === 'pending' || pending
  const showClarify = status === 'clarify' && !!clarifyQuestions?.length && !pending

  // Новый вариант приехал — выбираем его: обычно смотрят на свежий.
  const [seenLast, setSeenLast] = useState(last?.id)
  if (last?.id !== seenLast) {
    setSeenLast(last?.id)
    setSelId(last?.id)
  }

  // Поллинг лёгкого JSON: как только беседа/статус сдвинулись — обновляем страницу.
  // router.refresh() раньше дёргался сам по себе раз в 2.5с и перерисовывал всё; теперь он
  // срабатывает только по факту изменения.
  useEffect(() => {
    if (status !== 'pending') {
      setSlow(false)
      startedAt.current = 0
      return
    }
    if (!startedAt.current) startedAt.current = Date.now()
    let stop = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      if (stop) return
      const degraded = Date.now() - startedAt.current > DEGRADE_AFTER_MS
      setSlow(degraded)
      try {
        const r = await fetch(`/api/generate/${generationId}/live`, { cache: 'no-store' })
        if (r.ok) {
          const d: { status: GenerationStatus; messages: GenMessage[] } = await r.json()
          if (d.status !== 'pending' || d.messages.length !== messages.length) router.refresh()
        }
      } catch {
        // Сеть моргнула — не страшно, повторим на следующем тике.
      }
      if (!stop) timer = setTimeout(tick, degraded ? POLL_SLOW_MS : POLL_FAST_MS)
    }
    timer = setTimeout(tick, POLL_FAST_MS)
    return () => {
      stop = true
      clearTimeout(timer)
    }
  }, [status, generationId, messages.length, router])

  const submitNote = () => {
    const t = note.trim()
    if (!t || working) return
    setNote('')
    start(() => refineInChat(generationId, t))
  }

  const byAttempt = (n: number) => candidates.find((c) => c.idx === n)
  // Витки — по репликам И по кандидатам: кандидат без реплик (старые генерации, чужой воркер)
  // обязан остаться видимым, иначе получается «потерял то, что сгенерировал».
  const attempts = [...new Set([...messages.map((m) => m.attempt), ...candidates.map((c) => c.idx)])].sort((a, b) => a - b)
  const errText: Record<string, string> = {
    ratelimited: say('Too many requests — please wait a bit.', 'Слишком часто — подожди немного.'),
    variantcap: say('You’ve hit the 6-variant limit.', 'Достигнут предел в 6 вариантов.'),
    ai_quota: say('Monthly draft limit reached.', 'Исчерпан месячный лимит на черновики.'),
    list_quota: say('List limit reached — delete some to save this draft.', 'Достигнут лимит списков — удали ненужные.'),
    aifail: say('Could not come up with another variant.', 'Не удалось придумать ещё вариант.'),
  }

  return (
    // Контейнер минимум во весь экран под шапкой (она sticky, 53px) — иначе на коротком чате
    // sticky-поле ввода прижималось бы к концу текста, а не к низу окна, как в мессенджерах.
    <div className="mx-auto flex min-h-[calc(100dvh-53px)] w-full max-w-[720px] flex-col px-4 py-4 sm:px-6">
      {/* Действия — НАД беседой, липко. Заголовка и подзаголовка нет: чат говорит сам за себя. */}
      <div className="sticky top-0 z-10 -mx-4 mb-4 flex items-center gap-2 border-b border-border bg-canvas/85 px-4 py-2.5 backdrop-blur sm:-mx-6 sm:px-6">
        <button
          onClick={() => selId && start(() => acceptCandidate(generationId, selId))}
          disabled={!selId || working}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-[13px] font-semibold text-primary-fg disabled:opacity-40"
        >
          <Check size={14} /> {say('Use this one', 'Использовать этот')}
        </button>
        <button
          onClick={() => start(() => regenerateCandidate(generationId))}
          disabled={working || candidates.length >= 6}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-[13px] text-ink-2 hover:text-ink disabled:opacity-40"
        >
          <RotateCw size={14} /> {say('Another', 'Ещё вариант')}
        </button>
        {candidates.length > 1 && <VariantJump candidates={candidates} lang={lang} selId={selId} onPick={setSelId} />}
      </div>

      {error && errText[error] && (
        <div className="mb-3 rounded-md border border-warn/50 bg-surface px-3 py-2 text-[12.5px] text-warn">{errText[error]}</div>
      )}

      {/* Беседа. flex-1 — забирает всё свободное место, чтобы поле ввода ушло вниз окна. */}
      <ol className="flex flex-1 flex-col gap-3">
        {attempts.map((n) => {
          const mine = messages.filter((m) => m.attempt === n)
          const said = mine.filter((m) => m.kind === 'user' || m.kind === 'again')
          const trail = mine.filter((m) => COUNCIL_KINDS.has(m.kind))
          const failed = mine.some((m) => m.kind === 'error')
          const cand = byAttempt(n)
          return (
            <li key={n} className="flex flex-col gap-3">
              {said.map((m) => (
                <div key={m.id} className="flex animate-fadein justify-end">
                  <div className="w-fit max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-[13.5px] leading-[1.5] text-primary-fg">
                    {m.kind === 'again' ? say('Another variant', 'Ещё вариант') : m.text}
                  </div>
                </div>
              ))}
              {/* Ход совета — второстепенное: свёрнут, когда виток уже отработал. Пока идёт — раскрыт. */}
              {trail.length > 0 && <CouncilTrail messages={trail} lang={lang} defaultOpen={!cand && !failed} />}
              {failed && (
                <CouncilBubble who="council" name={say('Council', 'Совет')}>
                  <span className="text-warn">{say('Could not finish this one — try again.', 'Не получилось — попробуй ещё раз.')}</span>
                </CouncilBubble>
              )}
              {cand && (
                <div id={`cand-${cand.id}`} className="animate-fadein">
                  {/* «Что поменялось ключевое» — берём у самого кандидата: реплики может не быть
                      (старые генерации), а вариант обязан быть виден всегда. */}
                  {cand.summary && <div className="mb-1 pl-1 text-[11.5px] text-muted">{cand.summary}</div>}
                  <CandidateCard cand={cand} selected={cand.id === selId} onSelect={() => setSelId(cand.id)} />
                </div>
              )}
            </li>
          )
        })}

        {working && (
          <li className="animate-fadein">
            <CouncilBubble who="council" typing>
              {slow
                ? say('Still working — it runs in the background, we’ll ping you.', 'Ещё думаем — идёт в фоне, пришлём уведомление.')
                : say('Working…', 'Думаем…')}
            </CouncilBubble>
          </li>
        )}

        {showClarify && (
          <li className="animate-fadein">
            <CouncilBubble who="reporter" name={say('Reporter', 'Репортёр')}>
              {say('A couple of details and the list will be sharper.', 'Пара деталей — и список будет точнее.')}
            </CouncilBubble>
            <div className="mt-2 space-y-2 pl-[72px]">
              {(clarifyQuestions ?? []).map((q, i) => (
                <div key={i}>
                  <label className="mb-1 block text-[12.5px] text-ink-2">{q}</label>
                  <input
                    value={answers[i] ?? ''}
                    onChange={(e) => setAnswers((a) => ({ ...a, [i]: e.target.value }))}
                    className="w-full rounded-md border border-border bg-surface px-3 py-2 text-[13px] text-ink outline-hidden focus:border-border-strong"
                  />
                </div>
              ))}
              <button
                onClick={() => start(() => answerClarify(generationId, (clarifyQuestions ?? []).map((_, i) => (answers[i] ?? '').trim())))}
                disabled={pending}
                className="rounded-md bg-primary px-3.5 py-2 text-[13px] font-semibold text-primary-fg disabled:opacity-50"
              >
                {say('Send', 'Ответить')}
              </button>
            </div>
          </li>
        )}
      </ol>

      {/* Дополнить прямо здесь: реплика уходит в нить, следующий вариант учитывает ВСЮ беседу. */}
      <div className="sticky bottom-0 -mx-4 mt-4 border-t border-border bg-canvas/85 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex items-end gap-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submitNote()
              }
            }}
            rows={1}
            placeholder={say('Add a detail — “more about security”…', 'Дополни — «побольше про безопасность»…')}
            className="max-h-32 min-h-[42px] w-full resize-y rounded-2xl border border-border bg-surface px-3.5 py-2.5 text-[13.5px] text-ink outline-hidden focus:border-border-strong"
          />
          <button
            onClick={submitNote}
            disabled={!note.trim() || working}
            aria-label={say('Send', 'Отправить')}
            className="grid size-[42px] shrink-0 place-items-center rounded-full bg-primary text-primary-fg disabled:opacity-40"
          >
            {working ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={17} />}
          </button>
        </div>
      </div>
    </div>
  )
}
