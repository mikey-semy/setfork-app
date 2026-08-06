'use client'

import { useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { t, type Lang, type TKey } from '@/shared/i18n'
import { classifyListKind, refineHint } from '@/shared/ai/list-kind'
import { refineList } from '../actions'
import type { EditorItem } from '../editor'

/** Отказ модели → своя строка. Незнакомая причина не выдаётся за известную. */
const REFINE_ERROR: Record<string, TKey> = { ratelimited: 'editor.refineRateLimited', ai_quota: 'editor.refineQuota' }

/**
 * Панель «Улучшить»: инструкция свободным текстом, по которой модель переписывает
 * весь состав. Результат приходит целиком — поэтому наверх уходит `onResult`, а
 * история и id строк остаются заботой владельца списка.
 */
export function RefineBar({
  items,
  context,
  onResult,
  lang,
}: {
  items: EditorItem[]
  context: { title: string; desc: string; tags: string[] }
  onResult: (items: EditorItem[]) => void
  lang: Lang
}) {
  const [instruction, setInstruction] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')

  async function run() {
    const ask = instruction.trim()
    if (!ask || running) return
    setRunning(true)
    setError('')
    const res = await refineList({ items, title: context.title, desc: context.desc, tags: context.tags, instruction: ask })
    setRunning(false)
    if ('error' in res) {
      setError(t(REFINE_ERROR[res.error] ?? 'editor.refineFailed', lang))
      return
    }
    if (res.items.length) {
      onResult(res.items)
      setInstruction('')
    }
  }

  return (
    <div className="rounded-lg border border-(--accent) bg-(--accent-soft) p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[0.78125rem] font-semibold text-accent">
        <Sparkles size={14} /> {t('editor.improve', lang)}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {/* Плейсхолдер — готовая фраза ПО ТИПУ списка (тот же refineHint, что в чате
            генерации): тип выводит классификатор из заголовка, без вызова модели.
            Хардкод «про TLS» на рецепте выглядел нелепо (фидбек владельца). */}
        <Input
          className="min-w-[15rem] flex-1"
          placeholder={refineHint(classifyListKind(context.title), lang === 'ru')}
          value={instruction}
          disabled={running}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void run()
            }
          }}
        />
        <Button variant="primary" size="md" onClick={() => void run()} disabled={running || !instruction.trim()}>
          {running ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {t(running ? 'editor.refining' : 'editor.apply', lang)}
        </Button>
      </div>
      <p className="mt-1.5 text-[0.6875rem] text-ink-2">{t('editor.refineWarning', lang)}</p>
      {error && <p className="mt-1 text-[0.78125rem] text-danger">{error}</p>}
    </div>
  )
}
