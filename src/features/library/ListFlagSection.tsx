'use client'

import { useState, useTransition, type ReactNode } from 'react'
import { Switch } from '@/shared/ui/switch'
import { toast } from '@/shared/ui/toast'
import { cardClass } from '@/shared/ui/card-style'

/**
 * Секция настроек «один переключатель — один признак списка» (шаблон, скилл).
 *
 * Своя копия была у шаблона, и она молчала при сбое: переключатель оставался в новом
 * положении, хотя сохранение не удалось. Здесь отказ ОТКАТЫВАЕТ переключатель и говорит
 * причину — «без тихой деградации»: человек видит то, что записано на самом деле.
 */
export function ListFlagSection({
  icon,
  title,
  hint,
  checked,
  save,
  failedText,
}: {
  icon: ReactNode
  title: string
  hint: string
  checked: boolean
  /** Сохранить; `false` — не сохранено (нет права, список не найден). */
  save: (next: boolean) => Promise<boolean>
  failedText: string
}) {
  const [on, setOn] = useState(checked)
  const [pending, start] = useTransition()

  return (
    <section className={cardClass({ pad: 'lg' })}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-semibold text-ink">
            {icon} {title}
          </div>
          <p className="mt-1 text-body-sm leading-snug text-ink-2">{hint}</p>
        </div>
        <Switch
          checked={on}
          disabled={pending}
          aria-label={title}
          onCheckedChange={(v) => {
            setOn(v)
            start(async () => {
              const ok = await save(v).catch(() => false)
              if (!ok) {
                setOn(!v)
                toast.error(failedText)
              }
            })
          }}
        />
      </div>
    </section>
  )
}
