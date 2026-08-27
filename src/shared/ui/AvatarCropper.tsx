'use client'

import { useEffect, useRef, useState } from 'react'
import { ZoomIn } from 'lucide-react'
import { OverlayPanel } from './OverlayPanel'
import { Button } from './button'

const VIEWPORT = 260 // размер квадратного окна кропа (CSS px)
const OUTPUT = 512 // сторона выходного квадрата (px)
const MAX_ZOOM = 3

/**
 * Кроп + зум аватара перед сохранением: квадратное окно, картинку двигаешь
 * пальцем/мышью (pan), масштаб — ползунком. Отдаёт квадратный webp-blob через
 * canvas. Круглая обводка — подсказка (в профиле аватар круглый), сама обрезка
 * квадратная (одинаково подходит и для круга, и для квадрата).
 *
 * Работает надёжно с НОВЫМ файлом (objectURL — свой origin, canvas не «портится»).
 * Для уже сохранённого аватара по imgproxy-URL нужен CORS — иначе toBlob упадёт;
 * такой кейс пока идёт через повторную загрузку.
 */
export function AvatarCropper({
  open,
  src,
  onCancel,
  onDone,
  labels,
}: {
  open: boolean
  src: string | null
  onCancel: () => void
  onDone: (file: File) => void
  labels: { title: string; zoom: string; apply: string; cancel: string; failed: string }
}) {
  const imgRef = useRef<HTMLImageElement | null>(null)
  const drag = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null)
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [err, setErr] = useState('')

  const base = nat ? Math.max(VIEWPORT / nat.w, VIEWPORT / nat.h) : 1
  const scale = base * zoom
  const dw = nat ? nat.w * scale : VIEWPORT
  const dh = nat ? nat.h * scale : VIEWPORT

  const clampXY = (x: number, y: number, w: number, h: number) => ({
    x: Math.min(0, Math.max(VIEWPORT - w, x)),
    y: Math.min(0, Math.max(VIEWPORT - h, y)),
  })

  // Загрузка картинки → натуральные размеры + центрирование.
  useEffect(() => {
    if (!open || !src) return
    setZoom(1)
    setErr('')
    const img = new Image()
    img.crossOrigin = 'anonymous' // попытка не «испортить» canvas для URL-источника
    img.onload = () => {
      imgRef.current = img
      const w = img.naturalWidth
      const h = img.naturalHeight
      setNat({ w, h })
      const b = Math.max(VIEWPORT / w, VIEWPORT / h)
      setPos({ x: (VIEWPORT - w * b) / 2, y: (VIEWPORT - h * b) / 2 })
    }
    img.onerror = () => setErr(labels.failed)
    img.src = src
  }, [open, src, labels.failed])

  // Зум вокруг центра окна (точка под центром остаётся на месте).
  const onZoom = (z: number) => {
    if (!nat) {
      setZoom(z)
      return
    }
    const s0 = base * zoom
    const s1 = base * z
    setPos((p) => {
      const cx = (VIEWPORT / 2 - p.x) / s0
      const cy = (VIEWPORT / 2 - p.y) / s0
      return clampXY(VIEWPORT / 2 - cx * s1, VIEWPORT / 2 - cy * s1, nat.w * s1, nat.h * s1)
    })
    setZoom(z)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { px: e.clientX, py: e.clientY, ox: pos.x, oy: pos.y }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    setPos(clampXY(drag.current.ox + (e.clientX - drag.current.px), drag.current.oy + (e.clientY - drag.current.py), dw, dh))
  }
  const onPointerUp = () => {
    drag.current = null
  }

  const apply = () => {
    const img = imgRef.current
    if (!img || !nat) return
    const sSize = VIEWPORT / scale
    const canvas = document.createElement('canvas')
    canvas.width = OUTPUT
    canvas.height = OUTPUT
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    try {
      ctx.drawImage(img, -pos.x / scale, -pos.y / scale, sSize, sSize, 0, 0, OUTPUT, OUTPUT)
      canvas.toBlob(
        (blob) => {
          if (blob) onDone(new File([blob], 'avatar.webp', { type: 'image/webp' }))
          else setErr(labels.failed)
        },
        'image/webp',
        0.9,
      )
    } catch {
      // canvas «испорчен» кросс-доменной картинкой (imgproxy без CORS) → просим перезагрузить.
      setErr(labels.failed)
    }
  }

  return (
    <OverlayPanel
      open={open}
      onClose={onCancel}
      width={320}
      title={labels.title}
      closeLabel={labels.cancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {labels.cancel}
          </Button>
          <Button variant="primary" onClick={apply}>
            {labels.apply}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div
          className="relative mx-auto touch-none overflow-hidden rounded-lg bg-surface-2 select-none"
          style={{ width: VIEWPORT, height: VIEWPORT, maxWidth: '100%' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {src && (
            // eslint-disable-next-line @next/next/no-img-element -- локальный objectURL/внешний URL
            <img
              src={src}
              alt=""
              draggable={false}
              style={{ width: dw, height: dh, transform: `translate(${pos.x}px, ${pos.y}px)`, maxWidth: 'none' }}
              className="absolute left-0 top-0"
            />
          )}
          {/* Круглая подсказка-обводка (обрезка квадратная). */}
          <div className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-white/60" />
        </div>

        <label className="flex items-center gap-2 text-body-sm text-muted">
          <ZoomIn size={15} className="shrink-0" />
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(e) => onZoom(Number(e.target.value))}
            aria-label={labels.zoom}
            className="h-1 w-full cursor-pointer accent-accent"
          />
        </label>

        {err && <p className="text-body-sm text-danger">{err}</p>}
      </div>
    </OverlayPanel>
  )
}
