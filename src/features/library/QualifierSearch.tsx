'use client'

import { Fragment, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Hash, List, ListChecks, ListOrdered, Search } from 'lucide-react'
import { Avatar } from '@/shared/ui/Avatar'
import { SearchField } from '@/shared/ui/SearchField'
import { t, type Lang } from '@/shared/i18n'
import { parseSearchQuery } from './search-query'

type SugKind = 'user' | 'tag' | 'ordered' | 'unordered' | 'list' | 'search'
type SugAction = 'insert' | 'navigate' | 'search'
interface Suggestion {
  action: SugAction
  label: string // отображаемый текст
  value: string // для insert — значение квалификатора; иначе — для ключа/подписи
  href?: string // для navigate
  sub?: string // подпись (напр. handle/slug под заголовком списка)
  group: string
  kind: SugKind
  avatarUrl?: string
  count?: number
}

const QUAL_RE = /^(tag|topic|by|owner|author|is|type):(.*)$/i
// Для подсветки значений в оверлее (глобально, по всей строке).
const HL_RE = /(by|owner|author|tag|topic|is|type|stars):(\S*)/gi

/** Активный квалификатор = ПОСЛЕДНИЙ токен строки (если не завершён пробелом). */
function activeToken(v: string): { key: string; partial: string } | null {
  if (v === '' || /\s$/.test(v)) return null
  const word = v.split(/\s/).pop() ?? ''
  const m = QUAL_RE.exec(word)
  return m ? { key: m[1].toLowerCase(), partial: m[2].toLowerCase() } : null
}

/** Раскрашиваем строку: `key:` цветом чернил, значение — акцентом (как на GitHub). */
function renderHighlight(v: string) {
  const out: React.ReactNode[] = []
  let last = 0
  let i = 0
  HL_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = HL_RE.exec(v))) {
    if (m.index > last) out.push(<span key={i++}>{v.slice(last, m.index)}</span>)
    out.push(
      <span key={i++} className="text-ink">
        {m[1]}:
      </span>,
    )
    if (m[2]) out.push(
      <span key={i++} className="text-accent">
        {m[2]}
      </span>,
    )
    last = m.index + m[0].length
  }
  if (last < v.length) out.push(<span key={i++}>{v.slice(last)}</span>)
  return out
}

/**
 * Поиск с автокомплитом квалификаторов (как окна language/owner на GitHub):
 * печатаешь `by:` → люди, `tag:` → теги, `is:`/`type:` → значения. Варианты
 * сгруппированы под заголовками, значение квалификатора подсвечено в самом поле.
 */
