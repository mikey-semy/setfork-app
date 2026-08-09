'use client'

import { useCallback, useEffect, useState, type RefObject } from 'react'

/**
 * Сколько кнопок панели влезает в её ширину.
 *
 * Раньше инлайн показывалась ФИКСИРОВАННАЯ первая группа, а всё остальное пряталось
 * в «⋯» — и на широком экране половина панели пустовала, хотя место было. Теперь
 * число видимых считается от ширины: сколько поместилось, столько и показываем.
 *
 * Ширины НЕ заданы числами: кнопка и «⋯» меряются в самом DOM (`data-tool`,
 * `data-more`), поэтому смена размера иконок или отступов ничего здесь не ломает.
 * Пересчёт — на изменение ширины хоста (ResizeObserver), то есть и при повороте
 * экрана, и при появлении бокового меню.
 */
export function useToolbarFit(hostRef: RefObject<HTMLElement | null>, total: number, deps: unknown[] = []): number {
  const [fit, setFit] = useState(total)

  const measure = useCallback(() => {
    const host = hostRef.current
    if (!host) return
    const tool = host.querySelector<HTMLElement>('[data-tool]')
    const more = host.querySelector<HTMLElement>('[data-more]')
    if (!tool) return
    const cs = getComputedStyle(host)
    const gap = parseFloat(cs.columnGap || cs.gap || '0') || 0
    const pad = parseFloat(cs.paddingLeft || '0') + parseFloat(cs.paddingRight || '0')
    // Ширину даёт РОДИТЕЛЬ: сама панель обтягивает содержимое, и мерить её значило бы
    // мерить то, что мы же и хотим уместить.
    const room = (host.parentElement?.clientWidth ?? host.clientWidth) - pad
    const step = tool.offsetWidth + gap
    // Место под «⋯» резервируем, только если он действительно понадобится.
    const reserve = more ? more.offsetWidth + gap : 0
    const all = Math.floor((room + gap) / step)
    setFit(all >= total ? total : Math.max(1, Math.floor((room - reserve + gap) / step)))
  }, [hostRef, total])

  useEffect(() => {
    measure()
    const host = hostRef.current
    const box = host?.parentElement ?? host
    if (!box || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(box)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure, ...deps])

  return fit
}
