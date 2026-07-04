'use client'

import { useState, type CSSProperties } from 'react'
import { ImageOff } from 'lucide-react'

/**
 * <img> с тихим фолбэком: если картинка не загрузилась (битый URL, CDN/imgproxy
 * недоступен) — вместо значка «сломанное изображение» показываем нейтральный
 * плейсхолдер (иконка на приглушённом фоне). Для контентных картинок (шаги,
 * markdown); аватары падают в identicon сами (см. Avatar).
 */
export function SmartImage({
  src,
  alt = '',
  className,
  style,
}: {
  src: string
  alt?: string
  className?: string
  style?: CSSProperties
}) {
  const [failed, setFailed] = useState(false)

  if (failed) {
    return (
      <div
        style={style}
        role="img"
        aria-label={alt || 'image unavailable'}
        className={`flex min-h-[80px] items-center justify-center bg-surface-2 text-muted ${className ?? ''}`}
      >
        <ImageOff size={18} aria-hidden />
      </div>
    )
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} style={style} onError={() => setFailed(true)} className={className} />
}
