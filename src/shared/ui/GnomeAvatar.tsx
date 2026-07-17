'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Аватарка персонажа совета. Единственное место, где решается «что показать» — чтобы битой
 * картинки не было НИГДЕ: ни в чате, ни в админке, ни в будущих экранах.
 *
 * Битая картинка возникает легко: ссылка на удалённый файл в S3, недорисованный персонаж,
 * опечатка в id, оборванная загрузка. Вместо «сломанного листа» показываем общего гнома —
 * пользователь видит участника, а не дефект.
 */

const FALLBACK = '/gnomes/council.webp'

export function GnomeAvatar({
  src,
  size = 64,
  className = '',
  alt = '',
}: {
  /** Готовый URL (загруженная картинка) или путь к встроенной. Пусто → сразу заглушка. */
  src?: string
  size?: number
  className?: string
  alt?: string
}) {
  const [failed, setFailed] = useState(false)
  const ref = useRef<HTMLImageElement>(null)

  useEffect(() => {
    setFailed(false) // сменили картинку — новая заслуживает своей попытки
    // Одного onError мало: HTML приходит с сервера, картинка успевает загрузиться (и упасть) ДО
    // гидратации — событие уходит в пустоту, обработчика ещё нет. Поэтому после гидратации сами
    // спрашиваем у уже завершённой картинки, получилась ли она.
    const el = ref.current
    if (el?.complete && el.naturalWidth === 0) setFailed(true)
  }, [src])

  const url = !src || failed ? FALLBACK : src
  return (
    // eslint-disable-next-line @next/next/no-img-element -- статичная webp/imgproxy; оптимизатор ни к чему
    <img
      ref={ref}
      src={url}
      alt={alt}
      aria-hidden={alt ? undefined : true}
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className={className}
    />
  )
}
