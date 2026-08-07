'use client'

import { Input } from '@/shared/ui/input'
import { t, type TKey } from '@/shared/i18n'
import type { QuizKindProps } from './kind-props'

/** Числовой ответ: значение и допустимое отклонение. */
export function QuizNumber({ quiz, set, lang }: QuizKindProps) {
  const fields: { caption: TKey; aria: TKey; ph: string; width: string; value: string; put: (v: string) => void }[] = [
    { caption: 'quiz.correctAnswer', aria: 'quiz.numericAnswer', ph: '42', width: 'w-32', value: quiz.answer, put: (answer) => set({ answer }) },
    { caption: 'quiz.tolerancePm', aria: 'quiz.tolerance', ph: '0', width: 'w-24', value: quiz.tolerance, put: (tolerance) => set({ tolerance }) },
  ]
  return (
    <div className="flex flex-wrap items-end gap-3 text-[0.78125rem]">
      {fields.map((f) => (
        <label key={f.aria} className="flex flex-col gap-1 text-ink-2">
          {t(f.caption, lang)}
          <Input className={f.width} inputMode="decimal" aria-label={t(f.aria, lang)} placeholder={f.ph} value={f.value} onChange={(e) => f.put(e.target.value)} />
        </label>
      ))}
    </div>
  )
}
