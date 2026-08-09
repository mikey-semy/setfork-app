'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/shared/ui/button'
import { FloatingInput } from '@/shared/ui/FloatingInput'
import { OverlayPanel } from '@/shared/ui/OverlayPanel'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { t, type Lang, type TKey } from '@/shared/i18n'
import { PRODUCT_TIERS, type ProductTier } from '../blocks'
import type { EditorProduct } from '../editor'

/** Ярус товара → ключ подписи; «без яруса» задаётся отдельным значением списка. */
const TIER_LABEL: Record<ProductTier, TKey> = { budget: 'productTierBudget', mid: 'productTierMid', premium: 'productTierPremium' }
const NO_TIER = '__none__'

export const EMPTY_PRODUCT: EditorProduct = { name: '', url: '', tier: '', note: '' }

/**
 * Товар правится В ОКНЕ — так же, как ссылка (требование владельца 09.08.2026:
 * «во всех редакторах каждый элемент одинаковый, а не уродливый монстр»).
 *
 * До этого товар был рядом из четырёх полей и корзины: на телефоне ряд ломался в
 * столбик высотой в пол-экрана, а «https://…» занимал место, хотя нужен один раз
 * при вводе. Окно то же самое, что у ссылки, и поля те же — FloatingInput.
 */
export function ProductDialog({
  open,
  initial,
  onSave,
  onClose,
  lang,
}: {
  open: boolean
  /** Значение для правки; пусто — добавление нового товара. */
  initial?: EditorProduct
  onSave: (v: EditorProduct) => void
  onClose: () => void
  lang: Lang
}) {
  const [draft, setDraft] = useState<EditorProduct>(initial ?? EMPTY_PRODUCT)

  // Окно переиспользуется для разных товаров: при открытии подставляем тот, что
  // правят сейчас, иначе в форме остались бы поля от прошлого.
  useEffect(() => {
    if (open) setDraft(initial ?? EMPTY_PRODUCT)
  }, [open, initial])

  const patch = (p: Partial<EditorProduct>) => setDraft((d) => ({ ...d, ...p }))

  function save() {
    const v: EditorProduct = { ...draft, name: draft.name.trim(), url: draft.url.trim(), note: draft.note.trim() }
    if (!v.name && !v.url) return
    onSave(v)
    onClose()
  }

  return (
    <OverlayPanel
      open={open}
      onClose={onClose}
      title={t('productDialogTitle', lang)}
      width={380}
      closeLabel={t('close', lang)}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('cancel', lang)}
          </Button>
          <Button variant="primary" onClick={save} disabled={!draft.name.trim() && !draft.url.trim()}>
            {initial ? t('saveChanges', lang) : t('productAdd', lang)}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <FloatingInput label={t('productNamePh', lang)} value={draft.name} onChange={(v) => patch({ name: v })} autoFocus />
        <FloatingInput
          label={t('editor.linkUrl', lang)}
          value={draft.url}
          onChange={(v) => patch({ url: v })}
          inputClassName="font-mono"
          inputMode="url"
        />
        <Select value={draft.tier || NO_TIER} onValueChange={(v) => patch({ tier: (v === NO_TIER ? '' : v) as EditorProduct['tier'] })}>
          <SelectTrigger aria-label={t('productTierNone', lang)}>
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
        <FloatingInput
          label={t('productNotePh', lang)}
          value={draft.note}
          onChange={(v) => patch({ note: v })}
          // Enter в последнем поле — как «Добавить»: руки не уходят с клавиатуры.
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              save()
            }
          }}
        />
      </div>
    </OverlayPanel>
  )
}
