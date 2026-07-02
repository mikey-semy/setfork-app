'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Check, Pencil, RotateCw, Sparkles } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import type { GenerationCandidate } from '@/shared/db'
import { GnomeLoader } from './GnomeLoader'
import { acceptCandidate, regenerateCandidate } from './actions'

interface Props {
  generationId: string
  query: string
  lang: Lang
  candidates: GenerationCandidate[]
  initialIdx: number
  error?: string
}

export function GenerationReview({ generationId, query, lang, candidates, initialIdx, error }: Props) {
  const ru = lang === 'ru'
  const [sel, setSel] = useState(() => {
    const found = candidates.findIndex((c) => c.idx === initialIdx)
    return found >= 0 ? found : candidates.length - 1
  })
  const [pending, start] = useTransition()
  const [mode, setMode] = useState<'accept' | 'regen'>('regen')

  const cand = candidates[sel]

  function accept() {
    if (!cand) return
    setMode('accept')
    start(() => acceptCandidate(generationId, cand.id))
  }
  function regen() {
    setMode('regen')
    start(() => regenerateCandidate(generationId))
  }

  return (
    <div className="mx-auto w-full max-w-[720px] px-6 py-8">
      <div className="mb-1 flex items-center gap-2 text-[18px] font-bold text-ink">
        <Sparkles size={18} className="text-accent" /> {ru ? 'Черновик от нейросети' : 'AI draft'}
      </div>
      <p className="mb-5 text-[13.5px] text-ink-2">
        {ru ? 'По запросу' : 'For'} <span className="font-semibold text-ink">“{query}”</span>.{' '}
        {ru
          ? 'Выбери вариант — он станет черновиком, который ты опубликуешь, когда будешь готов.'
          : 'Pick a variant — it becomes a draft you publish when ready.'}
      </p>

      {error === 'aifail' && (
        <div className="mb-4 rounded-md border border-border bg-surface px-3 py-2 text-[13px] text-[var(--danger)]">
          {ru ? 'Не удалось сгенерировать ещё вариант.' : 'Could not generate another variant.'}
        </div>
      )}
      {error === 'ratelimited' && (
        <div className="mb-4 rounded-md border border-border bg-surface px-3 py-2 text-[13px] text-[var(--warn)]">
          {ru ? 'Слишком часто — подожди немного.' : 'Too many requests — please wait a bit.'}
        </div>
      )}

      {/* Табы вариантов */}
      {candidates.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {candidates.map((c, i) => (
            <button
              key={c.id}
              onClick={() => setSel(i)}
              disabled={pending}
              className={`rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
                i === sel ? 'bg-primary text-primary-fg' : 'bg-surface-2 text-ink-2 hover:text-ink'
              }`}
            >
              {ru ? 'Вариант' : 'Variant'} {c.idx}
            </button>
          ))}
        </div>
      )}

      {pending ? (
        <GnomeLoader
          query={query}
          lang={lang}
          label={
            mode === 'accept'
              ? ru
                ? 'Создаём черновик…'
                : 'Creating your draft…'
              : ru
                ? 'Генерируем ещё вариант…'
                : 'Generating another variant…'
          }
        />
      ) : (
        cand && (
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
                </li>
              ))}
            </ol>
          </div>
        )
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
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-4 py-2.5 text-[13.5px] font-medium text-ink hover:border-border-strong disabled:opacity-50"
        >
          <RotateCw size={15} /> {ru ? 'Ещё вариант' : 'Another variant'}
        </button>
        <Link
          href={`/generate?q=${encodeURIComponent(query)}`}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-2.5 text-[13px] text-ink-2 hover:text-ink"
        >
          <Pencil size={14} /> {ru ? 'Изменить запрос' : 'Edit query'}
        </Link>
      </div>
    </div>
  )
}