export function QualifierSearch({
  initial,
  lang,
  basePath = '/search',
  scope,
  autoFocus,
  size = 'md',
  hint,
  containerClassName = 'w-full',
}: {
  initial: string
  lang: Lang
  basePath?: string
  scope?: string | null
  autoFocus?: boolean
  size?: 'md' | 'sm'
  hint?: React.ReactNode
  containerClassName?: string
}) {
  const textCls = size === 'sm' ? 'text-body' : 'text-body-lg'
  const router = useRouter()
  const [value, setValue] = useState(initial)
  const [sugs, setSugs] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  // -1 = ничего явно не выбрано → Enter уходит в поиск (/search), не «прыгает» на сущность.
  const [active, setActive] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const tagsRef = useRef<{ tag: string; count: number }[] | null>(null)
  // Подсказки показываем только когда пользователь сам начал печатать, а не при
  // заходе на /search с уже заполненным q (страница = развёрнутый ответ).
  const touchedRef = useRef(false)

  useEffect(() => {
    const tok = activeToken(value)
    const trimmed = value.trim()
    if (!touchedRef.current || (!tok && !trimmed)) {
      setOpen(false)
      setSugs([])
      return
    }
    let cancelled = false
    const ctrl = new AbortController() // отменяем висящие фетчи при новом вводе/размонтировании
    // Дебаунс сетевых запросов (печать — не спамим API).
    const timer = setTimeout(async () => {
      let list: Suggestion[] = []
      if (tok && (tok.key === 'tag' || tok.key === 'topic')) {
        if (!tagsRef.current) {
          // Кэшируем только успешный ответ; при ошибке оставляем null → повторим позже.
          const fetched = (await fetch('/api/tags/popular', { signal: ctrl.signal })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null)) as { tag: string; count: number }[] | null
          if (fetched) tagsRef.current = fetched
        }
        list = (tagsRef.current ?? [])
          .filter((tg) => tg.tag.includes(tok.partial))
          .slice(0, 8)
          .map((tg) => ({ action: 'insert', label: tg.tag, value: tg.tag, group: t('tags', lang), kind: 'tag', count: tg.count }))
      } else if (tok && (tok.key === 'by' || tok.key === 'owner' || tok.key === 'author')) {
        if (tok.partial.length >= 1) {
          const rows = (await fetch(`/api/users/search?q=${encodeURIComponent(tok.partial)}`, { cache: 'no-store', signal: ctrl.signal })
            .then((r) => (r.ok ? r.json() : []))
            .catch(() => [])) as { handle: string; avatarUrl?: string }[]
          list = rows.slice(0, 8).map((u) => ({ action: 'insert', label: u.handle, value: u.handle, group: t('people', lang), kind: 'user', avatarUrl: u.avatarUrl }))
        }
      } else if (tok && tok.key === 'type') {
        list = (['ordered', 'unordered'] as const)
          .filter((v) => v.startsWith(tok.partial))
          .map((v) => ({ action: 'insert', label: v, value: v, group: t('filterType', lang), kind: v }))
      } else if (!tok) {
        // Свободный текст: «Искать "X"» + прямые переходы на списки/людей (как глобальный поиск GitHub).
        const term = parseSearchQuery(value).text.trim()
        list = [{ action: 'search', label: trimmed, value: trimmed, group: '', kind: 'search' }]
        if (term.length >= 1) {
          const [lists, users] = await Promise.all([
            fetch(`/api/lists/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal }).then((r) => (r.ok ? r.json() : [])).catch(() => []),
            fetch(`/api/users/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal }).then((r) => (r.ok ? r.json() : [])).catch(() => []),
          ])
          for (const l of (lists as { handle: string; slug: string; title: string }[]).slice(0, 5)) {
            list.push({ action: 'navigate', label: l.title || l.slug, value: `${l.handle}/${l.slug}`, sub: `${l.handle}/${l.slug}`, href: `/${l.handle}/${l.slug}`, group: t('scopeLists', lang), kind: 'list' })
          }
          for (const u of (users as { handle: string; avatarUrl?: string }[]).slice(0, 4)) {
            list.push({ action: 'navigate', label: `@${u.handle}`, value: u.handle, href: `/${u.handle}`, group: t('people', lang), kind: 'user', avatarUrl: u.avatarUrl })
          }
        }
      }
      if (cancelled) return
      setSugs(list)
      setOpen(list.length > 0)
      setActive(-1)
    }, 150)
    return () => {
      cancelled = true
      clearTimeout(timer)
      ctrl.abort() // отменяем незавершённые запросы предыдущего ввода
    }
  }, [value, lang])

  function apply(s: Suggestion) {
    if (s.action === 'navigate' && s.href) {
      setOpen(false)
      router.push(s.href)
      return
    }
    if (s.action === 'search') {
      submit()
      return
    }
    // insert: заменяем последний токен готовым квалификатором
    const word = value.split(/\s/).pop() ?? ''
    const key = word.split(':')[0]
    const before = value.slice(0, value.length - word.length)
    setValue(`${before}${key}:${s.value} `) // завершаем квалификатор пробелом
    setOpen(false)
    inputRef.current?.focus()
  }

  function submit() {
    const q = value.trim()
    const p = new URLSearchParams()
    if (q) p.set('q', q)
    if (scope) p.set('scope', scope)
    const s = p.toString()
    router.push(s ? `${basePath}?${s}` : basePath)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (open && sugs.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActive((i) => (i + 1) % sugs.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((i) => (i <= 0 ? sugs.length : i) - 1)
        return
      }
      if (e.key === 'Escape') {
        setOpen(false)
        return
      }
      // Tab — дополнить первым/выбранным вариантом (квалификатор/сущность).
      if (e.key === 'Tab') {
        const sel = sugs[active >= 0 ? active : 0]
        if (sel) {
          e.preventDefault()
          apply(sel)
        }
        return
      }
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      // По умолчанию (ничего явно не выбрано стрелками) Enter всегда идёт в поиск.
      if (open && active >= 0 && sugs[active]) apply(sugs[active])
      else submit()
    }
  }

  const rowIcon = (s: Suggestion) => {
    if (s.kind === 'search') return <Search size={14} className="shrink-0 text-muted" />
    if (s.kind === 'user') return <Avatar handle={s.value} avatarUrl={s.avatarUrl} size={16} />
    if (s.kind === 'list') return <ListChecks size={14} className="shrink-0 text-muted" />
    if (s.kind === 'tag') return <Hash size={14} className="shrink-0 text-muted" />
    if (s.kind === 'ordered') return <ListOrdered size={14} className="shrink-0 text-muted" />
    return <List size={14} className="shrink-0 text-muted" />
  }

  return (
    <div className={`relative ${containerClassName}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <SearchField
          ref={inputRef}
          size={size}
          hint={hint}
          autoFocus={autoFocus}
          value={value}
          onValueChange={(v) => {
            touchedRef.current = true
            setValue(v)
          }}
          onKeyDown={onKeyDown}
          onScroll={(e) => {
            if (overlayRef.current) overlayRef.current.scrollLeft = e.currentTarget.scrollLeft
          }}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          placeholder={t('searchLists', lang)}
          overlay={
            <div
              ref={overlayRef}
              aria-hidden
              className={`pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-pre ${textCls} text-ink`}
            >
              <span className="whitespace-pre">{renderHighlight(value)}</span>
            </div>
          }
        />
      </form>
      {open && sugs.length > 0 && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 overflow-hidden rounded-md border border-border bg-surface py-1 shadow-card">
          {sugs.map((s, i) => {
            const header = s.group && (i === 0 || sugs[i - 1].group !== s.group)
            return (
              <Fragment key={`${s.action}/${s.group}/${s.value}`}>
                {header && (
                  <div className="px-3 pb-1 pt-1.5 text-caption font-semibold uppercase tracking-wider text-muted">{s.group}</div>
                )}
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => apply(s)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-body ${
                    i === active ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:bg-surface-2'
                  }`}
                >
                  {rowIcon(s)}
                  {s.kind === 'search' ? (
                    <span className="truncate">
                      {t('searchFor', lang)} <span className="font-semibold text-ink">“{s.label}”</span>
                    </span>
                  ) : (
                    <>
                      <span className="truncate">{s.label}</span>
                      {s.sub && <span className="ml-auto shrink-0 truncate pl-2 text-caption text-muted">{s.sub}</span>}
                      {s.count != null && <span className="ml-auto shrink-0 font-mono text-caption text-muted">{s.count}</span>}
                    </>
                  )}
                </button>
              </Fragment>
            )
          })}
        </div>
      )}
    </div>
  )
}
