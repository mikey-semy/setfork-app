import { ExternalLink, ShoppingCart } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { SafeLink } from '@/shared/ui/SafeLink'
import type { ProductTier } from '@/core'

// Рендер product-блока («Shop this list») — общий для страницы списка и прогона
// (без 'use client' и server-only: чистая разметка, работает в обоих мирах).
// href — трекинговый /api/go/<step>/p<idx>, когда клики включены в админке;
// иначе прямой url.
export interface ProductLinkVM {
  name: string
  url: string
  href?: string
  tier?: ProductTier
  note?: string
  idx?: number // исходный индекс в content.items (стабильный key; битый товар в середине его не сдвигает)
}

const TIER_CLS: Record<ProductTier, string> = {
  budget: 'border-ok/40 bg-ok/10 text-ok',
  mid: 'border-warn/40 bg-warn/10 text-warn',
  premium: 'border-accent/40 bg-accent-soft text-accent',
}

function tierLabel(tier: ProductTier, lang: Lang): string {
  if (tier === 'budget') return t('productTierBudget', lang)
  if (tier === 'mid') return t('productTierMid', lang)
  return t('productTierPremium', lang)
}

export function ProductBlock({ title, items, lang }: { title?: string; items: ProductLinkVM[]; lang: Lang }) {
  if (items.length === 0) return null
  return (
    <div className="break-inside-avoid rounded-lg border border-border bg-surface p-4">
      <div className="mb-2.5 flex items-center gap-1.5 text-body font-semibold text-ink">
        <ShoppingCart size={14} className="shrink-0 text-muted" /> {title?.trim() || t('productBlockTitle', lang)}
      </div>
      <ul className="flex flex-col gap-2">
        {items.map((p, i) => (
          <li key={p.idx ?? `i${i}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body">
            {p.tier && (
              <span className={`shrink-0 rounded-md border px-1.5 py-px text-caption font-medium uppercase tracking-wide ${TIER_CLS[p.tier]}`}>
                {tierLabel(p.tier, lang)}
              </span>
            )}
            <SafeLink
              href={p.href ?? p.url}
              rel="nofollow noreferrer"
              className="inline-flex min-w-0 items-center gap-1 font-medium text-accent hover:underline"
            >
              <span className="truncate">{p.name}</span> <ExternalLink size={11} className="shrink-0" />
            </SafeLink>
            {p.note && <span className="min-w-0 text-body-sm text-muted">— {p.note}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
