'use client'

import { blankCount } from '@/core'
import { t } from '@/shared/i18n'
import { Hint, LineField } from '../block-fields'
import type { QuizKindProps } from './kind-props'
import { buttonClass } from '@/shared/ui/button-style'

/**
 * Пропуски: текст с «___», под каждым пропуском — принимаемые ответы.
 *
 * Число полей считается из САМОГО текста (blankCount), а не хранится отдельно:
 * иначе правка шаблона молча расходилась бы со списком ответов.
 */
export function QuizBlanks({ quiz, set, lang, caseBox, nth }: QuizKindProps) {
  const n = blankCount(quiz.template)
  return (
    <>
      <textarea
        className={buttonClass({ className: 'min-h-13 w-full resize-y leading-relaxed outline-hidden focus:border-border-strong' })}
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
              <span className="w-5 shrink-0 text-right font-mono text-caption text-muted">#{bi + 1}</span>
              <LineField
                value={quiz.blanks[bi] ?? ''}
                onChange={(v) => set({ blanks: Array.from({ length: n }, (_, i) => (i === bi ? v : (quiz.blanks[i] ?? ''))) })}
                lang={lang}
                label={nth('quiz.blankAnswersN', bi + 1)}
                placeholder={t('quiz.blankAnswersPh', lang)}
              />
            </div>
          ))}
        </div>
      )}
      <div className="self-start text-body-sm">{caseBox}</div>
    </>
  )
}
