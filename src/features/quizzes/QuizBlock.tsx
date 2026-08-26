'use client'

import { useState, useTransition } from 'react'
import { Check, ChevronDown, ChevronUp, GraduationCap, RotateCcw, X } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { submitQuiz } from './actions'
import type { QuizState } from './queries'
import { Button } from '@/shared/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { blankCount, blankParts, gradeBlank, gradeMatch, gradeNumber, gradeSort, gradeText, matchRights, shuffleSort, quizKind, type QuizBlockContent } from '@/core'
import { cardClass } from '@/shared/ui/card-style'
import { Spinner } from '@/shared/ui/Spinner'
import { Input } from '@/shared/ui/input'

/** Quiz-блок на странице списка (как на Stepik). Типы: choice (выбор), text
 *  (короткий ответ), number (число с допуском).
 *  - Авторизованный: оценка на СЕРВЕРЕ, попытка сохраняется; ответы не приходят в
 *    разметку, раскрываются только после отправки.
 *  - Аноним: клиентская самопроверка (ответы в content), без сохранения.
 *
 *  РЕЖИМ РАЗМЕТКИ И ПРАВО ОТВЕЧАТЬ — РАЗНЫЕ ВЕЩИ. Раньше оба выводились из одного
 *  canSubmit, и на снимке прошлой версии авторизованный зритель проваливался в
 *  анонимный режим: разметка приходила БЕЗ ответов (их вырезает stripQuizAnswers), а
 *  клиентская проверка их как раз и ждёт — «нет ответа для проверки», пустые match и
 *  sort (P2 из авто-ревью #584). Поэтому режим берётся из answersStripped (пришли ли
 *  ответы), а canSubmit отвечает только за «можно ли отправлять». */
