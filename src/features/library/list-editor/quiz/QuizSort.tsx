'use client'

import { ChevronDown, ChevronUp } from 'lucide-react'
import { iconSizeFor } from '@/shared/ui/control'
import { IconButton } from '@/shared/ui/IconButton'
import { t } from '@/shared/i18n'
import { AddLink, Hint, LineField, RemoveBtn } from '../block-fields'
import type { QuizKindProps } from './kind-props'

/** Порядок: элементы в правильной последовательности, её и восстанавливает читатель. */
export function QuizSort({ quiz, set, lang, nth }: QuizKindProps) {
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
            {/* Стрелки — общие иконочные кнопки: пальцем по 13px значку не попасть. */}
            <div className="flex flex-col">
              <IconButton size="xs" variant="ghost" touch="grow" onClick={() => move(ii, -1)} disabled={ii === 0} label={t('editor.moveUp', lang)}>
                <ChevronUp size={iconSizeFor('xs')} />
              </IconButton>
              <IconButton size="xs" variant="ghost" touch="grow" onClick={() => move(ii, 1)} disabled={ii === items.length - 1} label={t('editor.moveDown', lang)}>
                <ChevronDown size={iconSizeFor('xs')} />
              </IconButton>
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
}
