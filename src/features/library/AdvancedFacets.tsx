'use client'

import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Check, ChevronDown, Layers, List, ListOrdered, Plus } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { SearchField } from '@/shared/ui/SearchField'
import { buildSearchQuery, parseSearchQuery, type ParsedQuery } from './search-query'
import { buttonClass } from '@/shared/ui/button-style'
import { Badge } from '@/shared/ui/badge'

/**
 * Боковые фасеты в стиле GitHub: клик-переключатели (Type/Verified/Tags) дописывают
 * квалификатор в общий `q` (единый источник правды). Более «продвинутые»
 * квалификаторы (by:/stars:) набираются прямо в строке поиска с автокомплитом —
 * поэтому отдельных полей для них тут нет.
 */
export function AdvancedFacets({
  initialQ,
  tags,
  lang,
  basePath = '/search',
  showHeader = true,
}: {
  initialQ: string
  tags: { tag: string; count: number }[]
  lang: Lang
  basePath?: string
  showHeader?: boolean
}) {
  const router = useRouter()
  const sp = useSearchParams()
  const parsed = useMemo(() => parseSearchQuery(initialQ), [initialQ])
  const [tagsOpen, setTagsOpen] = useState(true)
  const [tagFilter, setTagFilter] = useState('')

  /** Пересобрать q из изменённой структуры и перейти, сохранив сортировку. */
  function go(next: ParsedQuery) {
    const q = buildSearchQuery(next)
    const p = new URLSearchParams()
    if (q) p.set('q', q)
    const sort = sp.get('sort')
    if (sort) p.set('sort', sort)
    const s = p.toString()
    router.push(s ? `${basePath}?${s}` : basePath)
  }

  // Advanced (как на GitHub): дописываем «голый» квалификатор в строку поиска и
  // фокусируем её (focus=1) — значение пользователь вводит уже в поле, с автокомплитом.
  function insertQualifier(prefix: string) {
    const raw = initialQ.trim()
    const p = new URLSearchParams()
    p.set('q', raw ? `${raw} ${prefix}` : prefix)
    const sort = sp.get('sort')
    if (sort) p.set('sort', sort)
    p.set('focus', '1')
    router.push(`${basePath}?${p.toString()}`)
  }

  const setType = (type: ParsedQuery['type']) => go({ ...parsed, type: parsed.type === type ? undefined : type })
  const toggleTag = (tag: string) =>
    go({ ...parsed, tags: parsed.tags.includes(tag) ? parsed.tags.filter((x) => x !== tag) : [...parsed.tags, tag] })

  // Выбранные теги всегда сверху и видны; фильтр применяется к остальным.
  const shownTags = useMemo(() => {
    const f = tagFilter.trim().toLowerCase()
    const selected = tags.filter((tg) => parsed.tags.includes(tg.tag))
    const rest = tags.filter((tg) => !parsed.tags.includes(tg.tag) && (!f || tg.tag.toLowerCase().includes(f)))
    return [...selected, ...rest]
  }, [tags, tagFilter, parsed.tags])

  const row = (active: boolean) =>
    `flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-body outline-hidden focus-visible:ring-2 focus-visible:ring-border-strong ${
      active ? 'bg-surface font-semibold text-ink' : 'text-ink-2 hover:bg-surface hover:text-ink'
    }`

  return (
    <div>
      {showHeader && <div className="mb-4 text-body font-semibold text-ink">{t('filters', lang)}</div>}

      {/* Тип списка — аналог фасета «Languages» */}
      <div className="mb-4">
        <div className="mb-1 px-2 text-caption font-semibold uppercase tracking-wider text-muted">{t('filterType', lang)}</div>
        <div className="flex flex-col gap-0.5">
          <button type="button" onClick={() => setType(undefined)} className={row(!parsed.type)}>
            <Layers size={14} className="shrink-0 text-muted" /> {t('filterAllTypes', lang)}
          </button>
          <button type="button" onClick={() => setType('ordered')} className={row(parsed.type === 'ordered')}>
            <ListOrdered size={14} className="shrink-0 text-muted" /> {t('orderedLabel', lang)}
          </button>
          <button type="button" onClick={() => setType('unordered')} className={row(parsed.type === 'unordered')}>
            <List size={14} className="shrink-0 text-muted" /> {t('unorderedLabel', lang)}
          </button>
        </div>
      </div>

      {/* Теги — сворачиваемый фасет с поиском (тегов может быть очень много) */}
      <div>
        <button
          type="button"
          onClick={() => setTagsOpen((v) => !v)}
          className={buttonClass({ className: 'mb-1 w-full uppercase tracking-wider outline-hidden hover:text-ink-2 focus-visible:ring-2 focus-visible:ring-border-strong' })}
        >
          {t('tags', lang)}
          {parsed.tags.length > 0 && <Badge variant="soft" className="normal-case">{parsed.tags.length}</Badge>}
          <ChevronDown size={13} className={`ml-auto transition-transform ${tagsOpen ? 'rotate-180' : ''}`} />
        </button>
        {tagsOpen && (
          <>
            <div className="mb-1.5 px-1">
              <SearchField size="xs" value={tagFilter} onValueChange={setTagFilter} placeholder={t('filterTags', lang)} />
            </div>
            <div className="flex max-h-70 flex-col gap-0.5 overflow-y-auto pr-0.5">
              {shownTags.length === 0 ? (
                <div className="px-2 py-1 text-body-sm text-muted">{t('noTagsFound', lang)}</div>
              ) : (
                shownTags.map((tg) => {
                  const on = parsed.tags.includes(tg.tag)
                  return (
                    <button key={tg.tag} type="button" onClick={() => toggleTag(tg.tag)} className={row(on)}>
                      <span className="truncate">{tg.tag}</span>
                      {on ? (
                        <Check size={13} className="ml-auto shrink-0 text-accent" />
                      ) : (
                        <span className="ml-auto shrink-0 font-mono text-caption text-muted">{tg.count}</span>
                      )}
                    </button>
                  )
                })
              )}
            </div>
          </>
        )}
      </div>

      {/* Advanced: клик вставляет квалификатор в поле поиска в шапке (как «+» на GitHub) */}
      <div className="mt-5 border-t border-border pt-3">
        <div className="mb-1 px-2 text-caption font-semibold uppercase tracking-wider text-muted">{t('advancedFilters', lang)}</div>
        <div className="flex flex-col gap-0.5">
          <button type="button" onClick={() => insertQualifier('by:')} className={advRow}>
            <Plus size={13} className="shrink-0 text-muted" /> {t('filterAuthor', lang)}
            <code className="ml-auto font-mono text-caption text-muted">by:</code>
          </button>
          <button type="button" onClick={() => insertQualifier('stars:>')} className={advRow}>
            <Plus size={13} className="shrink-0 text-muted" /> {t('filterMinStars', lang)}
            <code className="ml-auto font-mono text-caption text-muted">stars:</code>
          </button>
        </div>
      </div>
    </div>
  )
}

const advRow =
  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body text-ink-2 outline-hidden hover:bg-surface hover:text-ink focus-visible:ring-2 focus-visible:ring-border-strong'
