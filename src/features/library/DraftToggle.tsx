'use client'

import { useTransition } from 'react'
import { Check, FilePen } from 'lucide-react'

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
      {draft && <p className="text-[12.5px] text-warn">{labels.hint}</p>}
      <div>
        <button
          type="button"
          disabled={pending}
          onClick={() => start(() => void action(!draft))}
          className={`inline-flex h-[38px] items-center gap-1.5 rounded-md px-3.5 text-[13px] font-semibold disabled:opacity-60 ${
            draft ? 'bg-primary text-primary-fg' : 'border border-border text-ink hover:border-border-strong'
          }`}
        >
          {draft ? <Check size={14} /> : <FilePen size={14} />}
          {draft ? labels.ready : labels.back}
        </button>
      </div>
    </div>
  )
}
