'use client'

import { Check } from 'lucide-react'
import { IconButton } from '@/shared/ui/IconButton'
import { Tooltip } from '@/shared/ui/Tooltip'
import { t } from '@/shared/i18n'
import { newOptionId } from '../../blocks'
import { AddLink, CheckLabel, FieldRow, LineField, RemoveBtn } from '../block-fields'
import type { QuizKindProps } from './kind-props'

/** Выбор из вариантов: список ответов, у каждого пометка «верный». */
export function QuizChoice({ quiz, set, lang, nth }: QuizKindProps) {
  // Пометка «верный» эксклюзивна, пока не включено «несколько верных».
  const toggleCorrect = (oi: number) =>
    set({ options: quiz.options.map((x, xi) => (xi === oi ? { ...x, correct: !x.correct } : quiz.multi ? x : { ...x, correct: false })) })

  return (
    <>
      <div className="flex flex-col gap-1.5">
        {quiz.options.map((o, oi) => (
          <div key={o.id} className="flex items-center gap-2">
            <Tooltip label={t(o.correct ? 'quiz.correctAnswer' : 'quiz.markCorrect', lang)}>
              {/* Кружок рисуется ВНУТРИ кнопки: область касания не должна зависеть
                  от размера значка. */}
              <IconButton size="sm" variant="ghost" onClick={() => toggleCorrect(oi)} aria-pressed={o.correct} label={t('quiz.markCorrect', lang)} className="rounded-full border-0 hover:bg-transparent">
                <span className={`grid size-5 place-items-center rounded-full border transition-colors ${o.correct ? 'border-ok bg-ok/15 text-ok' : 'border-border-strong text-transparent'}`}>
                  <Check size={13} />
                </span>
              </IconButton>
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
  )
}
