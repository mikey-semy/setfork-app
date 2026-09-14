import Link from 'next/link'
import { t, type Lang } from '@/shared/i18n'
import { cardClass } from '@/shared/ui/card-style'

/**
 * Переключатель раздела «популярное»: списки или люди.
 *
 * ⚠️ Фильтра периода здесь БОЛЬШЕ НЕТ. Он давал одинаковую выдачу на всех значениях:
 * порядок считался как `звёзды за окно * 1000 + звёзды + форки`, и при нуле новых
 * звёзд первое слагаемое тождественно ноль. Замер прода 13.09.2026 — 2 звезды всего,
 * 1 за месяц, 0 форков. У соседней страницы `/trending/people` периода не было
 * изначально, и там это названо прямо: «показывать неработающий фильтр было бы
 * обманом». Теперь обе страницы раздела устроены одинаково.
 */
const seg = (on: boolean) =>
  `rounded px-3 py-1 font-medium ${on ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:text-ink'}`

export function TrendScope({ active, lang }: { active: 'lists' | 'people'; lang: Lang }) {
  // Обёртка сегментированного контрола — это вложенный блок: тон на ступень
  // глубже и мелкий радиус, ровно как inset-карточка. Отдельного рецепта не
  // заводим, иначе он и станет следующим «почти таким же».
  return (
    <div className={cardClass({ tone: 'inset', pad: 'xs', className: 'inline-flex text-body' })}>
      <Link href="/trending" className={seg(active === 'lists')}>
        {t('scopeLists', lang)}
      </Link>
      <Link href="/trending/people" className={seg(active === 'people')}>
        {t('scopePeople', lang)}
      </Link>
    </div>
  )
}

