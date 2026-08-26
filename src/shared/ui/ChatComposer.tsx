'use client'

import { useRef, type ReactNode } from 'react'
import { ArrowUp } from 'lucide-react'
import { Tooltip } from './Tooltip'
import { Spinner } from '@/shared/ui/Spinner'

/**
 * Композер чата — ОБЩИЙ для всех чатов гномов (дом гномов, UI-часть): рамка-инпут,
 * авторастущая textarea, круглая кнопка отправки В ПОТОКЕ (одна строка — по оси,
 * много — у низа), хоткеи Enter/Shift+Enter/Esc. Раньше был скопирован в чате
 * генерации и раскопки — теперь один компонент (фидбек владельца: не дублировать).
 *
 * leftSlot — «+»/действия слева (генерация); chips — ряд кнопок над полем
 * (фоллоу-апы/действия). onTab — подхват подсказки; onEscape — закрыть (dig).
 */
export function ChatComposer({
  value,
  onChange,
  onSend,
  placeholder,
  sendDisabled,
  pending,
  sendAriaLabel,
  sendTooltip,
  leftSlot,
  chips,
  onEscape,
  onTab,
}: {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  placeholder?: string
  sendDisabled?: boolean
  pending?: boolean
  sendAriaLabel: string
  sendTooltip?: string
  leftSlot?: ReactNode
  chips?: ReactNode
  onEscape?: () => void
  onTab?: () => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const autosize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`
  }
  const send = () => {
    onSend()
    if (ref.current) ref.current.style.height = 'auto'
  }
  return (
    <div>
      {chips && <div className="mb-2">{chips}</div>}
      <div className="flex items-end gap-1 rounded-2xl border border-border bg-surface px-1.5 py-1.5 focus-within:border-border-strong">
        {leftSlot}
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            autosize(e.currentTarget)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            } else if (e.key === 'Escape' && onEscape) {
              onEscape()
            } else if ((e.key === 'Tab' || e.key === 'ArrowRight') && !value && onTab) {
              e.preventDefault()
              onTab()
            }
          }}
          rows={1}
          placeholder={placeholder}
          className="max-h-32 min-h-8 flex-1 resize-none bg-transparent px-2 py-[0.46875rem] text-body leading-[1.55] text-ink outline-hidden placeholder:text-muted"
        />
        <Tooltip label={sendTooltip ?? sendAriaLabel}>
          <button
            type="button"
            onClick={send}
            disabled={sendDisabled}
            aria-label={sendAriaLabel}
            className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-fg disabled:opacity-40"
          >
            {pending ? <Spinner size="lg" /> : <ArrowUp size={17} />}
          </button>
        </Tooltip>
      </div>
    </div>
  )
}
