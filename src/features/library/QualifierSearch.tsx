'use client'

import { Fragment, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BadgeCheck, Hash, List, ListOrdered, Search } from 'lucide-react'
import { Avatar } from '@/shared/ui/Avatar'
import { t, type Lang } from '@/shared/i18n'

type SugKind = 'user' | 'tag' | 'verified' | 'ordered' | 'unordered'
interface Suggestion {
  value: string
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
export function QualifierSearch({ initial, tags, lang }: { initial: string; tags: { tag: string; count: number }[]; lang: Lang }) {
  const router = useRouter()
  const [value, setValue] = useState(initial)
  const [sugs, setSugs] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const tok = activeToken(value)
    if (!tok) {
      setOpen(false)
      setSugs([])
      return
    }
    let cancelled = false
    const run = async () => {
      let list: Suggestion[] = []
      if (tok.key === 'tag' || tok.key === 'topic') {
        list = tags
          .filter((tg) => tg.tag.includes(tok.partial))
          .slice(0, 8)
          .map((tg) => ({ value: tg.tag, group: t('tags', lang), kind: 'tag', count: tg.count }))
      } else if (tok.key === 'by' || tok.key === 'owner' || tok.key === 'author') {
        if (tok.partial.length >= 1) {
          const rows = (await fetch(`/api/users/search?q=${encodeURIComponent(tok.partial)}`, { cache: 'no-store' })
            .then((r) => (r.ok ? r.json() : []))
            .catch(() => [])) as { handle: string; avatarUrl?: string }[]
          list = rows.slice(0, 8).map((u) => ({ value: u.handle, group: t('people', lang), kind: 'user', avatarUrl: u.avatarUrl }))
        }
      } else if (tok.key === 'is') {
        list = ['verified']
          .filter((v) => v.startsWith(tok.partial))
          .map((v) => ({ value: v, group: t('filterState', lang), kind: 'verified' }))
      } else if (tok.key === 'type') {
        list = (['ordered', 'unordered'] as const)
          .filter((v) => v.startsWith(tok.partial))
          .map((v) => ({ value: v, group: t('filterType', lang), kind: v }))
      }
      if (cancelled) return
      setSugs(list)
      setOpen(list.length > 0)
      setActive(0)
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [value, tags, lang])

  function apply(s: Suggestion) {
    const word = value.split(/\s/).pop() ?? ''
    const key = word.split(':')[0]
    const before = value.slice(0, value.length - word.length)
    setValue(`${before}${key}:${s.value} `) // завершаем квалификатор пробелом
    setOpen(false)
    inputRef.current?.focus()
  }

  function submit() {
    const q = value.trim()
    router.push(q ? `/explore?q=${encodeURIComponent(q)}` : '/explore')
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
        setActive((i) => (i - 1 + sugs.length) % sugs.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        apply(sugs[active])
        return
      }
      if (e.key === 'Escape') {
        setOpen(false)
        return
      }
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
  }

  const rowIcon = (s: Suggestion) => {
    if (s.kind === 'user') return <Avatar handle={s.value} avatarUrl={s.avatarUrl} size={16} />
    if (s.kind === 'tag') return <Hash size={14} className="shrink-0 text-muted" />
    if (s.kind === 'verified') return <BadgeCheck size={14} className="shrink-0 text-ok" />
    if (s.kind === 'ordered') return <ListOrdered size={14} className="shrink-0 text-muted" />
    return <List size={14} className="shrink-0 text-muted" />
  }

  return (
    <div className="relative">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 focus-within:border-border-strong">
          <Search size={15} className="shrink-0 text-muted" />
          {/* Оверлей с раскрашенными токенами лежит под прозрачным текстом инпута. */}
          <div className="relative min-w-0 flex-1">
            <div
              ref={overlayRef}
              aria-hidden
              className="pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-pre text-[13.5px] text-ink"
            >
              <span className="whitespace-pre">{renderHighlight(value)}</span>
            </div>
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={onKeyDown}
              onScroll={(e) => {
                if (overlayRef.current) overlayRef.current.scrollLeft = e.currentTarget.scrollLeft
              }}
              onBlur={() => setTimeout(() => setOpen(false), 120)}
              placeholder={t('searchLists', lang)}
              aria-label={t('searchLists', lang)}
              className="relative w-full bg-transparent text-[13.5px] text-transparent caret-ink outline-none placeholder:text-muted"
            />
          </div>
        </div>
      </form>
      {open && sugs.length > 0 && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 overflow-hidden rounded-md border border-border bg-surface py-1 shadow-card">
          {sugs.map((s, i) => {
            const header = i === 0 || sugs[i - 1].group !== s.group
            return (
              <Fragment key={`${s.group}/${s.value}`}>
                {header && (
                  <div className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">{s.group}</div>
                )}
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => apply(s)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] ${
                    i === active ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:bg-surface-2'
                  }`}
                >
                  {rowIcon(s)}
                  <span className="truncate">{s.value}</span>
                  {s.count != null && <span className="ml-auto shrink-0 font-mono text-[11px] text-muted">{s.count}</span>}
                </button>
              </Fragment>
            )
          })}
        </div>
      )}
    </div>
  )
}
