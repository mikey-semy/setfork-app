import Link from 'next/link'
import { t, type Lang } from '@/shared/i18n'
import type { TrendRange } from '@/features/library/queries'

/**
 * Управление разделом «популярное»: переключатель списки/люди и фильтр периода.
 *
 * Живут вместе, потому что меняются вместе, и общие для двух страниц раздела —
 * иначе набор периодов или подписи разъехались бы между `/trending` и
 * `/trending/people`.
 */
const RANGES: TrendRange[] = ['day', 'week', 'month', 'all']

/** Период — единственный параметр раздела; всё остальное живёт в адресе. */
export function readRange(raw: string | undefined): TrendRange {
  return RANGES.includes(raw as TrendRange) ? (raw as TrendRange) : 'week'
}

const RANGE_LABEL: Record<TrendRange, { en: string; ru: string }> = {
  day: { en: 'Today', ru: 'Сегодня' },
  week: { en: 'This week', ru: 'Неделя' },
  month: { en: 'This month', ru: 'Месяц' },
  all: { en: 'All time', ru: 'Всё время' },
}

const seg = (on: boolean) =>
  `rounded px-3 py-1 font-medium ${on ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:text-ink'}`

export function TrendScope({ active, range, lang }: { active: 'lists' | 'people'; range: TrendRange; lang: Lang }) {
  // Период переносим только на списки: у людей его нет, и тащить туда `?range=`
  // значило бы показывать в адресе параметр, который ни на что не влияет.
  return (
    <div className="inline-flex rounded-md border border-border p-0.5 text-[0.8125rem]">
      <Link href={range === 'week' ? '/trending' : `/trending?range=${range}`} className={seg(active === 'lists')}>
        {t('scopeLists', lang)}
      </Link>
      <Link href="/trending/people" className={seg(active === 'people')}>
        {t('scopePeople', lang)}
      </Link>
    </div>
  )
}

export function TrendRanges({ active, lang }: { active: TrendRange; lang: Lang }) {
  return (
    <div className="inline-flex flex-wrap gap-1 text-[0.78125rem]">
      {RANGES.map((r) => (
        <Link
          key={r}
          // Неделя — состояние по умолчанию, и адрес у неё чистый: `/trending`
          // вместо `/trending?range=week`. Один и тот же вид не должен иметь двух
          // разных ссылок.
          href={r === 'week' ? '/trending' : `/trending?range=${r}`}
          className={`rounded-md px-2.5 py-1 ${r === active ? 'bg-surface-2 font-medium text-ink' : 'text-ink-2 hover:text-ink'}`}
        >
          {RANGE_LABEL[r][lang === 'ru' ? 'ru' : 'en']}
        </Link>
      ))}
    </div>
  )
}
