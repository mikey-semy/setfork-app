'use client'

import { useTransition } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { IconButton } from '@/shared/ui/IconButton'
import { Tooltip } from '@/shared/ui/Tooltip'
import { Spinner } from '@/shared/ui/Spinner'
import { toggleViewed } from './viewed-actions'

/**
 * Отметка «просмотрено» на пункте — как «Viewed» у файла в GitHub.
 *
 * Личная: показывает, что ЭТОТ ревьюер уже разобрал пункт. На длинной правке без
 * неё невозможно вернуться и понять, где остановился.
 *
 * Значок, а не подпись: карточка пункта и так плотная, а на мобиле текст сюда не
 * влезет. Живёт в правом верхнем углу карточки строго абсолютом — в потоке
 * flex-wrap он при переносе уплывал бы в середину.
 */
export function ViewedToggle({
  suggestionId,
  blockId,
  fingerprint,
  viewed,
  stale,
  labels,
}: {
  suggestionId: string
  blockId: string
  /** Отпечаток содержимого пункта СЕЙЧАС — с ним сверяется сохранённый. */
  fingerprint: string
  viewed: boolean
  /** Отметка есть, но поставлена ДО того, как пункт изменили. */
  stale: boolean
  labels: { mark: string; unmark: string; stale: string }
}) {
  const [pending, start] = useTransition()
  const label = stale ? labels.stale : viewed ? labels.unmark : labels.mark

  return (
    <Tooltip label={label}>
      <IconButton
        size="md"
        variant="ghost"
        label={label}
        aria-pressed={viewed}
        disabled={pending}
        onClick={() => start(async () => void (await toggleViewed(suggestionId, blockId, fingerprint)))}
        className={`${
          stale ? 'text-warn' : viewed ? 'text-ok' : 'text-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-ink max-sm:opacity-100'
        }`}
      >
        {pending ? <Spinner size="md" /> : viewed ? <Eye size={14} /> : <EyeOff size={14} />}
      </IconButton>
    </Tooltip>
  )
}
