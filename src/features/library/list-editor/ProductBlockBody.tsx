'use client'

import { Trash2 } from 'lucide-react'
import { TEXT, iconSizeFor } from '@/shared/ui/control'
import { IconButton } from '@/shared/ui/IconButton'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { t, type Lang, type TKey } from '@/shared/i18n'
import { PRODUCT_TIERS, type ProductTier } from '../blocks'
import type { EditorProduct } from '../editor'
import { AddLink } from './block-fields'

/** Ярус товара → ключ подписи; «без яруса» задаётся отдельным значением списка. */
const TIER_LABEL: Record<ProductTier, TKey> = { budget: 'productTierBudget', mid: 'productTierMid', premium: 'productTierPremium' }
const NO_TIER = '__none__'

/** Product-блок: заголовок подборки и строки товаров (имя, ссылка, ярус, пометка). */
export function ProductBlockBody({
  products,
  caption,
  onProducts,
  onCaption,
  lang,
}: {
  products: EditorProduct[]
  caption: string
  onProducts: (p: EditorProduct[]) => void
  onCaption: (c: string) => void
  lang: Lang
}) {
  const patchRow = (i: number, p: Partial<EditorProduct>) => onProducts(products.map((x, xi) => (xi === i ? { ...x, ...p } : x)))
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3">
      <Input aria-label={t('productCaptionPh', lang)} placeholder={t('productCaptionPh', lang)} value={caption} onChange={(e) => onCaption(e.target.value)} />
      {products.map((p, pi) => (
        <div key={pi} className="flex flex-col gap-1.5 rounded-md border border-border bg-surface p-2 sm:flex-row sm:items-center">
          <Input
            className="sm:max-w-[11.25rem]"
            aria-label={t('productNamePh', lang)}
            placeholder={t('productNamePh', lang)}
            value={p.name}
            onChange={(e) => patchRow(pi, { name: e.target.value })}
          />
          <Input className="font-mono" aria-label="URL" placeholder="https://…" value={p.url} onChange={(e) => patchRow(pi, { url: e.target.value })} />
          <Select value={p.tier || NO_TIER} onValueChange={(v) => patchRow(pi, { tier: (v === NO_TIER ? '' : v) as EditorProduct['tier'] })}>
            <SelectTrigger className="sm:max-w-[8.125rem]" aria-label={t('productTierNone', lang)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_TIER}>{t('productTierNone', lang)}</SelectItem>
              {PRODUCT_TIERS.map((tier) => (
                <SelectItem key={tier} value={tier}>
                  {t(TIER_LABEL[tier], lang)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            aria-label={t('productNotePh', lang)}
            placeholder={t('productNotePh', lang)}
            value={p.note}
            onChange={(e) => patchRow(pi, { note: e.target.value })}
          />
          <IconButton
            size="sm"
            variant="danger"
            onClick={() => onProducts(products.filter((_, xi) => xi !== pi))}
            label={t('productRemove', lang)}
            className="self-end sm:self-auto"
          >
            <Trash2 size={iconSizeFor('sm')} />
          </IconButton>
        </div>
      ))}
      <div className={`${TEXT.bodySm}`}>
        <AddLink onClick={() => onProducts([...products, { name: '', url: '', tier: '', note: '' }])}>{t('productAdd', lang)}</AddLink>
      </div>
    </div>
  )
}
