'use client'

import { useState, useTransition } from 'react'
import { Check, GraduationCap, Loader2, RotateCcw, X } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import { submitQuiz } from '@/features/quizzes/actions'
import type { QuizState } from '@/features/quizzes/queries'
import type { QuizBlockContent } from './blocks'

/** Quiz-блок на странице списка (как на Stepik).
 *  - Авторизованный (canSubmit): оценка на СЕРВЕРЕ, попытка сохраняется; верные
 *    ответы не приходят в разметку, раскрываются только после отправки.
 *  - Аноним: клиентская самопроверка (correct-флаги в content), без сохранения.
 *  Прогресс/связка с прохождением курса — следующий слайс. */
export function QuizBlock({
  content,
  lang,
  templateId,
  bid,
  canSubmit,
  initial,
}: {
  content: QuizBlockContent
  lang: Lang
  templateId: string
  bid: string
  canSubmit: boolean
  initial: QuizState
}) {
  const ru = lang === 'ru'
  const multi = content.multi === true
  const clientMode = !canSubmit // аноним → самопроверка по флагам в content

  const [picked, setPicked] = useState<Set<string>>(() => new Set(initial.selected))
  const [checked, setChecked] = useState(initial.submitted)
  // Верные варианты: у анонима — из content; у авторизованного — приходят с сервера после отправки.
  const [serverCorrect, setServerCorrect] = useState<string[] | null>(null)
  const [ok, setOk] = useState(initial.correct)
  const [attempts, setAttempts] = useState(initial.attempts)
  const [err, setErr] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const clientCorrect = new Set(content.options.filter((o) => o.correct).map((o) => o.id))
  const clientHasAnswer = clientCorrect.size > 0
  const correctSet = clientMode ? clientCorrect : new Set(serverCorrect ?? [])
  const revealCorrect = checked && (clientMode || correctSet.size > 0) // на перезагрузке серверных correctIds нет — не подсвечиваем

  function toggle(id: string) {
    if (checked || pending) return
    setPicked((prev) => {
      if (multi) {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      }
      return new Set([id])
    })
  }

  function check() {
    setErr(null)
    if (clientMode) {
      setOk(picked.size === clientCorrect.size && [...picked].every((id) => clientCorrect.has(id)))
      setChecked(true)
      return
    }
    start(async () => {
      const res = await submitQuiz(templateId, bid, [...picked])
      if ('error' in res) {
        setErr(res.error === 'no_answer' ? (ru ? 'У теста не задан верный ответ.' : 'No correct answer is set.') : ru ? 'Не удалось отправить.' : 'Could not submit.')
        return
      }
      setOk(res.ok)
      setServerCorrect(res.correctIds)
      setAttempts(res.attempts)
      setChecked(true)
    })
  }

  function reset() {
    setPicked(new Set())
    setChecked(false)
    setServerCorrect(null)
    setErr(null)
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
          const showRight = revealCorrect && correctSet.has(o.id)
          const showWrong = revealCorrect && sel && !correctSet.has(o.id)
          return (
            <button
              key={o.id}
              type="button"
              disabled={checked || pending}
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
            disabled={picked.size === 0 || pending || (clientMode && !clientHasAnswer)}
            onClick={check}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12.5px] font-medium text-primary-fg transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {pending && <Loader2 size={13} className="animate-spin" />}
            {ru ? 'Проверить' : 'Check'}
          </button>
        ) : (
          <>
            <span className={`inline-flex items-center gap-1.5 text-[13px] font-medium ${ok ? 'text-ok' : 'text-danger'}`}>
              {ok ? <Check size={15} /> : <X size={15} />}
              {ok ? (ru ? 'Верно' : 'Correct') : ru ? 'Неверно' : 'Incorrect'}
            </span>
            {!clientMode && attempts > 1 && (
              <span className="text-[11.5px] text-muted">
                {ru ? `попытка ${attempts}` : `attempt ${attempts}`}
              </span>
            )}
            <button type="button" onClick={reset} className="ml-auto inline-flex items-center gap-1 text-[12px] text-muted hover:text-ink">
              <RotateCcw size={13} /> {ru ? 'Заново' : 'Retry'}
            </button>
          </>
        )}
        {!checked && (multi || (clientMode && !clientHasAnswer)) && (
          <span className="text-[11.5px] text-muted">
            {clientMode && !clientHasAnswer ? (ru ? 'нет верного ответа' : 'no correct answer set') : ru ? 'выберите все верные' : 'select all correct'}
          </span>
        )}
      </div>

      {err && <p className="mt-2 text-[12px] text-danger">{err}</p>}

      {checked && content.explain && (
        <p className="mt-2.5 rounded-md border border-border bg-surface-2 px-3 py-2 text-[12.5px] leading-relaxed text-ink-2">{content.explain}</p>
      )}
    </div>
  )
}
