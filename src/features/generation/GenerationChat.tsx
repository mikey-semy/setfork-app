'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUp, ChevronRight, Loader2 } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import type { GenerationCandidate } from '@/shared/db'
import type { GenMessage } from '@/shared/ai/generation-messages'
import type { GenerationStatus } from './queries'
import { LIST_KINDS, kindLabel, refineHint } from '@/shared/ai/list-kind'
import { DETAIL_LEVELS, detailLabel, toDetail } from '@/shared/ai/detail-level'
import { CouncilBubble } from './CouncilBubble'
import { CandidateCard } from './CandidateCard'
import { ActionsMenu } from './ActionsMenu'
import { acceptCandidate, answerClarify, refineInChat, regenerateCandidate, setGenerationDetail, setGenerationKind } from './actions'

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
function CouncilTrail({ messages, lang, defaultOpen, avatars }: { messages: GenMessage[]; lang: Lang; defaultOpen: boolean; avatars: Record<string, string> }) {
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

interface Props {
  generationId: string
  lang: Lang
  candidates: GenerationCandidate[]
  status: GenerationStatus
  messages: GenMessage[]
  /** Тип списка (ADR-0010) — подсвечиваем в переключателе; null у старых генераций. */
  listKind: string | null
  /** Объём (short/normal/detailed); null у старых генераций → обычный. */
  detail: string | null
  /** id → своя картинка эксперта (сменили в админке). Нет записи → встроенная по who. */
  avatars: Record<string, string>
  error?: string
  clarifyQuestions?: string[]
}

export function GenerationChat({ generationId, lang, candidates, status, messages, listKind, detail, avatars, error, clarifyQuestions }: Props) {
  const detailNow = toDetail(detail)
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
    // 1040px, не 720: на десктопе половина экрана пустовала (фидбек владельца).
    <div className="mx-auto flex min-h-[calc(100dvh-53px)] w-full max-w-[1040px] flex-col px-4 py-4 sm:px-6">
      {/* Переключатель типа списка (ADR-0010): не тот тип? — жми, будет новый вариант в нужной форме.
          Дешевле и без трения, чем уточняющий вопрос; каждый клик — сигнал, что автоугадывание промахнулось.
          На узком — горизонтальный скролл, на sm+ — перенос строк: пилюли не должны уходить за экран. */}
      <div className="no-scrollbar -mx-4 mb-4 flex items-center gap-1.5 overflow-x-auto px-4 sm:-mx-6 sm:flex-wrap sm:overflow-x-visible sm:px-6">
        {LIST_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => k !== listKind && start(() => setGenerationKind(generationId, k))}
            disabled={working}
            className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-[12px] transition-colors disabled:opacity-40 ${
              k === listKind ? 'border-(--accent) bg-(--accent-soft) text-accent' : 'border-border text-ink-2 hover:text-ink'
            }`}
          >
            {kindLabel(k, ru)}
          </button>
        ))}
        <span className="mx-1 h-4 w-px shrink-0 bg-border" />
        {/* Объём — вторая ось рядом с типом: «слишком куце / слишком много» лечится одним
            кликом, новый вариант приходит в ленту, старые остаются для сравнения. */}
        {DETAIL_LEVELS.map((lv) => (
          <button
            key={lv}
            type="button"
            onClick={() => lv !== detailNow && start(() => setGenerationDetail(generationId, lv))}
            disabled={working}
            className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-[12px] transition-colors disabled:opacity-40 ${
              lv === detailNow ? 'border-(--accent) bg-(--accent-soft) text-accent' : 'border-border text-ink-2 hover:text-ink'
            }`}
          >
            {detailLabel(lv, ru)}
          </button>
        ))}
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
                  {/* Кап 640px: на широком контейнере пузырь на 85% превращался в строку во весь экран. */}
                  <div className="w-fit max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-[13.5px] leading-[1.5] text-primary-fg sm:max-w-[640px]">
                    {m.kind === 'again' ? say('Another variant', 'Ещё вариант') : m.text}
                  </div>
                </div>
              ))}
              {/* Ход совета — второстепенное: свёрнут, когда виток уже отработал. Пока идёт — раскрыт. */}
              {trail.length > 0 && <CouncilTrail messages={trail} lang={lang} defaultOpen={!cand && !failed} avatars={avatars} />}
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
                  <CandidateCard cand={cand} selected={cand.id === selId} onSelect={() => setSelId(cand.id)} lang={lang} />
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

      {/* Дополнить прямо здесь: реплика уходит в нить, следующий вариант учитывает ВСЮ беседу.
          Действия с вариантами — меню слева от поля: раньше висели липким баром наверху,
          и к ним приходилось скроллить от поля ввода (фидбек владельца). */}
      <div data-sticky-input className="sticky bottom-0 -mx-4 mt-4 border-t border-border bg-canvas/85 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex items-end gap-2">
          <ActionsMenu
            candidates={candidates}
            selId={selId}
            working={working}
            lang={lang}
            onPick={setSelId}
            onAccept={() => selId && start(() => acceptCandidate(generationId, selId))}
            onRegen={() => start(() => regenerateCandidate(generationId))}
          />
          {/* Плейсхолдер = ГОТОВОЕ сообщение (фидбек владельца: никаких «Дополни — «…»»-инструкций,
              как ghost-suggestion у Copilot/Claude): подсказка ПО ТЕМЕ от модели (hint кандидата,
              0 лишних вызовов), фолбэк — фраза по типу списка. Tab или → подхватывает её в поле.
              Короткая — чтобы НИКОГДА не пряталась/не переносилась. */}
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submitNote()
              }
              if ((e.key === 'Tab' || e.key === 'ArrowRight') && !note) {
                e.preventDefault()
                setNote(last?.hint || refineHint(listKind, ru))
              }
            }}
            rows={1}
            placeholder={last?.hint || refineHint(listKind, ru)}
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
