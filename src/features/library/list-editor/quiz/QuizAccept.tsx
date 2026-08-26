'use client'

import { t } from '@/shared/i18n'
import { AddLink, FieldRow, Hint, LineField, RemoveBtn } from '../block-fields'
import type { QuizKindProps } from './kind-props'

/**
 * Свободный ответ и код: список принимаемых формулировок.
 *
 * Один вид на два значения kind: у кода отличается только подсказка, а правила
 * сверки те же — ответ засчитан, если совпал с любой строкой списка.
 */
export function QuizAccept({ quiz, set, lang, caseBox, nth }: QuizKindProps) {
  const accept = quiz.accept.length ? quiz.accept : ['']
  return (
    <>
      {quiz.kind === 'code' && <Hint>{t('quiz.codeHint', lang)}</Hint>}
      <div className="flex flex-col gap-1.5">
        {accept.map((a, ai) => (
          <div key={ai} className="flex items-center gap-2">
            <span className="w-4 text-right text-caption text-muted">✓</span>
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
  )
}
