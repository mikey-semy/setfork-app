'use client'

import { useTransition } from 'react'
import { Loader2, Lock, Unlock } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { setSuggestionLocked } from './suggestion-meta-actions'

/**
 * Запереть обсуждение предложения — аналог Lock conversation у GitHub.
 *
 * Отдельно от закрытия правки: спор уходит в сторону и тогда, когда решение уже
 * принято, а закрывать правку ради тишины — подмена одного другим. Заперто ≠
 * решено, поэтому и кнопки разные.
 */
export function LockToggle({
  suggestionId,
  locked,
  labels,
}: {
  suggestionId: string
  locked: boolean
  labels: { lock: string; unlock: string; hint: string }
}) {
  const [pending, start] = useTransition()
  return (
    <div className="flex flex-col gap-1.5">
      <Button
        variant="ghost"
        className="h-[38px] w-full justify-start px-2 text-[12.5px]"
        disabled={pending}
        onClick={() => start(async () => void (await setSuggestionLocked(suggestionId, !locked)))}
      >
        {pending ? <Loader2 size={14} className="animate-spin" /> : locked ? <Unlock size={14} /> : <Lock size={14} />}
        {locked ? labels.unlock : labels.lock}
      </Button>
      {/* Подсказка только в запертом состоянии: в обычном она была бы шумом. */}
      {locked && <p className="text-[11.5px] text-muted">{labels.hint}</p>}
    </div>
  )
}
