'use client'

import { useTransition } from 'react'
import { Send } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Spinner } from '@/shared/ui/Spinner'

/**
 * Панель незавершённого ревью: сколько замечаний накопил рецензент и кнопка
 * отправить их пачкой.
 *
 * Появляется только когда черновики есть — иначе это лишний элемент на странице.
 * Липкая снизу: замечания оставляют, прокручивая длинный дифф, и кнопка «отправить»
 * не должна оставаться где-то в начале страницы.
 */
export function PendingReviewBar({
  count,
  action,
  labels,
}: {
  count: number
  action: () => Promise<number>
  labels: { pending: string; submit: string }
}) {
  const [busy, start] = useTransition()
  if (count === 0) return null
  return (
    <div className="sticky bottom-3 z-10 mt-3 flex flex-wrap items-center gap-2.5 rounded-lg border border-warn/40 bg-surface px-3.5 py-2.5 shadow-lg">
      <span className="text-body-sm font-semibold text-warn">
        {labels.pending}: {count}
      </span>
      <Button variant="primary" size="md" disabled={busy} onClick={() => start(() => void action())} className="ml-auto">
        {busy ? <Spinner size="md" /> : <Send size={14} />}
        {labels.submit}
      </Button>
    </div>
  )
}
