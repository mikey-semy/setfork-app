'use client'
import { useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { Button } from '@/shared/ui/button'
import { createMilestone } from './actions'
import { cardClass } from '@/shared/ui/card-style'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'


// Создание вехи: сворачиваемая форма с клиентской валидацией заголовка (без потери ввода).
export function MilestoneForm({ owner, slug, lang }: { owner: string; slug: string; lang: Lang }) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  if (!open) {
    return (
      <Button variant="primary" size="md" onClick={() => setOpen(true)}>
        <Plus size={15} /> {t('newMilestone', lang)}
      </Button>
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
      className={cardClass({ className: 'flex flex-col gap-2' })}
    >
      <input type="hidden" name="owner" value={owner} />
      <input type="hidden" name="slug" value={slug} />
      <Input ref={titleRef} name="title" required onChange={() => error && setError(false)} className={error ? 'border-danger' : undefined} placeholder={t('milestoneTitlePh', lang)} maxLength={120} autoFocus />
      <Textarea name="desc" rows={2} className="resize-y" placeholder={t('milestoneDescPh', lang)} maxLength={2000} />
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-body-sm text-ink-2">{t('milestoneDue', lang)}</label>
        <Input type="date" name="dueOn" className="w-auto" />
        <div className="ml-auto flex gap-2">
          <Button onClick={() => setOpen(false)}>{t('cancel', lang)}</Button>
          <Button type="submit" variant="primary">
            {t('create', lang)}
          </Button>
        </div>
      </div>
    </form>
  )
}
