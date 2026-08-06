'use client'

import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { BubbleTextEditor } from '@/shared/ui/BubbleTextEditor'
import { Input } from '@/shared/ui/input'
import { Tooltip } from '@/shared/ui/Tooltip'
import { t, type Lang, type TKey } from '@/shared/i18n'
import { blankCount, type QuizKind } from '@/core'
import { AddLink, CheckLabel, FieldRow, Hint, LineField, RemoveBtn } from './block-fields'
import { newOptionId } from './blocks'
import type { EditorQuiz } from './editor'

/** Виды теста — таблица «значение → ключ подписи»; кнопки строятся из неё. */
const QUIZ_KINDS: { k: QuizKind; label: TKey }[] = [
  { k: 'choice', label: 'quiz.kindChoice' },
  { k: 'text', label: 'quiz.kindText' },
  { k: 'number', label: 'quiz.kindNumber' },
  { k: 'blank', label: 'quiz.kindBlank' },
  { k: 'match', label: 'quiz.kindMatch' },
  { k: 'sort', label: 'quiz.kindSort' },
  { k: 'code', label: 'quiz.kindCode' },
]

/**
 * Quiz-блок в редакторе: вопрос, ответы своего вида и пояснение. Проверка ответов
 * живёт на странице списка — здесь их только задают.
 */
