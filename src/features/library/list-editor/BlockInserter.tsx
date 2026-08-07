'use client'

import { useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { Tooltip } from '@/shared/ui/Tooltip'
import { t, type Lang } from '@/shared/i18n'
import { BLOCK_TYPES, type BlockType } from '../blocks'
import { BLOCK_ICON, blockLabel } from './block-meta'

// Геометрия веера: радиус и разброс подобраны так, чтобы восемь кружков не липли
// друг к другу и не уезжали за край карточки.
const RADIUS = 88
const SPREAD_DEG = 172
const HOVER_LIFT = 14

/**
 * Радиальный «+»: по клику из кнопки веером вылетают кружки типов блоков, а под
 * ними — повтор предыдущего типа (самый частый выбор). Пальцем это работает лучше
 * выпадающего списка, поэтому вариант остался и на тач.
 *
 * `between` — тонкий разделитель между карточками: кнопка появляется по наведению,
 * а на тач-экране (наведения нет) стоит видимой сразу.
 */
export function BlockInserter({ onInsert, repeatType, lang, between = false }: { onInsert: (t: BlockType) => void; repeatType: BlockType; lang: Lang; between?: boolean }) {
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState<number | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  const startDeg = 90 + SPREAD_DEG / 2 // веер раскрывается слева направо
  const pick = (type: BlockType) => {
    onInsert(type)
    setOpen(false)
  }

  return (
    <div ref={rootRef} className={`relative flex items-center justify-center ${between ? 'group h-4 w-full' : ''}`}>
      {between && !open && <span className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border opacity-0 transition-opacity group-hover:opacity-100" />}
      {BLOCK_TYPES.map((type, k) => {
        const deg = BLOCK_TYPES.length > 1 ? startDeg - (SPREAD_DEG / (BLOCK_TYPES.length - 1)) * k : 90
        const rad = (deg * Math.PI) / 180
        const lifted = hovered === k
        const r = lifted ? RADIUS + HOVER_LIFT : RADIUS
        const Icon = BLOCK_ICON[type]
        return (
          <Tooltip key={type} label={blockLabel(type, lang)}>
            <button
              type="button"
              aria-label={blockLabel(type, lang)}
              onClick={() => pick(type)}
              onMouseEnter={() => setHovered(k)}
              onMouseLeave={() => setHovered((h) => (h === k ? null : h))}
              onFocus={() => setHovered(k)}
              onBlur={() => setHovered((h) => (h === k ? null : h))}
              tabIndex={open ? 0 : -1}
              className={`absolute grid h-10 w-10 place-items-center rounded-full border shadow-md transition-[transform,opacity,color,background-color,border-color] duration-200 motion-reduce:transition-none ${
                lifted ? 'border-accent bg-(--accent-soft) text-accent' : 'border-border bg-surface text-ink'
              }`}
              style={{
                transform: open ? `translate(${Math.cos(rad) * r}px, ${-Math.sin(rad) * r}px) scale(${lifted ? 1.18 : 1})` : 'translate(0,0) scale(0.3)',
                opacity: open ? 1 : 0,
                pointerEvents: open ? 'auto' : 'none',
                zIndex: open ? (lifted ? 22 : 20) : undefined,
              }}
            >
              <Icon size={16} />
            </button>
          </Tooltip>
        )
      })}
      {/* Повтор предыдущего типа — нижний-центральный, чуть под кнопкой. */}
      {(() => {
        const Icon = BLOCK_ICON[repeatType]
        return (
          <Tooltip label={`${t('editor.sameAsPrevious', lang)}: ${blockLabel(repeatType, lang)}`}>
            <button
              type="button"
              aria-label={`${t('editor.repeat', lang)}: ${blockLabel(repeatType, lang)}`}
              onClick={() => pick(repeatType)}
              tabIndex={open ? 0 : -1}
              className="absolute grid h-9 w-9 place-items-center rounded-full bg-primary text-primary-fg shadow-md transition-all duration-200 hover:opacity-90 motion-reduce:transition-none"
              style={{
                transform: open ? `translate(0, ${RADIUS + 6}px) scale(1)` : 'translate(0,0) scale(0.3)',
                opacity: open ? 1 : 0,
                pointerEvents: open ? 'auto' : 'none',
                zIndex: open ? 20 : undefined,
              }}
            >
              <Icon size={15} />
            </button>
          </Tooltip>
        )
      })()}
      <button
        type="button"
        aria-label={t('editor.addBlock', lang)}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`z-1 grid place-items-center rounded-full border transition-all ${
          between ? 'h-7 w-7 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100' : 'h-11 w-11'
        } ${open ? 'rotate-45 border-accent bg-accent text-white' : 'border-border bg-surface text-ink-2 hover:border-border-strong hover:text-ink'} ${open ? 'opacity-100' : ''}`}
      >
        <Plus size={between ? 15 : 20} />
      </button>
    </div>
  )
}
