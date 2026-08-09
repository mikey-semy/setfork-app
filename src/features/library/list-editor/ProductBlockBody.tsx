'use client'

import { Package } from 'lucide-react'
import { ChipList } from '@/shared/ui/ChipList'
import { iconSizeFor } from '@/shared/ui/control'
import { Input } from '@/shared/ui/input'
import { t, type Lang } from '@/shared/i18n'
import type { EditorProduct } from '../editor'
import { AddLink } from './block-fields'
import { linkHost } from './link-url'
import { ProductDialog } from './ProductDialog'

/**
 * Product-блок: заголовок подборки и товары — чипами, правка в окне.
 *
 * Товары устроены ровно как ссылки: тот же каркас `ChipList`, та же кнопка
 * добавления `AddLink`, то же окно на `OverlayPanel`. Второй копии логики здесь
 * нет — это и требовал владелец («унифицировать каждый элемент во всех
 * редакторах», 09.08.2026).
 */
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
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3">
      <Input aria-label={t('productCaptionPh', lang)} placeholder={t('productCaptionPh', lang)} value={caption} onChange={(e) => onCaption(e.target.value)} />
      <ChipList
        items={products}
        onChange={onProducts}
        removeLabel={t('productRemove', lang)}
        itemKey={(p) => `${p.name}|${p.url}`}
        editLabel={t('productEdit', lang)}
        chipTitle={(p) => [p.name, p.url].filter(Boolean).join(' — ') || t('productNamePh', lang)}
        chip={(p) => (
          <>
            <Package size={iconSizeFor('xs')} className="shrink-0 text-muted" />
            <span className="max-w-[10rem] truncate">{p.name || linkHost(p.url)}</span>
            {p.name && p.url ? <span className="max-w-[8rem] truncate font-mono text-muted">{linkHost(p.url)}</span> : null}
          </>
        )}
        addButton={(open) => <AddLink onClick={open}>{t('productAdd', lang)}</AddLink>}
        dialog={({ open, item, save, close }) => (
          <ProductDialog open={open} initial={item} onSave={save} onClose={close} lang={lang} />
        )}
      />
    </div>
  )
}
