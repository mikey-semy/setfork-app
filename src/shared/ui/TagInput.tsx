'use client'

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { Badge } from '@/shared/ui/badge'
import type { Lang } from '@/shared/i18n'

// Чипы + автокомплит для тегов списка. Пишет скрытый <input name> со slug'ами
// через пробел — серверный экшен (parseTags) работает без изменений. Подсказки
// из реестра (/api/tags/suggest); свой тег тоже можно вписать. Оформление —
// на общих примитивах (Badge, токены Input/AnchoredMenu), без одноразовых стилей.
type Suggestion = { slug: string; curated: boolean; usageCount: number }

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9а-яё-]/gi, '')
    .slice(0, 40)
}

export function TagInput({ name = 'tags', initial = [], lang, max = 8 }: { name?: string; initial?: string[]; lang: Lang; max?: number }) {
  const say = (en: string, ru: string) => (lang === 'ru' ? ru : en) // не тернар-с-литералами (i18n-lint)
  const [tags, setTags] = useState<string[]>(() => [...new Set(initial.map(normalize).filter(Boolean))].slice(0, max))
  const [q, setQ] = useState('')
  const [sugg, setSugg] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)

  // Подсказки из реестра (дебаунс). Уже добавленные не показываем.
  useEffect(() => {
    let alive = true
    const id = setTimeout(() => {
      fetch(`/api/tags/suggest?q=${encodeURIComponent(q.trim())}`)
        .then((r) => r.json())
        .then((rows: Suggestion[]) => {
          if (alive) {
            setSugg(rows.filter((r) => !tags.includes(r.slug)))
            setHi(0)
          }
        })
        .catch(() => {})
    }, 150)
    return () => {
      alive = false
      clearTimeout(id)
    }
  }, [q, tags])

  // Клик вне — закрыть выпадашку (как AnchoredMenu).
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  function add(raw: string) {
    const tag = normalize(raw)
    setQ('')
    setSugg([])
    if (!tag || tags.includes(tag) || tags.length >= max) return
    setTags([...tags, tag])
  }
  const remove = (tag: string) => setTags(tags.filter((x) => x !== tag))

  return (
    <div ref={boxRef} className="relative">
      <input type="hidden" name={name} value={tags.join(' ')} />
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-1.5 focus-within:border-border-strong">
        {tags.map((tag) => (
          <Badge key={tag} variant="soft" className="gap-1 bg-surface pr-1 text-[12px] font-medium text-ink">
            {tag}
            <button
              type="button"
              onClick={() => remove(tag)}
              aria-label={say('Remove', 'Убрать')}
              className="grid size-4 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-danger"
            >
              <X size={11} />
            </button>
          </Badge>
        ))}
        {tags.length < max && (
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault()
                add(open && sugg[hi] ? sugg[hi].slug : q)
              } else if (e.key === 'Backspace' && !q && tags.length) {
                remove(tags[tags.length - 1])
              } else if (e.key === 'ArrowDown') {
                e.preventDefault()
                setHi((h) => Math.min(h + 1, sugg.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setHi((h) => Math.max(h - 1, 0))
              } else if (e.key === 'Escape') {
                setOpen(false)
              }
            }}
            placeholder={tags.length === 0 ? say('e.g. docker', 'напр. docker') : ''}
            className="min-w-[90px] flex-1 bg-transparent px-1 py-0.5 text-[13.5px] text-ink outline-hidden placeholder:text-muted"
          />
        )}
      </div>
      {open && sugg.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-surface py-1 shadow-lg">
          {sugg.map((s, i) => (
            <li key={s.slug}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  add(s.slug)
                }}
                onMouseEnter={() => setHi(i)}
                className={cn(
                  'flex w-full items-center justify-between px-3 py-1.5 text-left text-[13px]',
                  i === hi ? 'bg-surface-2 text-ink' : 'text-ink-2',
                )}
              >
                <span className="flex items-center gap-1.5">
                  {s.curated && (
                    <span className="text-accent" title={say('Curated', 'Курируемый')}>
                      ✓
                    </span>
                  )}
                  {s.slug}
                </span>
                <span className="font-mono text-[11px] text-muted">{s.usageCount}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-[11.5px] text-muted">{say(`Pick from suggestions or type your own. Up to ${max}.`, `Выбери из подсказок или впиши свой. До ${max}.`)}</p>
    </div>
  )
}
