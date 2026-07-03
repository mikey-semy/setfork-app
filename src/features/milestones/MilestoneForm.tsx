'use client'
import { useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { createMilestone } from './actions'

const inputCls = 'w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-[13.5px] text-ink outline-none focus:border-border-strong'

// Создание вехи: сворачиваемая форма с клиентской валидацией заголовка (без потери ввода).
export function MilestoneForm({ owner, slug, lang }: { owner: string; slug: string; lang: Lang }) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-[13px] font-semibold text-primary-fg"
      >
        <Plus size={15} /> {t('newMilestone', lang)}
      </button>
    )
  }

  return (
    <form
      action={createMilestone}
      onSubmit={(e) => {
        if (!titleRef.current?.value.trim()) {
          e.preventDefault()
          setError(true)
          titleRef.current?.focus()
        }
      }}
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
    >
      <input type="hidden" name="owner" value={owner} />
      <input type="hidden" name="slug" value={slug} />
      <input ref={titleRef} name="title" required onChange={() => error && setError(false)} className={`${inputCls} ${error ? 'border-danger' : ''}`} placeholder={t('milestoneTitlePh', lang)} maxLength={120} autoFocus />
      <textarea name="desc" rows={2} className={`${inputCls} resize-y`} placeholder={t('milestoneDescPh', lang)} maxLength={2000} />
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[12.5px] text-ink-2">{t('milestoneDue', lang)}</label>
        <input type="date" name="dueOn" className={`${inputCls} w-auto`} />
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-border px-3 py-1.5 text-[13px] text-ink hover:border-border-strong">
            {t('cancel', lang)}
          </button>
          <button className="rounded-md bg-primary px-4 py-1.5 text-[13px] font-semibold text-primary-fg">{t('create', lang)}</button>
        </div>
      </div>
    </form>
  )
}
