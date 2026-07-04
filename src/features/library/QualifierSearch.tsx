'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'

interface Suggestion {
  value: string
  hint?: string
}

const QUAL_RE = /^(tag|topic|by|owner|author|is|type):(.*)$/i

/** Активный квалификатор = ПОСЛЕДНИЙ токен строки (если не завершён пробелом). */
function activeToken(v: string): { key: string; partial: string } | null {
  if (v === '' || /\s$/.test(v)) return null
  const word = v.split(/\s/).pop() ?? ''
  const m = QUAL_RE.exec(word)
  return m ? { key: m[1].toLowerCase(), partial: m[2].toLowerCase() } : null
}

/**
 * Поиск с автокомплитом квалификаторов (как окна language/owner на GitHub):
 * печатаешь `tag:` → список тегов, `by:` → пользователи, `is:`/`type:` → значения.
 */
export function QualifierSearch({ initial, tags, lang }: { initial: string; tags: string[]; lang: Lang }) {
  const router = useRouter()
  const [value, setValue] = useState(initial)
  const [sugs, setSugs] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

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
        list = tags.filter((tg) => tg.includes(tok.partial)).slice(0, 8).map((tg) => ({ value: tg }))
      } else if (tok.key === 'by' || tok.key === 'owner' || tok.key === 'author') {
        if (tok.partial.length >= 1) {
          const rows = (await fetch(`/api/users/search?q=${encodeURIComponent(tok.partial)}`, { cache: 'no-store' })
            .then((r) => (r.ok ? r.json() : []))
            .catch(() => [])) as { handle: string }[]
          list = rows.slice(0, 8).map((u) => ({ value: u.handle }))
        }
      } else if (tok.key === 'is') {
        list = ['verified'].filter((v) => v.startsWith(tok.partial)).map((v) => ({ value: v }))
      } else if (tok.key === 'type') {
        list = ['ordered', 'unordered'].filter((v) => v.startsWith(tok.partial)).map((v) => ({ value: v }))
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
  }, [value, tags])

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
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            placeholder={t('searchLists', lang)}
            aria-label={t('searchLists', lang)}
            className="w-full bg-transparent text-[13.5px] text-ink outline-none placeholder:text-muted"
          />
        </div>
      </form>
      {open && sugs.length > 0 && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 overflow-hidden rounded-md border border-border bg-surface shadow-card">
          {sugs.map((s, i) => (
            <button
              key={s.value}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => apply(s)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] ${
                i === active ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:bg-surface-2'
              }`}
            >
              <span className="truncate">{s.value}</span>
              {s.hint && <span className="ml-auto truncate text-[11.5px] text-muted">{s.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
