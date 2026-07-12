// Product-домен («Shop this list»): подборка товаров/инструментов к списку —
// корзина рецепта, экипировка, стек для деплоя. Чистый домен (как quiz):
// типы и валидация нужны рендеру (shared/ui), редактору (features/library),
// редиректу /api/go и экспорту. Ссылки на веб-рендере идут через
// /api/go/<stepId>/p<idx> (журнал кликов + партнёрский тег из админки);
// в экспорте/MD — прямые URL (Amazon ToS: партнёрским ссылкам нельзя в
// офлайн-материалы).

export type ProductTier = 'budget' | 'mid' | 'premium'
export const PRODUCT_TIERS: ProductTier[] = ['budget', 'mid', 'premium']

export interface ProductItem {
  name: string
  url: string
  tier?: ProductTier // ценовой ярус («дешевле/средне/дороже»); нет — без бейджа
  note?: string // короткое пояснение («зачем это в наборе»)
}

export interface ProductBlockContent {
  bid?: string
  title?: string // заголовок подборки ('' — дефолтный «Shop this list»)
  items: ProductItem[]
}

/** Валидированные товары из content: мусор отбрасываем, но ИНДЕКСЫ исходного
 *  массива сохраняем (idx) — на них ссылается /api/go/<step>/p<idx>. */
export function productItems(content: Record<string, unknown> | null | undefined): (ProductItem & { idx: number })[] {
  const raw = Array.isArray(content?.items) ? (content.items as unknown[]) : []
  const out: (ProductItem & { idx: number })[] = []
  raw.forEach((r, idx) => {
    if (!r || typeof r !== 'object') return
    const { name, url, tier, note } = r as Record<string, unknown>
    if (typeof name !== 'string' || !name.trim() || typeof url !== 'string' || !url.trim()) return
    out.push({
      idx,
      name,
      url,
      ...(typeof tier === 'string' && (PRODUCT_TIERS as string[]).includes(tier) ? { tier: tier as ProductTier } : {}),
      ...(typeof note === 'string' && note.trim() ? { note } : {}),
    })
  })
  return out
}
