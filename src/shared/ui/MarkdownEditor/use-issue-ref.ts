'use client'
import { type KeyboardEvent, type RefObject, useRef, useState } from 'react'
import { caretCoords } from '../caret-coords'

/** Найденная задача для подстановки `#123`. */
export interface IssueHit {
  number: number
  title: string
  status: string
}

/** Ширина поповера — по ней же прижимаем его к правому краю поля. */
const POPOVER_W = 240

/**
 * Кросс-ссылка на задачу: `#` в тексте открывает поиск по задачам списка, стрелки
 * выбирают, Enter/Tab подставляют номер (как у GitHub).
 *
 * Ответы поиска приходят не по порядку, поэтому у каждого запроса свой номер и в
 * состояние попадает только ПОСЛЕДНИЙ — иначе медленный ответ на «#1» затирал бы
 * выдачу по «#12».
 */
export function useIssueRef(ctx: {
  ref: RefObject<HTMLTextAreaElement | null>
  /** Репозиторий списка; без него механика выключена целиком. */
  scope?: { owner: string; slug: string }
  /** Подставить текст вместо участка `#…` и поставить каретку после него. */
  apply: (start: number, end: number, text: string) => void
}) {
  const { ref, scope, apply } = ctx
  const [active, setActive] = useState<{ start: number; query: string } | null>(null)
  const [hits, setHits] = useState<IssueHit[]>([])
  const [index, setIndex] = useState(0)
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null)
  const seq = useRef(0)

  function close() {
    setActive(null)
    setHits([])
  }

  async function search(query: string) {
    if (!scope) return
    const my = ++seq.current
    try {
      const res = await fetch(`/api/issues/search?owner=${encodeURIComponent(scope.owner)}&slug=${encodeURIComponent(scope.slug)}&q=${encodeURIComponent(query)}`)
      const data = (await res.json()) as IssueHit[]
      if (my === seq.current) {
        setHits(Array.isArray(data) ? data : [])
        setIndex(0)
      }
    } catch {
      /* поиск задач — необязательная подсказка: молча без неё */
    }
  }

  /** Текст изменился: открыть/обновить/закрыть подсказку. */
  function onText(value: string, caret: number) {
    if (!scope) return
    const m = /(?:^|\s)#(\d{0,10})$/.exec(value.slice(0, caret))
    if (!m) {
      close()
      return
    }
    setActive({ start: caret - m[1].length - 1, query: m[1] })
    setAnchor(anchorAt(caret))
    void search(m[1])
  }

  function anchorAt(caret: number): { top: number; left: number } | null {
    const el = ref.current
    if (!el) return null
    const c = caretCoords(el, caret)
    return { top: c.top - el.scrollTop + c.height, left: Math.min(Math.max(0, c.left), Math.max(0, el.clientWidth - POPOVER_W)) }
  }

  function pick(hit: IssueHit) {
    if (!active) return
    apply(active.start, active.start + 1 + active.query.length, `#${hit.number} `)
    close()
  }

  /** Стрелки/Enter/Tab/Escape, пока подсказка открыта. true — событие забрали. */
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (!active || !hits.length) return false
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((i) => (i + 1) % hits.length)
      return true
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => (i - 1 + hits.length) % hits.length)
      return true
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      pick(hits[index])
      return true
    }
    if (e.key === 'Escape') {
      close()
      return true
    }
    return false
  }

  return { active, hits, index, anchor, setIndex, onText, onKeyDown, pick, close }
}
