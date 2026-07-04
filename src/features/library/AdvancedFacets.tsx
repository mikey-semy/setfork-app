'use client'

import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { BadgeCheck, Check, ChevronDown, Layers, List, ListOrdered, SlidersHorizontal } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { buildSearchQuery, parseSearchQuery, type ParsedQuery } from './search-query'

/**
 * Боковые фасеты в стиле «Advanced» GitHub: каждый переключатель дописывает
 * квалификатор в общий `q` (единый источник правды), а не в отдельный URL-параметр.
 * Тип списка — наш аналог фасета «Languages».
 */
export function AdvancedFacets({
  initialQ,
  tags,
  lang,
}: {
  initialQ: string
  tags: { tag: string; count: number }[]
  lang: Lang
}) {
  const router = useRouter()
  const sp = useSearchParams()
  const parsed = useMemo(() => parseSearchQuery(initialQ), [initialQ])
  const [advOpen, setAdvOpen] = useState(Boolean(parsed.by || parsed.minStars != null))
  const [author, setAuthor] = useState(parsed.by ?? '')
  const [minStars, setMinStars] = useState(parsed.minStars != null ? String(parsed.minStars) : '')

  /** Пересобрать q из изменённой структуры и перейти, сохранив сортировку. */
  function go(next: ParsedQuery) {
    const q = buildSearchQuery(next)
    const p = new URLSearchParams()
    if (q) p.set('q', q)
    const sort = sp.get('sort')
    if (sort) p.set('sort', sort)
    const s = p.toString()
    router.push(s ? `/explore?${s}` : '/explore')
  }

  const setType = (type: ParsedQuery['type']) => go({ ...parsed, type: parsed.type === type ? undefined : type })
  const toggleVerified = () => go({ ...parsed, verified: parsed.verified ? undefined : true })
  const toggleTag = (tag: string) =>
    go({ ...parsed, tags: parsed.tags.includes(tag) ? parsed.tags.filter((x) => x !== tag) : [...parsed.tags, tag] })
  const applyAdvanced = () => {
    const n = parseInt(minStars.replace(/[^\d]/g, ''), 10)
    go({ ...parsed, by: author.trim().replace(/^@/, '') || undefined, minStars: Number.isFinite(n) ? n : undefined })
  }

  const row = (active: boolean) =>
    `flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] ${
      active ? 'bg-surface font-semibold text-ink' : 'text-ink-2 hover:bg-surface hover:text-ink'
    }`

  return (
    <div>
      <div className="mb-4 text-[13px] font-semibold text-ink">{t('filters', lang)}</div>

      {/* Тип списка — аналог фасета «Languages» */}
      <div className="mb-4">
        <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{t('filterType', lang)}</div>
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

      {/* Проверенные */}
      <div className="mb-4">
        <button type="button" onClick={toggleVerified} className={row(Boolean(parsed.verified))}>
          <BadgeCheck size={14} className={`shrink-0 ${parsed.verified ? 'text-ok' : 'text-muted'}`} /> {t('filterVerified', lang)}
          {parsed.verified && <Check size={13} className="ml-auto text-accent" />}
        </button>
      </div>

      {/* Расширенные — Author / Min stars дописываются как by: / stars:>N */}
      <div className="mb-4">
        <button
          type="button"
          onClick={() => setAdvOpen((v) => !v)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-ink-2 hover:bg-surface hover:text-ink"
        >
          <SlidersHorizontal size={14} className="shrink-0 text-muted" /> {t('advancedFilters', lang)}
          <ChevronDown size={14} className={`ml-auto text-muted transition-transform ${advOpen ? 'rotate-180' : ''}`} />
        </button>
        {advOpen && (
          <div className="mt-2 flex flex-col gap-2 px-2">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted">{t('filterAuthor', lang)}</label>
            <input
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyAdvanced()}
              placeholder="handle"
              className="rounded-md border border-border bg-surface-2 px-2 py-1 text-[13px] text-ink outline-none focus:border-border-strong placeholder:text-muted"
            />
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted">{t('filterMinStars', lang)}</label>
            <input
              value={minStars}
              onChange={(e) => setMinStars(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyAdvanced()}
              inputMode="numeric"
              placeholder="100"
              className="rounded-md border border-border bg-surface-2 px-2 py-1 text-[13px] text-ink outline-none focus:border-border-strong placeholder:text-muted"
            />
            <button
              type="button"
              onClick={applyAdvanced}
              className="mt-1 rounded-md bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-primary-fg"
            >
              {t('filterApply', lang)}
            </button>
          </div>
        )}
      </div>

      {/* Теги — фасет со счётчиками; клик дописывает/убирает tag: */}
      <div>
        <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{t('tags', lang)}</div>
        <div className="flex flex-col gap-0.5">
          {tags.map((tg) => (
            <button key={tg.tag} type="button" onClick={() => toggleTag(tg.tag)} className={row(parsed.tags.includes(tg.tag))}>
              <span className="truncate">{tg.tag}</span>
              {parsed.tags.includes(tg.tag) ? (
                <Check size={13} className="ml-auto shrink-0 text-accent" />
              ) : (
                <span className="ml-auto shrink-0 font-mono text-[11px] text-muted">{tg.count}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Синтаксис поиска: квалификаторы прямо в строке (как на GitHub) */}
      <div className="mt-5 border-t border-border pt-3 text-[11px] leading-relaxed text-muted">
        <div className="mb-1 px-2 font-semibold text-ink-2">{t('searchTips', lang)}</div>
        <div className="px-2 font-mono">by:handle · tag:redis · is:verified · type:ordered · stars:&gt;100</div>
      </div>
    </div>
  )
}
