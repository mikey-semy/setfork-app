'use client'

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { stripHandleInput } from '@/shared/auth/handle-input'
import { cn } from '@/shared/lib/cn'
import { Input, type InputSize } from './input'
import { MentionList } from './MentionList'
import { searchPeople, TYPEAHEAD_DEBOUNCE_MS, type FoundUser } from './user-search'

/**
 * Поле ника с подсказкой людей — как «Add people» у GitHub и поиск соавтора у Gitea:
 * набираешь ник, под полем — найденные люди с аватаром, выбор заполняет поле.
 *
 * «@» — приставка поля (`Input leading`), а не часть значения: набранный или
 * вставленный «@mike» становится «mike», поэтому ник понимается и с «@», и без.
 * Правило снятия одно с сервером (handle-input), экшен повторяет его сам — поле
 * лишь не даёт человеку увидеть «@@mike».
 *
 * Значение уходит обычной формой через `name`: поле работает внутри серверного
 * `<form action>` без своего состояния отправки.
 */
export function UserHandleInput({
  name,
  placeholder,
  limitedText,
  size = 'md',
  className,
  'aria-label': ariaLabel,
  'aria-invalid': ariaInvalid,
}: {
  name: string
  placeholder?: string
  /** Что сказать, когда сервер отказал по частоте поиска: подсказка не пропадает молча. */
  limitedText?: string
  size?: InputSize
  className?: string
  'aria-label'?: string
  'aria-invalid'?: boolean
}) {
  // Поле НЕУПРАВЛЯЕМОЕ (значение правим через ref): после успешного `<form action>`
  // React 19 сам сбрасывает форму, и добавленный ник уходит из поля, как у GitHub.
  // Управляемое значение этот сброс пережило бы — ник так и висел бы в поле.
  const ref = useRef<HTMLInputElement>(null)
  const [users, setUsers] = useState<FoundUser[]>([])
  const [index, setIndex] = useState(0)
  const [open, setOpen] = useState(false)
  // Ответы приходят не в том порядке, в каком уходили запросы: показываем только
  // ответ на последний ввод, иначе список подменяется устаревшим (как в useMention).
  const seq = useRef(0)
  const listId = useId()
  const [limited, setLimited] = useState(false)
  // Запрос уходит после паузы в наборе, а висящий прежний — отменяется: поиск людей
  // ограничен по частоте, и запрос на каждую букву выбирал лимит за пару ников.
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; ctrl: AbortController } | null>(null)
  const cancelPending = () => {
    if (!pending.current) return
    clearTimeout(pending.current.timer)
    pending.current.ctrl.abort()
    pending.current = null
  }
  useEffect(() => cancelPending, [])

  function search(q: string) {
    cancelPending()
    const my = ++seq.current
    if (!q) {
      setUsers([])
      setOpen(false)
      setLimited(false)
      return
    }
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      const found = await searchPeople(q, ctrl.signal)
      if (my !== seq.current) return
      setUsers(found.users)
      setIndex(0)
      setOpen(found.users.length > 0)
      setLimited(found.limited)
    }, TYPEAHEAD_DEBOUNCE_MS)
    pending.current = { timer, ctrl }
  }

  function onChange(el: HTMLInputElement) {
    const next = stripHandleInput(el.value)
    if (next !== el.value) el.value = next
    search(next)
  }

  function pick(u: FoundUser) {
    cancelPending()
    seq.current++ // запоздавший ответ на прежний ввод не должен снова раскрыть список
    if (ref.current) ref.current.value = u.handle
    // Подсказки выбранного больше не нужны: иначе после сброса формы касание пустого
    // поля снова раскрывало прежний список.
    setUsers([])
    setOpen(false)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open || users.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((i) => (i + 1) % users.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => (i - 1 + users.length) % users.length)
    } else if (e.key === 'Enter') {
      // Enter при открытом списке — выбор, а не отправка формы (как у GitHub).
      e.preventDefault()
      pick(users[index])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    }
  }

  const expanded = open && users.length > 0
  return (
    <div className={cn('relative min-w-0', className)}>
      <Input
        leading="@"
        size={size}
        ref={ref}
        name={name}
        onChange={(e) => onChange(e.currentTarget)}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
        onFocus={() => users.length > 0 && setOpen(true)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid || undefined}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded ? `${listId}-${index}` : undefined}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      {expanded && <MentionList id={listId} users={users} index={index} onHover={setIndex} onPick={pick} />}
      {limited && limitedText && (
        <p role="status" className="mt-1 text-body-sm text-muted">
          {limitedText}
        </p>
      )}
    </div>
  )
}
