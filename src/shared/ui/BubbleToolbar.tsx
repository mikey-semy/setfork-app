'use client'

import { useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useTheme } from 'next-themes'
import { AtSign, MoreHorizontal, SmilePlus } from 'lucide-react'
import emojiData from '@emoji-mart/data'
import { iconSizeFor } from './control'
import { IconButton } from './IconButton'
import { Popover, PopoverAnchor, PopoverContent } from './popover'
import { Tooltip } from './Tooltip'
import { useToolbarFit } from './use-toolbar-fit'

type Tool = { t: string; icon: React.ComponentType<{ size?: number }>; run: () => void }

/**
 * Всплывающая панель форматирования: показывает СТОЛЬКО кнопок, сколько влезает
 * по ширине, остальное прячет за «⋯» вместе с упоминанием и эмодзи.
 *
 * Отделена от самого поля: поле отвечает за текст и каретку, панель — за
 * инструменты и их размещение. Кнопки — общий IconButton, поэтому на телефоне
 * они добирают тач-цель так же, как везде.
 */
export function BubbleToolbar({
  tools,
  at,
  lang,
  onMention,
  onEmoji,
  onOverlay,
}: {
  tools: Tool[]
  at: { top: number; left: number }
  lang: 'ru' | 'en'
  /** Вставить «@» в текст — дальше подсказку ведёт сам редактор. */
  onMention: () => void
  /** Вставить эмодзи в место, где стояла каретка до открытия панели. */
  onEmoji: (native: string) => void
  /** Открыт ли пикер/меню: пока открыт, поле не должно прятать панель по потере
   *  фокуса — пикер живёт в портале и фокус уходит туда. */
  onOverlay: (open: boolean) => void
}) {
  const L = (ru: string, en: string) => (lang === 'ru' ? ru : en)
  const { resolvedTheme } = useTheme()
  const barRef = useRef<HTMLDivElement>(null)
  const [emojiOpen, setEmojiOpenState] = useState(false)
  const [moreOpen, setMoreOpenState] = useState(false)
  const setEmojiOpen = (v: boolean) => {
    setEmojiOpenState(v)
    onOverlay(v || moreOpen)
  }
  const setMoreOpen = (v: boolean) => {
    setMoreOpenState(v)
    onOverlay(v || emojiOpen)
  }
  const fit = useToolbarFit(barRef, tools.length, [at.left, at.top])
  const shown = tools.slice(0, fit)
  const hidden = tools.slice(fit)
  const size = iconSizeFor('sm')

  return (
    <div
      ref={barRef}
      className="absolute z-30 flex items-center gap-0.5 rounded-md border border-border bg-surface p-0.5 shadow-lg transition-[top,left] duration-150 ease-out motion-reduce:transition-none"
      style={{ top: Math.max(0, at.top), left: at.left }}
      // Нажатие на панель не должно уводить фокус из поля — иначе выделение пропадёт.
      onMouseDown={(e) => e.preventDefault()}
    >
      {shown.map((tool) => (
        <Tooltip key={tool.t} label={tool.t}>
          <IconButton size="sm" variant="ghost" data-tool label={tool.t} onClick={tool.run}>
            <tool.icon size={size} />
          </IconButton>
        </Tooltip>
      ))}
      <span className="mx-0.5 h-4 w-px bg-border" />
      <div className="relative">
        {/* Пикер эмодзи — ЯКОРНЫЙ (не по центру экрана). Якорь — кнопка «ещё»: она
            остаётся смонтированной, в отличие от самой кнопки эмодзи, которая
            живёт в закрывающемся меню. */}
        <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
          <Tooltip label={L('ещё', 'more')}>
            <PopoverAnchor asChild>
              <IconButton
                size="sm"
                variant="ghost"
                data-more
                label={L('ещё', 'more')}
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen(!moreOpen)}
              >
                <MoreHorizontal size={size} />
              </IconButton>
            </PopoverAnchor>
          </Tooltip>
          <PopoverContent side="bottom" align="end" className="border-0 bg-transparent p-0 shadow-none">
            <EmojiPicker
              data={emojiData}
              locale={lang}
              theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
              previewPosition="none"
              skinTonePosition="none"
              perLine={8}
              onEmojiSelect={(ev: { native?: string }) => {
                if (ev.native) onEmoji(ev.native)
                setEmojiOpen(false)
              }}
            />
          </PopoverContent>
        </Popover>
        {moreOpen && (
          // Сетка с переносом: меню тоже не должно быть шире экрана.
          <div className="absolute right-0 top-full z-40 mt-1 flex w-max max-w-[11.75rem] flex-wrap items-center gap-0.5 rounded-md border border-border bg-surface p-1 shadow-lg">
            {hidden.map((tool) => (
              <Tooltip key={tool.t} label={tool.t}>
                <IconButton
                  size="sm"
                  variant="ghost"
                  label={tool.t}
                  onClick={() => {
                    tool.run()
                    setMoreOpen(false)
                  }}
                >
                  <tool.icon size={size} />
                </IconButton>
              </Tooltip>
            ))}
            <Tooltip label={L('упомянуть', 'mention')}>
              <IconButton
                size="sm"
                variant="ghost"
                label={L('упомянуть', 'mention')}
                onClick={() => {
                  onMention()
                  setMoreOpen(false)
                }}
              >
                <AtSign size={size} />
              </IconButton>
            </Tooltip>
            <Tooltip label={L('эмодзи', 'emoji')}>
              <IconButton
                size="sm"
                variant="ghost"
                label={L('эмодзи', 'emoji')}
                onClick={() => {
                  setMoreOpen(false)
                  setEmojiOpen(true)
                }}
              >
                <SmilePlus size={size} />
              </IconButton>
            </Tooltip>
          </div>
        )}
      </div>
    </div>
  )
}

const EmojiPicker = dynamic(() => import('@emoji-mart/react'), { ssr: false })