export function QuizBlock({
  content,
  lang,
  templateId,
  bid,
  canSubmit,
  answersStripped,
  initial,
}: {
  content: QuizBlockContent
  lang: Lang
  templateId: string
  bid: string
  /** Можно ли отправить ответ (на снимке прошлой версии — нельзя). */
  canSubmit: boolean
  /** Пришла ли разметка БЕЗ ответов (stripQuizAnswers). По умолчанию — как раньше:
   *  выводим из canSubmit, чтобы вызывающие без этого пропа вели себя по-старому. */
  answersStripped?: boolean
  initial: QuizState
}) {
  const ru = lang === 'ru'
  const kind = quizKind(content)
  const multi = content.multi === true
  // Клиентская самопроверка возможна ТОЛЬКО когда ответы реально пришли в разметку.
  const clientMode = !(answersStripped ?? canSubmit)
  // Только чтение: смотрим снимок прошлой версии/ветки — отвечать некуда.
  const readOnly = !canSubmit && (answersStripped ?? false)

  const nBlanks = blankCount(content.template ?? '')
  // match: левые/правые части (у авторизованного — из stripped lefts/rights; у анонима — из pairs).
  const matchLefts = clientMode ? (content.pairs ?? []).map((p) => p.left) : (content.lefts ?? [])
  const matchRightOpts = clientMode ? matchRights(content.pairs ?? []) : (content.rights ?? [])
  // sort: элементы для расстановки (перемешанные). У анонима — из content.items,
  // у авторизованного — из content.shuffled (эталон-порядок не приходит).
  const sortStart = clientMode ? shuffleSort(content.items ?? []) : (content.shuffled ?? [])
  const [picked, setPicked] = useState<Set<string>>(() => new Set(initial.selected))
  const [textInput, setTextInput] = useState(() => (kind === 'text' || kind === 'number' || kind === 'code' ? (initial.selected[0] ?? '') : ''))
  const [blankInputs, setBlankInputs] = useState<string[]>(() => Array.from({ length: nBlanks }, (_, i) => initial.selected[i] ?? ''))
  const [matchPick, setMatchPick] = useState<string[]>(() => Array.from({ length: matchLefts.length }, (_, i) => initial.selected[i] ?? ''))
  const [sortOrder, setSortOrder] = useState<string[]>(() => (initial.submitted && initial.selected.length ? initial.selected : sortStart))
  const [checked, setChecked] = useState(initial.submitted)
  const [serverCorrect, setServerCorrect] = useState<string[] | null>(null)
  const [reveal, setReveal] = useState<string | null>(null)
  const [ok, setOk] = useState(initial.correct)
  const [attempts, setAttempts] = useState(initial.attempts)
  const [err, setErr] = useState<string | null>(null)
  const [pending, start] = useTransition()

  // choice: множество верных вариантов (у анонима — из content, у авторизованного — с сервера после отправки).
  const clientCorrect = new Set((content.options ?? []).filter((o) => o.correct).map((o) => o.id))
  const correctSet = clientMode ? clientCorrect : new Set(serverCorrect ?? [])
  const revealCorrect = checked && (clientMode || correctSet.size > 0)

  const clientHasAnswer =
    kind === 'text'
      ? (content.accept?.length ?? 0) > 0
      : kind === 'number'
        ? typeof content.answer === 'number'
        : kind === 'blank'
          ? (content.blanks?.length ?? 0) > 0
          : kind === 'match'
            ? (content.pairs?.length ?? 0) > 0
            : kind === 'code'
              ? (content.accept?.length ?? 0) > 0
              : kind === 'sort'
                ? (content.items?.length ?? 0) > 0 || sortStart.length > 0
                : clientCorrect.size > 0
  const hasInput =
    kind === 'choice'
      ? picked.size > 0
      : kind === 'blank'
        ? nBlanks > 0 && blankInputs.every((b) => b.trim() !== '')
        : kind === 'match'
          ? matchLefts.length > 0 && matchPick.every((m) => m !== '')
          : kind === 'sort'
            ? sortOrder.length > 0
            : textInput.trim() !== ''

  function toggle(id: string) {
    if (checked || pending) return
    setPicked((prev) => {
      if (multi) {
        const next = new Set(prev)
        next.has(id) ? next.delete(id) : next.add(id)
        return next
      }
      return new Set([id])
    })
  }

  function localGrade(): boolean {
    if (kind === 'text' || kind === 'code') return gradeText(textInput, content.accept ?? [], content.caseSensitive)
    if (kind === 'number') return gradeNumber(Number(textInput), content.answer ?? NaN, content.tolerance)
    if (kind === 'blank') return gradeBlank(blankInputs, content.blanks ?? [], content.caseSensitive)
    if (kind === 'match') return gradeMatch(matchPick, content.pairs ?? [], content.caseSensitive)
    if (kind === 'sort') return gradeSort(sortOrder, content.items ?? [], content.caseSensitive)
    return picked.size === clientCorrect.size && [...picked].every((id) => clientCorrect.has(id))
  }

  function moveSort(i: number, d: -1 | 1) {
    const j = i + d
    if (j < 0 || j >= sortOrder.length) return
    setSortOrder((xs) => {
      const next = [...xs]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  function check() {
    // Снимок прошлой версии: отвечать нельзя НИ КНОПКОЙ, НИ ENTER'ом. Кнопку мы прячем,
    // но поле ввода отправляло по Enter прямо сюда — и ответ уходил в submitQuiz, который
    // оценивает по ТЕКУЩЕЙ версии и переписывает живую попытку (P1 из авто-ревью).
    if (readOnly) return
    setErr(null)
    if (clientMode) {
      setOk(localGrade())
      setChecked(true)
      return
    }
    start(async () => {
      const answer =
        kind === 'choice'
          ? { options: [...picked] }
          : kind === 'blank'
            ? { blanks: blankInputs }
            : kind === 'match'
              ? { match: matchPick }
              : kind === 'sort'
                ? { order: sortOrder }
                : { text: textInput }
      const res = await submitQuiz(templateId, bid, answer)
      if ('error' in res) {
        setErr(res.error === 'no_answer' ? (ru ? 'У теста не задан верный ответ.' : 'No correct answer is set.') : ru ? 'Не удалось отправить.' : 'Could not submit.')
        return
      }
      setOk(res.ok)
      setServerCorrect(res.correctIds)
      setReveal(res.reveal ?? null)
      setAttempts(res.attempts)
      setChecked(true)
    })
  }

  function reset() {
    setPicked(new Set())
    setTextInput('')
    setBlankInputs(Array.from({ length: nBlanks }, () => ''))
    setMatchPick(Array.from({ length: matchLefts.length }, () => ''))
    setSortOrder(sortStart)
    setChecked(false)
    setServerCorrect(null)
    setReveal(null)
    setErr(null)
  }

  // Текст «верного ответа» после проверки (когда неверно).
  const revealText = clientMode
    ? kind === 'text' || kind === 'code'
      ? (content.accept ?? []).join(' / ')
      : kind === 'number'
        ? String(content.answer ?? '')
        : kind === 'sort'
          ? (content.items ?? []).join(' → ')
          : kind === 'blank'
            ? (content.blanks ?? []).map((b) => b[0] ?? '').join(', ')
            : kind === 'match'
            ? (content.pairs ?? []).map((p) => `${p.left} → ${p.right}`).join('; ')
            : ''
    : (reveal ?? '')

  return (
    <div className={cardClass()}>
      <div className="mb-2.5 flex items-center gap-2">
        <GraduationCap size={15} className="shrink-0 text-accent" />
        {/* Вопрос пишет автор списка, длина не ограничена — без переноса блок уносит страницу. */}
        <span className="min-w-0 text-body-lg font-semibold text-ink [overflow-wrap:anywhere]">{content.question || (ru ? 'Тест' : 'Quiz')}</span>
      </div>

      {kind === 'choice' && (
        <div className="flex flex-col gap-1.5">
          {(content.options ?? []).map((o) => {
            const sel = picked.has(o.id)
            const showRight = revealCorrect && correctSet.has(o.id)
            const showWrong = revealCorrect && sel && !correctSet.has(o.id)
            return (
              <button
                key={o.id}
                type="button"
                disabled={checked || pending || readOnly}
                onClick={() => toggle(o.id)}
                // eslint-disable-next-line no-restricted-syntax -- карточка варианта ответа: высота от содержимого
                className={`flex items-center gap-2.5 rounded-md border px-3 py-2 text-left text-body transition-colors ${
                  showRight ? 'border-ok bg-ok/10' : showWrong ? 'border-danger bg-danger/10' : sel ? 'border-accent' : 'border-border'
                } ${checked ? 'cursor-default' : 'hover:border-border-strong'}`}
              >
                <span
                  className={`grid h-4 w-4 shrink-0 place-items-center border text-transparent ${multi ? 'rounded' : 'rounded-full'} ${
                    sel ? 'border-accent bg-accent text-primary-fg' : 'border-border-strong'
                  }`}
                >
                  {sel && <Check size={11} />}
                </span>
                <span className="min-w-0 flex-1 text-ink [overflow-wrap:anywhere]">{o.text}</span>
                {showRight && <Check size={15} className="shrink-0 text-ok" />}
                {showWrong && <X size={15} className="shrink-0 text-danger" />}
              </button>
            )
          })}
        </div>
      )}

      {(kind === 'text' || kind === 'number') && (
        <Input
          type="text"
          inputMode={kind === 'number' ? 'decimal' : 'text'}
          disabled={checked || pending || readOnly}
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && hasInput && !checked) {
              e.preventDefault()
              check()
            }
          }}
          placeholder={kind === 'number' ? (ru ? 'Ваш ответ (число)' : 'Your answer (number)') : ru ? 'Ваш ответ' : 'Your answer'}
          className={checked ? (ok ? 'border-ok bg-ok/10' : 'border-danger bg-danger/10') : undefined}
        />
      )}

      {kind === 'code' && (
        <textarea
          disabled={checked || pending || readOnly}
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          rows={4}
          placeholder={ru ? 'Ваш код' : 'Your code'}
          className={`w-full resize-y rounded-md border px-3 py-2 font-mono text-body-sm text-ink outline-hidden ${
            checked ? (ok ? 'border-ok bg-ok/10' : 'border-danger bg-danger/10') : 'border-border bg-surface-2 focus:border-border-strong'
          }`}
        />
      )}

      {kind === 'sort' && (
        <div className="flex flex-col gap-1.5">
          {/* key — сам элемент: список переупорядочивается, ключ с индексом «прыгал» бы при каждом сдвиге. */}
          {sortOrder.map((it2, i) => (
            <div key={it2} className={`flex items-center gap-2 rounded-md border px-3 py-2 text-body ${checked ? (ok ? 'border-ok bg-ok/10' : 'border-danger bg-danger/10') : 'border-border bg-surface-2'}`}>
              <span className="w-4 shrink-0 text-right font-mono text-caption text-muted">{i + 1}</span>
              <span className="min-w-0 flex-1 text-ink">{it2}</span>
              {!checked && (
                <span className="flex shrink-0 flex-col">
                  <button type="button" onClick={() => moveSort(i, -1)} disabled={i === 0 || readOnly} className="text-muted hover:text-ink disabled:opacity-20" aria-label="up"><ChevronUp size={14} /></button>
                  <button type="button" onClick={() => moveSort(i, 1)} disabled={i === sortOrder.length - 1 || readOnly} className="text-muted hover:text-ink disabled:opacity-20" aria-label="down"><ChevronDown size={14} /></button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {kind === 'blank' && (
        <p className={`text-body-lg leading-8 text-ink ${checked ? (ok ? 'text-ok' : '') : ''}`}>
          {blankParts(content.template ?? '').map((part, i) => (
            <span key={i}>
              {part}
              {i < nBlanks && (
                <Input
                  type="text"
                  size="sm"
                  disabled={checked || pending || readOnly}
                  value={blankInputs[i] ?? ''}
                  onChange={(e) => setBlankInputs((xs) => xs.map((v, xi) => (xi === i ? e.target.value : v)))}
                  aria-label={`${ru ? 'Пропуск' : 'Blank'} ${i + 1}`}
                  className={`mx-1 inline-block w-28 ${checked ? (ok ? 'border-ok bg-ok/10' : 'border-danger bg-danger/10') : ''}`}
                />
              )}
            </span>
          ))}
        </p>
      )}

      {kind === 'match' && (
        <div className="flex flex-col gap-2">
          {matchLefts.map((left, i) => {
            // Подсветка после проверки доступна только когда эталон у клиента (аноним).
            const rowGood = checked && content.pairs ? matchPick[i] === content.pairs[i]?.right : undefined
            return (
              <div key={i} className="flex items-center gap-2 text-body">
                <span className="min-w-0 flex-1 truncate text-ink">{left}</span>
                <span className="shrink-0 text-muted">→</span>
                <div className="w-[45%] shrink-0">
                  <Select value={matchPick[i] || undefined} onValueChange={(v) => setMatchPick((xs) => xs.map((m, xi) => (xi === i ? v : m)))} disabled={checked || pending || readOnly}>
                    <SelectTrigger className={rowGood === true ? 'border-ok' : rowGood === false ? 'border-danger' : ''}>
                      <SelectValue placeholder={ru ? 'выбрать…' : 'pick…'} />
                    </SelectTrigger>
                    <SelectContent>
                      {matchRightOpts.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        {readOnly ? (
          // Снимок прошлой версии: отвечать некуда — вместо кнопки честная подпись.
          <span className="text-body-sm text-muted">{t('quizSnapshotReadOnly', lang)}</span>
        ) : !checked ? (
          <Button variant="primary" disabled={!hasInput || pending || (clientMode && !clientHasAnswer)} onClick={check}>
            {pending && <Spinner size="sm" />}
            {ru ? 'Проверить' : 'Check'}
          </Button>
        ) : (
          <>
            <span className={`inline-flex items-center gap-1.5 text-body font-medium ${ok ? 'text-ok' : 'text-danger'}`}>
              {ok ? <Check size={15} /> : <X size={15} />}
              {ok ? (ru ? 'Верно' : 'Correct') : ru ? 'Неверно' : 'Incorrect'}
            </span>
            {!clientMode && attempts > 1 && <span className="text-caption text-muted">{ru ? `попытка ${attempts}` : `attempt ${attempts}`}</span>}
            <button type="button" onClick={reset} className="ml-auto inline-flex items-center gap-1 text-body-sm text-muted hover:text-ink">
              <RotateCcw size={13} /> {ru ? 'Заново' : 'Retry'}
            </button>
          </>
        )}
        {!checked && (multi || (clientMode && !clientHasAnswer)) && (
          <span className="text-caption text-muted">
            {clientMode && !clientHasAnswer ? (ru ? 'нет ответа для проверки' : 'no answer set') : ru ? 'выберите все верные' : 'select all correct'}
          </span>
        )}
      </div>

      {/* Верный ответ (text/number) — когда ответ неверный. */}
      {checked && !ok && kind !== 'choice' && revealText && (
        <p className="mt-2 text-body-sm text-ink-2">
          {ru ? 'Верный ответ: ' : 'Correct answer: '}
          <span className="font-medium text-ink">{revealText}</span>
        </p>
      )}

      {err && <p className="mt-2 text-body-sm text-danger">{err}</p>}

      {checked && content.explain && (
        <p className="mt-2.5 rounded-md border border-border bg-surface-2 px-3 py-2 text-body-sm leading-relaxed text-ink-2">{content.explain}</p>
      )}
    </div>
  )
}
