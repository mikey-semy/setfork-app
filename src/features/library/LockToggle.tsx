'use client'

import { useTransition } from 'react'
import { Lock, Unlock } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'
import { Spinner } from '@/shared/ui/Spinner'
import { setSuggestionLocked } from './suggestion-meta-actions'

/** Тот же перечень, что у задач: причины запирания у них общие (см. lockReasonEnum). */
const REASONS = ['off_topic', 'too_heated', 'resolved', 'spam'] as const

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
  reasonLabels,
}: {
  suggestionId: string
  locked: boolean
  labels: { lock: string; unlock: string; hint: string }
  /** Подписи причин — из словаря; тем же перечнем, что у задач. */
  reasonLabels: Record<(typeof REASONS)[number], string>
}) {
  const [pending, start] = useTransition()
  const run = (reason?: (typeof REASONS)[number]) =>
    start(async () => void (await setSuggestionLocked(suggestionId, !locked, reason)))

  // ⚠️ КНОПКА ОДНА НА ОБА СОСТОЯНИЯ, а не две в ветках тернарника. Дело не в экономии
  // строк: узда тач-целей (tests/architecture/stacked-touch) читает разметку СТАТИЧЕСКИ и
  // видит две кнопки в столбике там, где на экране всегда одна. Спорить с ней незачем —
  // проверка права по форме, а «две кнопки, но не одновременно» она различить не может и
  // не должна: цена такой сообразительности — узда, которой перестают верить.
  const trigger = (
    <Button
      variant="ghost"
      className="w-full justify-start px-2"
      disabled={pending}
      // Отпирание — одно действие, поэтому нажатие; запирание спрашивает причину, и
      // нажатие обрабатывает меню-обёртка ниже.
      onClick={locked ? () => run() : undefined}
    >
      {pending ? <Spinner size="md" /> : locked ? <Unlock size={14} /> : <Lock size={14} />}
      {locked ? labels.unlock : labels.lock}
    </Button>
  )

  return (
    <div className="flex flex-col gap-1.5">
      {locked ? (
        trigger
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {REASONS.map((r) => (
              <DropdownMenuItem
                key={r}
                disabled={pending}
                onSelect={(e) => {
                  e.preventDefault() // не закрывать меню до старта перехода
                  run(r)
                }}
              >
                {reasonLabels[r]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {/* Подсказка только в запертом состоянии: в обычном она была бы шумом. */}
      {locked && <p className="text-caption text-muted">{labels.hint}</p>}
    </div>
  )
}
