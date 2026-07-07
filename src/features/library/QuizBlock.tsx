'use client'

import { useState } from 'react'
import { Check, GraduationCap, RotateCcw, X } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import type { QuizBlockContent } from './blocks'

/** Quiz-блок на странице списка: тест с самопроверкой (как на Stepik).
 *  Проверка идёт НА КЛИЕНТЕ — правильные ответы лежат в content (список всё
 *  равно форкается целиком, прятать их на сервере в v0 незачем). Прогресс не
 *  сохраняется — это отдельный слайс (runs/оценивание). */
export function QuizBlock({ content, lang }: { content: QuizBlockContent; lang: Lang }) {
  const ru = lang === 'ru'
  const multi = content.multi === true
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [checked, setChecked] = useState(false)

  const correctIds = new Set(content.options.filter((o) => o.correct).map((o) => o.id))
  const hasAnswer = correctIds.size > 0
  // Верно, если множество выбранного точно совпадает с множеством правильных.
  const isRight = picked.size === correctIds.size && [...picked].every((id) => correctIds.has(id))

  function toggle(id: string) {
    if (checked) return
    setPicked((prev) => {
      if (multi) {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      }
      return new Set([id]) // одиночный выбор — заменяем
    })
  }

  function reset() {
    setPicked(new Set())
    setChecked(false)
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-2.5 flex items-center gap-2">
        <GraduationCap size={15} className="shrink-0 text-accent" />
        <span className="text-[14.5px] font-semibold text-ink">{content.question || (ru ? 'Тест' : 'Quiz')}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {content.options.map((o) => {
          const sel = picked.has(o.id)
          const showRight = checked && o.correct
          const showWrong = checked && sel && !o.correct
          return (
            <button
              key={o.id}
              type="button"
              disabled={checked}
              onClick={() => toggle(o.id)}
              className={`flex items-center gap-2.5 rounded-md border px-3 py-2 text-left text-[13px] transition-colors ${
                showRight
                  ? 'border-ok bg-ok/10'
                  : showWrong
                    ? 'border-danger bg-danger/10'
                    : sel
                      ? 'border-accent'
                      : 'border-border'
              } ${checked ? 'cursor-default' : 'hover:border-border-strong'}`}
            >
              <span
                className={`grid h-4 w-4 shrink-0 place-items-center border text-transparent ${multi ? 'rounded' : 'rounded-full'} ${
                  sel ? 'border-accent bg-accent text-primary-fg' : 'border-border-strong'
                }`}
              >
                {sel && <Check size={11} />}
              </span>
              <span className="min-w-0 flex-1 text-ink">{o.text}</span>
              {showRight && <Check size={15} className="shrink-0 text-ok" />}
              {showWrong && <X size={15} className="shrink-0 text-danger" />}
            </button>
          )
        })}
      </div>

      <div className="mt-3 flex items-center gap-2">
        {!checked ? (
          <button
            type="button"
            disabled={picked.size === 0 || !hasAnswer}
            onClick={() => setChecked(true)}
            className="rounded-md bg-primary px-3 py-1.5 text-[12.5px] font-medium text-primary-fg transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {ru ? 'Проверить' : 'Check'}
          </button>
        ) : (
          <>
            <span className={`inline-flex items-center gap-1.5 text-[13px] font-medium ${isRight ? 'text-ok' : 'text-danger'}`}>
              {isRight ? <Check size={15} /> : <X size={15} />}
              {isRight ? (ru ? 'Верно' : 'Correct') : ru ? 'Неверно' : 'Incorrect'}
            </span>
            <button
              type="button"
              onClick={reset}
              className="ml-auto inline-flex items-center gap-1 text-[12px] text-muted hover:text-ink"
            >
              <RotateCcw size={13} /> {ru ? 'Заново' : 'Retry'}
            </button>
          </>
        )}
        {!checked && (multi || !hasAnswer) && (
          <span className="text-[11.5px] text-muted">
            {!hasAnswer ? (ru ? 'нет верного ответа' : 'no correct answer set') : ru ? 'выберите все верные' : 'select all correct'}
          </span>
        )}
      </div>

      {checked && content.explain && (
        <p className="mt-2.5 rounded-md border border-border bg-surface-2 px-3 py-2 text-[12.5px] leading-relaxed text-ink-2">{content.explain}</p>
      )}
    </div>
  )
}