export function QuizBlockBody({ quiz, onChange, lang }: { quiz: EditorQuiz; onChange: (q: EditorQuiz) => void; lang: Lang }) {
  const set = (q: Partial<EditorQuiz>) => onChange({ ...quiz, ...q })
  const nth = (key: TKey, n: number) => t(key, lang).replace('{n}', String(n))
  // Пометка «верный» эксклюзивна, пока не включено «несколько верных».
  const toggleCorrect = (oi: number) =>
    set({ options: quiz.options.map((x, xi) => (xi === oi ? { ...x, correct: !x.correct } : quiz.multi ? x : { ...x, correct: false })) })
  const caseBox = (
    <CheckLabel checked={quiz.caseSensitive} onChange={(caseSensitive) => set({ caseSensitive })}>
      {t('quiz.caseSensitive', lang)}
    </CheckLabel>
  )
  const accept = quiz.accept.length ? quiz.accept : ['']
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3">
      {/* Тип теста */}
      <div className="flex items-center gap-1 self-start rounded-md border border-border bg-surface p-0.5 text-[0.78125rem]">
        {QUIZ_KINDS.map((o) => (
          <button
            key={o.k}
            type="button"
            onClick={() => set({ kind: o.k })}
            className={`rounded px-2.5 py-1 ${quiz.kind === o.k ? 'bg-surface-2 font-medium text-ink' : 'text-ink-2 hover:text-ink'}`}
          >
            {t(o.label, lang)}
          </button>
        ))}
      </div>

      <LineField value={quiz.question} onChange={(question) => set({ question })} lang={lang} className="" label={t('quiz.questionPh', lang)} />

      {quiz.kind === 'choice' && (
        <>
          <div className="flex flex-col gap-1.5">
            {quiz.options.map((o, oi) => (
              <div key={o.id} className="flex items-center gap-2">
                <Tooltip label={t(o.correct ? 'quiz.correctAnswer' : 'quiz.markCorrect', lang)}>
                  <button
                    type="button"
                    onClick={() => toggleCorrect(oi)}
                    aria-pressed={o.correct}
                    aria-label={t('quiz.markCorrect', lang)}
                    className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border transition-colors ${
                      o.correct ? 'border-ok bg-ok/15 text-ok' : 'border-border-strong text-transparent hover:border-ok'
                    }`}
                  >
                    <Check size={13} />
                  </button>
                </Tooltip>
                <LineField value={o.text} onChange={(v) => set({ options: quiz.options.map((x, xi) => (xi === oi ? { ...x, text: v } : x)) })} lang={lang} label={nth('editor.optionN', oi + 1)} />
                <RemoveBtn onClick={() => set({ options: quiz.options.filter((_, xi) => xi !== oi) })} disabled={quiz.options.length <= 2} label={t('editor.removeOption', lang)} />
              </div>
            ))}
          </div>
          <FieldRow>
            <AddLink onClick={() => set({ options: [...quiz.options, { id: newOptionId(), text: '', correct: false }] })}>{t('editor.addOption', lang)}</AddLink>
            <CheckLabel checked={quiz.multi} onChange={(multi) => set({ multi })}>
              {t('quiz.multipleCorrect', lang)}
            </CheckLabel>
          </FieldRow>
        </>
      )}

      {(quiz.kind === 'text' || quiz.kind === 'code') && (
        <>
          {quiz.kind === 'code' && <Hint>{t('quiz.codeHint', lang)}</Hint>}
          <div className="flex flex-col gap-1.5">
            {accept.map((a, ai) => (
              <div key={ai} className="flex items-center gap-2">
                <span className="w-4 text-right text-[0.6875rem] text-muted">✓</span>
                <LineField value={a} onChange={(v) => set({ accept: accept.map((x, xi) => (xi === ai ? v : x)) })} lang={lang} label={nth('quiz.acceptedN', ai + 1)} />
                <RemoveBtn onClick={() => set({ accept: accept.filter((_, xi) => xi !== ai) })} disabled={accept.length <= 1} label={t('quiz.removeAnswer', lang)} />
              </div>
            ))}
          </div>
          <FieldRow>
            <AddLink onClick={() => set({ accept: [...accept, ''] })}>{t('quiz.addAccepted', lang)}</AddLink>
            {caseBox}
          </FieldRow>
          <Hint>{t('quiz.acceptedHint', lang)}</Hint>
        </>
      )}

      {quiz.kind === 'number' && (
        <div className="flex flex-wrap items-end gap-3 text-[0.78125rem]">
          {[
            { caption: 'quiz.correctAnswer' as TKey, aria: 'quiz.numericAnswer' as TKey, ph: '42', width: 'w-32', value: quiz.answer, put: (answer: string) => set({ answer }) },
            { caption: 'quiz.tolerancePm' as TKey, aria: 'quiz.tolerance' as TKey, ph: '0', width: 'w-24', value: quiz.tolerance, put: (tolerance: string) => set({ tolerance }) },
          ].map((f) => (
            <label key={f.aria} className="flex flex-col gap-1 text-ink-2">
              {t(f.caption, lang)}
              <Input className={f.width} inputMode="decimal" aria-label={t(f.aria, lang)} placeholder={f.ph} value={f.value} onChange={(e) => f.put(e.target.value)} />
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
              aria-label={t('quiz.blankText', lang)}
              placeholder={t('quiz.blankTextPh', lang)}
              value={quiz.template}
              onChange={(e) => set({ template: e.target.value })}
            />
            {n === 0 ? (
              <Hint>{t('quiz.blankNone', lang)}</Hint>
            ) : (
              <div className="flex flex-col gap-1.5">
                {Array.from({ length: n }, (_, bi) => (
                  <div key={bi} className="flex items-center gap-2">
                    <span className="w-5 shrink-0 text-right font-mono text-[0.6875rem] text-muted">#{bi + 1}</span>
                    <LineField
                      value={quiz.blanks[bi] ?? ''}
                      onChange={(v) => set({ blanks: Array.from({ length: n }, (_, i) => (i === bi ? v : quiz.blanks[i] ?? '')) })}
                      lang={lang}
                      label={nth('quiz.blankAnswersN', bi + 1)}
                      placeholder={t('quiz.blankAnswersPh', lang)}
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
        const patchPair = (pi: number, side: 'left' | 'right', v: string) => setPairs(pairs.map((x, xi) => (xi === pi ? { ...x, [side]: v } : x)))
        return (
          <>
            <div className="flex flex-col gap-1.5">
              {pairs.map((p, pi) => (
                <div key={pi} className="flex items-center gap-2">
                  <LineField value={p.left} onChange={(v) => patchPair(pi, 'left', v)} lang={lang} label={nth('quiz.leftN', pi + 1)} placeholder={t('quiz.left', lang)} />
                  <span className="shrink-0 text-muted">→</span>
                  <LineField value={p.right} onChange={(v) => patchPair(pi, 'right', v)} lang={lang} label={nth('quiz.rightN', pi + 1)} placeholder={t('quiz.right', lang)} />
                  <RemoveBtn onClick={() => setPairs(pairs.filter((_, xi) => xi !== pi))} disabled={pairs.length <= 2} label={t('quiz.removePair', lang)} />
                </div>
              ))}
            </div>
            <FieldRow>
              <AddLink onClick={() => setPairs([...pairs, { left: '', right: '' }])}>{t('quiz.addPair', lang)}</AddLink>
              {caseBox}
            </FieldRow>
            <Hint>{t('quiz.matchHint', lang)}</Hint>
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
                    <button type="button" onClick={() => move(ii, -1)} disabled={ii === 0} className="text-muted hover:text-ink disabled:opacity-20" aria-label={t('editor.moveUp', lang)}><ChevronUp size={13} /></button>
                    <button type="button" onClick={() => move(ii, 1)} disabled={ii === items.length - 1} className="text-muted hover:text-ink disabled:opacity-20" aria-label={t('editor.moveDown', lang)}><ChevronDown size={13} /></button>
                  </div>
                  <LineField value={it} onChange={(v) => setItems(items.map((x, xi) => (xi === ii ? v : x)))} lang={lang} label={nth('quiz.itemN', ii + 1)} />
                  <RemoveBtn onClick={() => setItems(items.filter((_, xi) => xi !== ii))} disabled={items.length <= 2} label={t('quiz.remove', lang)} />
                </div>
              ))}
            </div>
            <div className="flex items-center gap-4 pt-0.5 text-[0.78125rem]">
              <AddLink onClick={() => setItems([...items, ''])}>{t('quiz.addItem', lang)}</AddLink>
              <Hint>{t('quiz.sortHint', lang)}</Hint>
            </div>
          </>
        )
      })()}

      <BubbleTextEditor
        value={quiz.explain}
        onChange={(v) => set({ explain: v })}
        rows={2}
        lang={lang}
        ariaLabel={t('quiz.explain', lang)}
        placeholder={t('quiz.explainPh', lang)}
      />
      <Hint>{t('quiz.checkOnListPage', lang)}</Hint>
    </div>
  )
}
