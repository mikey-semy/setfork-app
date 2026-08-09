'use client'

import { useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { caretCoords } from './caret-coords'

export type MentionUser = { handle: string; avatarUrl: string | null }

/**
 * Упоминания «@handle» в текстовом поле: распознавание по каретке, поиск людей,
 * выбор стрелками и вставка.
 *
 * Живёт отдельно от редактора: сам редактор отвечает за текст и форматирование,
 * а упоминания — это свой цикл (запрос к серверу, гонка ответов, клавиатура).
 * Пока они были в теле компонента, любая правка панели инструментов ехала рядом
 * с логикой поиска людей.
 */
export function useMention({
  value,
  ref,
  apply,
}: {
  value: string
  ref: RefObject<HTMLTextAreaElement | null>
  /** Замена текста с установкой каретки — общая с редактором. */
  apply: (next: string, selStart: number, selEnd: number) => void
}) {
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null)
  const [users, setUsers] = useState<MentionUser[]>([])
  const [index, setIndex] = useState(0)
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null)
  // Ответы приходят не в том порядке, в каком уходили запросы: показываем только
  // ответ на последний ввод, иначе список подменяется устаревшим.
  const seq = useRef(0)

  function coordsAt(pos: number) {
    const el = ref.current
    if (!el) return null
    const c = caretCoords(el, pos)
    return { top: c.top - el.scrollTop, left: Math.min(Math.max(0, c.left), Math.max(0, el.clientWidth - 240)) }
  }

  async function search(query: string) {
    const my = ++seq.current
    try {
      const res = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`)
      const data = (await res.json()) as MentionUser[]
      if (my === seq.current) {
        setUsers(Array.isArray(data) ? data.slice(0, 8) : [])
        setIndex(0)
      }
    } catch {
      /* сеть отвалилась — списка просто не будет */
    }
  }

  function close() {
    setMention(null)
    setUsers([])
  }

  function pick(u: MentionUser) {
    if (!mention) return
    const end = mention.start + 1 + mention.query.length
    const caret = mention.start + u.handle.length + 2
    apply(value.slice(0, mention.start) + `@${u.handle} ` + value.slice(end), caret, caret)
    close()
  }

  /** Ввод текста: включает или гасит подсказку. Возвращает, активна ли она сейчас. */
  function onText(v: string): boolean {
    const caret = ref.current?.selectionStart ?? v.length
    const m = /(?:^|\s)@([\w-]{0,30})$/.exec(v.slice(0, caret))
    const next = m ? { start: caret - m[1].length - 1, query: m[1] } : null
    setMention(next)
    if (next) {
      setAnchor(coordsAt(caret))
      void search(next.query)
      return true
    }
    setUsers([])
    return false
  }

  /** Клавиши списка. true — клавиша обработана, редактору её отдавать не нужно. */
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (!mention || !users.length) return false
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((i) => (i + 1) % users.length)
      return true
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => (i - 1 + users.length) % users.length)
      return true
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      pick(users[index])
      return true
    }
    if (e.key === 'Escape') {
      close()
      return true
    }
    return false
  }

  return { mention, users, index, setIndex, anchor, onText, onKeyDown, pick, close }
}
