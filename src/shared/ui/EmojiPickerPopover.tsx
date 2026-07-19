'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { useTheme } from 'next-themes'
import emojiData from '@emoji-mart/data'
import { Tooltip } from './Tooltip'
import { Popover, PopoverContent, PopoverTrigger } from './popover'

// Полный emoji-mart пикер, ЯКОРНЫЙ (рядом с кнопкой), а не по центру экрана.
// Один на всё приложение (реакции, редакторы) — не плодим centered-порталы.
const EmojiMart = dynamic(() => import('@emoji-mart/react'), { ssr: false })

export function EmojiPickerPopover({
  button,
  tooltip,
  onPick,
  lang = 'en',
  side = 'bottom',
  align = 'end',
}: {
  /** Кнопка-триггер (обычный <button>): к ней привяжутся и поповер, и тултип. */
  button: React.ReactNode
  /** Подпись в тултипе на кнопке. */
  tooltip: React.ReactNode
  onPick: (native: string) => void
  lang?: string
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
}) {
  const [open, setOpen] = useState(false)
  const { resolvedTheme } = useTheme()
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip label={tooltip}>
        <PopoverTrigger asChild>{button}</PopoverTrigger>
      </Tooltip>
      <PopoverContent side={side} align={align} className="border-0 bg-transparent p-0 shadow-none">
        <EmojiMart
          data={emojiData}
          locale={lang === 'ru' ? 'ru' : 'en'}
          theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
          previewPosition="none"
          skinTonePosition="none"
          perLine={8}
          emojiSize={20}
          emojiButtonSize={30}
          maxFrequentRows={2}
          onEmojiSelect={(e: { native?: string }) => {
            if (e.native) onPick(e.native)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
