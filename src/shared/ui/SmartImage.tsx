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
  width,
  height,
}: {
  src: string
  alt?: string
  className?: string
  style?: CSSProperties
  /** Собственные размеры картинки: браузер резервирует место и страница не прыгает
   *  при загрузке. Заведены 26.08.2026 вместе со свипом — без них пять мест не могли
   *  перейти на примитив и оставались нативными. */
  width?: number
  height?: number
}) {
  const [failed, setFailed] = useState(false)

  if (failed) {
    return (
      <div
        style={style}
        role="img"
        aria-label={alt || 'image unavailable'}
        className={`flex min-h-20 items-center justify-center bg-surface-2 text-muted ${className ?? ''}`}
      >
        <ImageOff size={18} aria-hidden />
      </div>
    )
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} width={width} height={height} style={style} onError={() => setFailed(true)} className={className} />
}
