'use client'

import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { BubbleTextEditor } from '@/shared/ui/BubbleTextEditor'
import { Input } from '@/shared/ui/input'
import { Tooltip } from '@/shared/ui/Tooltip'
import { blankCount, type QuizKind } from '@/core'
import { AddLink, CheckLabel, FieldRow, Hint, LineField, RemoveBtn } from './block-fields'
import { newOptionId } from './blocks'
import type { EditorQuiz } from './editor'

/** Quiz-блок в редакторе: вопрос + ответы своего вида + пояснение.
 *  Проверка ответов живёт на странице списка, здесь только их задание. */
const QUIZ_KIND_OPTS: { k: QuizKind; ru: string; en: string }[] = [
  { k: 'choice', ru: 'Выбор', en: 'Choice' },
  { k: 'text', ru: 'Текст', en: 'Text' },
  { k: 'number', ru: 'Число', en: 'Number' },
  { k: 'blank', ru: 'Пропуски', en: 'Blanks' },
  { k: 'match', ru: 'Пары', en: 'Match' },
  { k: 'sort', ru: 'Порядок', en: 'Sort' },
  { k: 'code', ru: 'Код', en: 'Code' },
]

export function QuizBlockBody({ quiz, onChange, ru }: { quiz: EditorQuiz; onChange: (q: EditorQuiz) => void; ru: boolean }) {
  const set = (q: Partial<EditorQuiz>) => onChange({ ...quiz, ...q })
  // Пометка «верный» эксклюзивна, пока не включено «несколько верных».
  const toggleCorrect = (oi: number) =>
    set({ options: quiz.options.map((x, xi) => (xi === oi ? { ...x, correct: !x.correct } : quiz.multi ? x : { ...x, correct: false })) })
  const caseBox = (
    <CheckLabel checked={quiz.caseSensitive} onChange={(caseSensitive) => set({ caseSensitive })}>
      {ru ? 'Учитывать регистр' : 'Case-sensitive'}
    </CheckLabel>
  )
  const accept = quiz.accept.length ? quiz.accept : ['']
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3">
      {/* Тип теста */}
      <div className="flex items-center gap-1 self-start rounded-md border border-border bg-surface p-0.5 text-[0.78125rem]">
        {QUIZ_KIND_OPTS.map((o) => (
          <button
            key={o.k}
            type="button"
            onClick={() => set({ kind: o.k })}
            className={`rounded px-2.5 py-1 ${quiz.kind === o.k ? 'bg-surface-2 font-medium text-ink' : 'text-ink-2 hover:text-ink'}`}
          >
            {ru ? o.ru : o.en}
          </button>
        ))}
      </div>

      <LineField value={quiz.question} onChange={(question) => set({ question })} ru={ru} className="" label={ru ? 'Вопрос теста' : 'Quiz question'} />

      {quiz.kind === 'choice' && (
        <>
          <div className="flex flex-col gap-1.5">
            {quiz.options.map((o, oi) => (
              <div key={o.id} className="flex items-center gap-2">
                <Tooltip label={o.correct ? (ru ? 'Верный ответ' : 'Correct answer') : ru ? 'Отметить верным' : 'Mark correct'}>
                  <button
                    type="button"
                    onClick={() => toggleCorrect(oi)}
                    aria-pressed={o.correct}
                    aria-label={ru ? 'Отметить верным' : 'Mark correct'}
                    className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border transition-colors ${
                      o.correct ? 'border-ok bg-ok/15 text-ok' : 'border-border-strong text-transparent hover:border-ok'
                    }`}
                  >
                    <Check size={13} />
                  </button>
                </Tooltip>
                <LineField value={o.text} onChange={(v) => set({ options: quiz.options.map((x, xi) => (xi === oi ? { ...x, text: v } : x)) })} ru={ru} label={ru ? `Вариант ${oi + 1}` : `Option ${oi + 1}`} />
                <RemoveBtn onClick={() => set({ options: quiz.options.filter((_, xi) => xi !== oi) })} disabled={quiz.options.length <= 2} label={ru ? 'Удалить вариант' : 'Remove option'} />
              </div>
            ))}
          </div>
          <FieldRow>
            <AddLink onClick={() => set({ options: [...quiz.options, { id: newOptionId(), text: '', correct: false }] })}>
              {ru ? 'вариант' : 'option'}
            </AddLink>
            <CheckLabel checked={quiz.multi} onChange={(multi) => set({ multi })}>
              {ru ? 'Несколько верных' : 'Multiple correct'}
            </CheckLabel>
          </FieldRow>
        </>
      )}

      {(quiz.kind === 'text' || quiz.kind === 'code') && (
        <>
          {quiz.kind === 'code' && (
            <Hint>
              {ru
                ? 'Ответ вводится моноширинно; сверяется с принимаемыми (регистр обычно важен).'
                : 'Answer is entered monospace; matched against accepted (case usually matters).'}
            </Hint>
          )}
          <div className="flex flex-col gap-1.5">
            {accept.map((a, ai) => (
              <div key={ai} className="flex items-center gap-2">
                <span className="w-4 text-right text-[0.6875rem] text-muted">✓</span>
                <LineField value={a} onChange={(v) => set({ accept: accept.map((x, xi) => (xi === ai ? v : x)) })} ru={ru} label={ru ? `Принимаемый ответ ${ai + 1}` : `Accepted answer ${ai + 1}`} />
                <RemoveBtn onClick={() => set({ accept: accept.filter((_, xi) => xi !== ai) })} disabled={accept.length <= 1} label={ru ? 'Удалить ответ' : 'Remove answer'} />
              </div>
            ))}
          </div>
          <FieldRow>
            <AddLink onClick={() => set({ accept: [...accept, ''] })}>{ru ? 'вариант ответа' : 'accepted answer'}</AddLink>
            {caseBox}
          </FieldRow>
          <Hint>
            {ru
              ? 'Любой из принимаемых ответов засчитывается (пробелы/регистр нормализуются).'
              : 'Any accepted answer counts (whitespace/case normalized).'}
          </Hint>
        </>
      )}

      {quiz.kind === 'number' && (
        <div className="flex flex-wrap items-end gap-3 text-[0.78125rem]">
          {[
            { caption: ru ? 'Верный ответ' : 'Correct answer', aria: ru ? 'Числовой ответ' : 'Numeric answer', ph: '42', width: 'w-32', value: quiz.answer, put: (answer: string) => set({ answer }) },
            { caption: ru ? 'Допуск ±' : 'Tolerance ±', aria: ru ? 'Допуск' : 'Tolerance', ph: '0', width: 'w-24', value: quiz.tolerance, put: (tolerance: string) => set({ tolerance }) },
          ].map((f) => (
            <label key={f.aria} className="flex flex-col gap-1 text-ink-2">
              {f.caption}
              <Input className={f.width} inputMode="decimal" aria-label={f.aria} placeholder={f.ph} value={f.value} onChange={(e) => f.put(e.target.value)} />
            </label>
          ))}
        </div>
      )}

      {quiz.kind === 'blank' && (() => {
        const n = blankCount(quiz.template)
        return (
          <>
            <textarea
              className="min-h-[3.25rem] w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-[0.8125rem] leading-relaxed text-ink outline-hidden focus:border-border-strong"
              aria-label={ru ? 'Текст с пропусками' : 'Text with blanks'}
              placeholder={ru ? 'Текст с пропусками. Пишите ___ там, где пропуск.' : 'Text with blanks. Write ___ where a blank goes.'}
              value={quiz.template}
              onChange={(e) => set({ template: e.target.value })}
            />
            {n === 0 ? (
              <Hint>{ru ? 'Добавьте ___ в текст, чтобы задать пропуски.' : 'Add ___ to the text to create blanks.'}</Hint>
            ) : (
              <div className="flex flex-col gap-1.5">
                {Array.from({ length: n }, (_, bi) => (
                  <div key={bi} className="flex items-center gap-2">
                    <span className="w-5 shrink-0 text-right font-mono text-[0.6875rem] text-muted">#{bi + 1}</span>
                    <LineField
                      value={quiz.blanks[bi] ?? ''}
                      onChange={(v) => set({ blanks: Array.from({ length: n }, (_, i) => (i === bi ? v : quiz.blanks[i] ?? '')) })}
                      ru={ru}
                      label={ru ? `Ответы для пропуска ${bi + 1}` : `Answers for blank ${bi + 1}`}
                      placeholder={ru ? 'Принимаемые ответы через запятую' : 'Accepted answers, comma-separated'}
                    />
                  </div>
                ))}
              </div>
            )}
            <div className="self-start text-[0.78125rem]">{caseBox}</div>
          </>
        )
      })()}

      {quiz.kind === 'match' && (() => {
        const pairs = quiz.pairs.length ? quiz.pairs : [{ left: '', right: '' }, { left: '', right: '' }]
        const setPairs = (p: { left: string; right: string }[]) => set({ pairs: p })
        const patchPair = (pi: number, side: 'left' | 'right', v: string) =>
          setPairs(pairs.map((x, xi) => (xi === pi ? { ...x, [side]: v } : x)))
        return (
          <>
            <div className="flex flex-col gap-1.5">
              {pairs.map((p, pi) => (
                <div key={pi} className="flex items-center gap-2">
                  <LineField value={p.left} onChange={(v) => patchPair(pi, 'left', v)} ru={ru} label={ru ? `Слева ${pi + 1}` : `Left ${pi + 1}`} placeholder={ru ? 'Слева' : 'Left'} />
                  <span className="shrink-0 text-muted">→</span>
                  <LineField value={p.right} onChange={(v) => patchPair(pi, 'right', v)} ru={ru} label={ru ? `Справа ${pi + 1}` : `Right ${pi + 1}`} placeholder={ru ? 'Справа' : 'Right'} />
                  <RemoveBtn onClick={() => setPairs(pairs.filter((_, xi) => xi !== pi))} disabled={pairs.length <= 2} label={ru ? 'Удалить пару' : 'Remove pair'} />
                </div>
              ))}
            </div>
            <FieldRow>
              <AddLink onClick={() => setPairs([...pairs, { left: '', right: '' }])}>{ru ? 'пара' : 'pair'}</AddLink>
              {caseBox}
            </FieldRow>
            <Hint>{ru ? 'Правые части ученику показываются перемешанными.' : 'Right sides are shuffled for the learner.'}</Hint>
          </>
        )
      })()}

      {quiz.kind === 'sort' && (() => {
        const items = quiz.items.length ? quiz.items : ['', '']
        const setItems = (xs: string[]) => set({ items: xs })
        const move = (i: number, d: -1 | 1) => {
          const j = i + d
          if (j < 0 || j >= items.length) return
          const next = [...items]
          ;[next[i], next[j]] = [next[j], next[i]]
          setItems(next)
        }
        return (
          <>
            <div className="flex flex-col gap-1.5">
              {items.map((it, ii) => (
                <div key={ii} className="flex items-center gap-1.5">
                  <span className="w-4 text-right font-mono text-[0.6875rem] text-muted">{ii + 1}</span>
                  <div className="flex flex-col">
                    <button type="button" onClick={() => move(ii, -1)} disabled={ii === 0} className="text-muted hover:text-ink disabled:opacity-20" aria-label="up"><ChevronUp size={13} /></button>
                    <button type="button" onClick={() => move(ii, 1)} disabled={ii === items.length - 1} className="text-muted hover:text-ink disabled:opacity-20" aria-label="down"><ChevronDown size={13} /></button>
                  </div>
                  <LineField value={it} onChange={(v) => setItems(items.map((x, xi) => (xi === ii ? v : x)))} ru={ru} label={ru ? `Элемент ${ii + 1}` : `Item ${ii + 1}`} />
                  <RemoveBtn onClick={() => setItems(items.filter((_, xi) => xi !== ii))} disabled={items.length <= 2} label={ru ? 'Удалить' : 'Remove'} />
                </div>
              ))}
            </div>
            <div className="flex items-center gap-4 pt-0.5 text-[0.78125rem]">
              <AddLink onClick={() => setItems([...items, ''])}>{ru ? 'элемент' : 'item'}</AddLink>
              <Hint>
                {ru ? 'Задайте ПРАВИЛЬНЫЙ порядок (сверху вниз). Ученику покажем перемешанными.' : 'Set the CORRECT order (top to bottom). Shuffled for the learner.'}
              </Hint>
            </div>
          </>
        )
      })()}

      <BubbleTextEditor
        value={quiz.explain}
        onChange={(v) => set({ explain: v })}
        rows={2}
        lang={ru ? 'ru' : 'en'}
        ariaLabel={ru ? 'Пояснение (после проверки)' : 'Explanation (after check)'}
        placeholder={ru ? 'Пояснение — покажется после проверки (необязательно)' : 'Explanation — shown after checking (optional)'}
      />
      <Hint>{ru ? 'Проверка — на странице списка.' : 'Checking happens on the list page.'}</Hint>
    </div>
  )
}
