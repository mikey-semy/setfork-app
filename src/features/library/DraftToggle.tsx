'use client'

import { useTransition } from 'react'
import { Check, FilePen } from 'lucide-react'
import { Button } from '@/shared/ui/button'

/**
 * Черновик ↔ готово к ревью.
 *
 * Пока правка черновик, показывается подсказка «слить нельзя» рядом с кнопкой:
 * иначе отсутствие кнопки слияния выглядит как поломка, а не как состояние.
 */
export function DraftToggle({
  draft,
  action,
  labels,
}: {
  draft: boolean
  action: (draft: boolean) => Promise<void>
  labels: { ready: string; back: string; hint: string }
}) {
  const [pending, start] = useTransition()
  return (
    <div className="mt-3 flex flex-col gap-2">
      {draft && <p className="text-[0.78125rem] text-warn">{labels.hint}</p>}
      <div>
        <Button
          size="md"
          variant={draft ? 'primary' : 'outline'}
          disabled={pending}
          onClick={() => start(() => void action(!draft))}
        >
          {draft ? <Check size={14} /> : <FilePen size={14} />}
          {draft ? labels.ready : labels.back}
        </Button>
      </div>
    </div>
  )
}
