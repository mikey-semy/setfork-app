'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Link2, Loader2, Pencil, RotateCw, Sparkles, X } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import type { GenerationCandidate } from '@/shared/db'
import type { CouncilEvent } from '@/shared/ai/council-progress'
import type { GenerationStatus } from './queries'
import { GnomeLoader } from './GnomeLoader'
import { safeHref } from '@/shared/lib/safe-url'
import { acceptCandidate, answerClarify, regenerateCandidate, regenerateWithQuery } from './actions'

interface Props {
  generationId: string
  query: string
  lang: Lang
  candidates: GenerationCandidate[]
  status: GenerationStatus
  initialIdx: number
  error?: string
  councilEvents?: CouncilEvent[]
  clarifyQuestions?: string[]
}

export function GenerationReview({ generationId, query, lang, candidates, status, initialIdx, error, councilEvents, clarifyQuestions }: Props) {
  const ru = lang === 'ru'
  const router = useRouter()
  const [selIdx, setSelIdx] = useState(initialIdx)
  const [prevInitial, setPrevInitial] = useState(initialIdx)
  const [pending, start] = useTransition()
  const [mode, setMode] = useState<'accept' | 'regen'>('regen')
  const [editing, setEditing] = useState(false)
  const [editQ, setEditQ] = useState(query)
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const say = (en: string, rus: string) => (ru ? rus : en) // строки-аргументы, не тернар-с-литералами (i18n-lint)

  // Смена ?v= в URL (после «ещё вариант») → выбираем этот вариант (без setState-в-эффекте).
  if (initialIdx !== prevInitial) {
    setPrevInitial(initialIdx)
    setSelIdx(initialIdx)
  }

  // Пока идёт фоновая генерация — поллим страницу, чтобы подхватить готовый кандидат.
  // Кап на поллинг: ~2 минуты (48×2.5s). Дольше = воркер завис/умер — перестаём жечь
  // запросы и показываем честное состояние «долго» с ручным повтором.
  const [stalled, setStalled] = useState(false)
  useEffect(() => {
    if (status !== 'pending') {
      setStalled(false)
      return
    }
    let ticks = 0
    const t = setInterval(() => {
      ticks += 1
      if (ticks > 48) {
        setStalled(true)
        clearInterval(t)
        return
      }
      router.refresh()
    }, 2500)
    return () => clearInterval(t)
  }, [status, router])

  const cand = candidates.find((c) => c.idx === selIdx)
  const waiting = status === 'pending' && !stalled
  const atCap = candidates.length >= 6 // синхронно с потолком в actions (idx > 6)
  const genFailed = status === 'failed'
  const acceptSpinner = pending && mode === 'accept'
  const showGnome = (pending && mode === 'regen') || (waiting && !cand)
  // Диалог: совет прислал уточняющие вопросы, кандидата ещё нет — показываем форму ответов.
  const showClarify = !!clarifyQuestions?.length && candidates.length === 0 && !waiting && !pending

  function accept() {
    if (!cand) return
    setMode('accept')
    start(() => acceptCandidate(generationId, cand.id))
  }
  function regen() {
    setMode('regen')
    start(() => regenerateCandidate(generationId))
  }
  function openEdit() {
    setEditQ(query)
    setEditing(true)
  }
  function submitEdit() {
    const q = editQ.trim()
    if (!q) return
    setEditing(false)
    setMode('regen')
    start(() => regenerateWithQuery(generationId, q))
  }
  function submitClarify() {
    setMode('regen')
    start(() => answerClarify(generationId, (clarifyQuestions ?? []).map((_, i) => (answers[i] ?? '').trim())))
  }

  return (
    <div className="mx-auto w-full max-w-[720px] px-6 py-8">
      <div className="mb-1 flex items-center gap-2 text-[18px] font-bold text-ink">
        <Sparkles size={18} className="text-accent" /> {ru ? 'Черновик' : 'Draft'}
      </div>
      <p className="mb-5 text-[13.5px] text-ink-2">
        {ru ? 'По запросу' : 'For'} <span className="font-semibold text-ink">“{query}”</span>.{' '}
        {ru
          ? 'Выбери вариант — он станет черновиком, который ты опубликуешь, когда будешь готов.'
          : 'Pick a variant — it becomes a draft you publish when ready.'}
      </p>

      {error === 'aifail' && (
        <div className="mb-4 rounded-md border border-border bg-surface px-3 py-2 text-[13px] text-danger">
          {ru ? 'Не удалось придумать ещё вариант.' : 'Could not come up with another variant.'}
        </div>
      )}
      {error === 'ratelimited' && (
        <div className="mb-4 rounded-md border border-border bg-surface px-3 py-2 text-[13px] text-warn">
          {ru ? 'Слишком часто — подожди немного.' : 'Too many requests — please wait a bit.'}
        </div>
      )}
      {error === 'variantcap' && (
        <div className="mb-4 rounded-md border border-border bg-surface px-3 py-2 text-[13px] text-warn">
          {ru
            ? 'Достигнут предел в 6 вариантов. Выбери один из готовых — или начни новую генерацию.'
            : 'You’ve hit the 6-variant limit. Pick one of the existing variants — or start a new generation.'}
        </div>
      )}
      {error === 'ai_quota' && (
        <div className="mb-4 rounded-md border border-warn/50 bg-surface px-3 py-2 text-[13px] text-warn">
          {ru ? 'Исчерпан месячный лимит на черновики.' : 'Monthly draft limit reached.'}
        </div>
      )}
      {error === 'list_quota' && (
        <div className="mb-4 rounded-md border border-warn/50 bg-surface px-3 py-2 text-[13px] text-warn">
          {ru ? 'Достигнут лимит списков — удали ненужные, чтобы сохранить черновик.' : 'List limit reached — delete some to save this draft.'}
        </div>
      )}
      {stalled && (
        <div className="mb-4 rounded-md border border-warn/50 bg-warn/10 px-3 py-2 text-[13px] text-warn">
          {ru
            ? 'Генерация занимает дольше обычного. Возможно, очередь занята — можно подождать и обновить, или попробовать ещё раз.'
            : 'Generation is taking longer than usual. The queue may be busy — refresh in a bit, or try again.'}{' '}
          <button
            type="button"
            onClick={() => {
              setStalled(false)
              router.refresh()
            }}
            className="font-semibold underline hover:text-ink"
          >
            {ru ? 'Обновить' : 'Refresh'}
          </button>
        </div>
      )}

      {/* Табы вариантов */}
      {candidates.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {candidates.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelIdx(c.idx)}
              disabled={pending}
              className={`rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
                c.idx === selIdx ? 'bg-primary text-primary-fg' : 'bg-surface-2 text-ink-2 hover:text-ink'
              }`}
            >
              {ru ? 'Вариант' : 'Variant'} {c.idx}
            </button>
          ))}
        </div>
      )}

      {/* Идёт генерация ещё одного варианта, но текущий уже виден */}
      {waiting && cand && !acceptSpinner && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-(--accent) bg-(--accent-soft) px-3 py-2 text-[12.5px] text-accent">
          <Loader2 size={13} className="animate-spin" /> {ru ? 'Придумываем ещё вариант…' : 'Drafting another variant…'}
        </div>
      )}

      {acceptSpinner ? (
        // Принятие — это не генерация: без гнома и «Profit», просто аккуратный спиннер.
        <div className="flex items-center gap-2.5 rounded-lg border border-border bg-surface px-5 py-6 text-[13.5px] text-ink-2">
          <Loader2 size={16} className="animate-spin text-accent" />
          {ru ? 'Создаём черновик…' : 'Creating your draft…'}
        </div>
      ) : showGnome ? (
        <GnomeLoader
          query={query}
          lang={lang}
          events={councilEvents}
          label={
            candidates.length === 0
              ? ru
                ? 'Придумываем черновик…'
                : 'Drafting your list…'
              : ru
                ? 'Придумываем ещё вариант…'
                : 'Drafting another variant…'
          }
        />
      ) : cand ? (
        <div className="rounded-lg border border-border bg-surface p-5">
            <div className="text-[15px] font-semibold text-ink">{cand.title}</div>
            {cand.desc && <p className="mt-1 text-[13px] text-ink-2">{cand.desc}</p>}
            {cand.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {cand.tags.map((tg) => (
                  <span key={tg} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11.5px] text-ink-2">
                    {tg}
                  </span>
                ))}
              </div>
            )}
            <ol className="mt-4 space-y-3">
              {cand.items.map((it, i) => (
                <li key={i} className="border-l-2 border-border pl-3">
                  <div className="text-[13.5px] font-medium text-ink">
                    <span className="text-muted">{i + 1}.</span> {it.title}
                  </div>
                  {it.desc && <div className="mt-0.5 text-[12.5px] text-ink-2">{it.desc}</div>}
                  {it.command && (
                    <code className="mt-1 block rounded bg-surface-2 px-2 py-1 font-mono text-[12px] text-ink">
                      {it.command}
                    </code>
                  )}
                  {it.subtasks.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {it.subtasks.map((s, j) => (
                        <li key={j} className="text-[12px] text-muted">
                          ○ {s}
                        </li>
                      ))}
                    </ul>
                  )}
                  {it.refs && it.refs.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {it.refs.map((r, k) => (
                        <a
                          key={k}
                          href={safeHref(r.url) || undefined}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded border border-border bg-surface-2 px-2 py-0.5 text-[11.5px] text-accent hover:underline"
                        >
                          <Link2 size={11} /> {r.label}
                        </a>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </div>
      ) : showClarify ? (
        <div className="rounded-lg border border-accent bg-(--accent-soft) p-5">
          <div className="mb-1 flex items-center gap-2 text-[14px] font-semibold text-accent">
            <Sparkles size={15} /> {say('A bit more detail needed', 'Нужно чуть больше деталей')}
          </div>
          <p className="mb-3 text-[12.5px] text-ink-2">
            {say('Answer to get a sharper list — or just generate as-is.', 'Ответь — список будет точнее. Или сгенерируй как есть.')}
          </p>
          <div className="space-y-3">
            {(clarifyQuestions ?? []).map((q, i) => (
              <div key={i}>
                <label className="mb-1 block text-[13px] font-medium text-ink">{q}</label>
                <input
                  value={answers[i] ?? ''}
                  onChange={(e) => setAnswers((a) => ({ ...a, [i]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      submitClarify()
                    }
                  }}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-[13.5px] text-ink outline-hidden focus:border-border-strong"
                />
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={submitClarify}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2.5 text-[13.5px] font-semibold text-primary-fg disabled:opacity-50"
            >
              <RotateCw size={15} /> {say('Answer & generate', 'Ответить и сгенерировать')}
            </button>
          </div>
        </div>
      ) : genFailed ? (
        <div className="rounded-lg border border-danger/40 bg-danger/5 px-5 py-6 text-[13.5px] text-danger">
          {ru ? 'Не удалось придумать. Попробуйте ещё раз.' : "Couldn't draft it. Please try again."}
        </div>
      ) : null}

      {/* Инлайн-правка запроса: добавляет новый вариант, прежние остаются */}
      {editing && !pending && (
        <div className="mt-4 rounded-lg border border-accent bg-(--accent-soft) p-3">
          <div className="mb-2 text-[12.5px] text-ink-2">
            {ru
              ? 'Подправь запрос — добавим новый вариант, прежние останутся.'
              : 'Tweak the query — we add a new variant, the existing ones stay.'}
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              autoFocus
              value={editQ}
              onChange={(e) => setEditQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submitEdit()
                }
              }}
              className="min-w-[240px] flex-1 rounded-md border border-border bg-surface px-3 py-2 text-[13.5px] text-ink outline-hidden focus:border-border-strong"
            />
            <button
              onClick={submitEdit}
              disabled={!editQ.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-[13px] font-semibold text-primary-fg disabled:opacity-50"
            >
              <RotateCw size={14} /> {ru ? 'Придумать' : 'Dream up'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-2 text-[13px] text-ink-2 hover:text-ink"
            >
              <X size={14} /> {ru ? 'Отмена' : 'Cancel'}
            </button>
          </div>
        </div>
      )}

      {/* Действия */}
      <div className="mt-5 flex flex-wrap items-center gap-2.5">
        <button
          onClick={accept}
          disabled={pending || !cand}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2.5 text-[13.5px] font-semibold text-primary-fg disabled:opacity-50"
        >
          <Check size={15} /> {ru ? 'Использовать этот' : 'Use this one'}
        </button>
        <button
          onClick={regen}
          disabled={pending || waiting || atCap}
          title={atCap ? (ru ? 'Достигнут предел вариантов' : 'Variant limit reached') : undefined}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-4 py-2.5 text-[13.5px] font-medium text-ink hover:border-border-strong disabled:opacity-50"
        >
          <RotateCw size={15} /> {ru ? 'Ещё вариант' : 'Another variant'}
        </button>
        <button
          type="button"
          onClick={openEdit}
          disabled={pending || waiting || atCap}
          title={atCap ? (ru ? 'Достигнут предел вариантов' : 'Variant limit reached') : undefined}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-2.5 text-[13px] text-ink-2 hover:text-ink disabled:opacity-50"
        >
          <Pencil size={14} /> {ru ? 'Изменить запрос' : 'Edit query'}
        </button>
        {atCap && (
          <span className="text-[12px] text-muted">
            {ru ? 'Предел: 6 вариантов на генерацию.' : 'Limit: 6 variants per generation.'}
          </span>
        )}
      </div>
    </div>
  )
}
