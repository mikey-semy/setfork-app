'use client'

import { t } from '@/shared/i18n'
import { AddLink, FieldRow, Hint, LineField, RemoveBtn } from '../block-fields'
import type { QuizKindProps } from './kind-props'

/** Сопоставление: пары «слева → справа». */
export function QuizMatch({ quiz, set, lang, caseBox, nth }: QuizKindProps) {
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
}
