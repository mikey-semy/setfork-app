'use client'

import { useEffect, useRef, useState } from 'react'
import { identiconCells } from '@/shared/lib/identicon'

const COLORS = ['#2563eb', '#dc2626', '#7c3aed', '#0891b2', '#e11d48', '#16a34a', '#4f46e5', '#d97706']

function colorFor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return COLORS[h % COLORS.length]
}

/**
 * Аватар пользователя: загруженное фото (avatar_url) или identicon по нику
 * (дефолтный аватар в стиле GitHub — один и тот же для одного пользователя).
 * Если фото не загрузилось (битый URL / CDN недоступен) — тихо откатываемся на
 * identicon вместо иконки «сломанное изображение».
 */
export function Avatar({
  handle,
  avatarUrl,
  size = 38,
  rounded = 'rounded-full',
}: {
  handle: string
  avatarUrl?: string | null
  size?: number
  rounded?: string
}) {
  const [failed, setFailed] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)

  // Если картинка упала ДО гидрации (SSR отрендерил битый src, браузер словил
  // error раньше, чем React привязал onError) — onError в React не сработает.
  // Ловим уже-упавший img на маунте: complete && naturalWidth === 0 = ошибка.
  useEffect(() => {
    const img = imgRef.current
    if (img && img.complete && img.naturalWidth === 0) setFailed(true)
  }, [avatarUrl])

  if (avatarUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        ref={imgRef}
        src={avatarUrl}
        alt={handle}
        onError={() => setFailed(true)}
        style={{ width: size, height: size }}
        className={`${rounded} flex-shrink-0 object-cover`}
      />
    )
  }
  const cells = identiconCells(handle)
  const color = colorFor(handle)
  return (
    <div
      style={{ width: size, height: size, padding: Math.round(size * 0.15) }}
      className={`grid flex-shrink-0 grid-cols-5 grid-rows-5 gap-px bg-[var(--border)] ${rounded}`}
    >
      {cells.map((on, i) => (
        <span key={i} style={{ background: on ? color : 'transparent', borderRadius: 1 }} />
      ))}
    </div>
  )
}
