'use client'

import { List, ListOrdered } from 'lucide-react'
import { Tooltip } from '@/shared/ui/Tooltip'
import { t, type Lang } from '@/shared/i18n'

/** Компактный icon-тумблер типа списка (упорядоченный / без порядка). Видна только
 *  иконка, весь текст (название + пояснение) спрятан в тултип — компактно и одинаково
 *  везде: создание / редактирование / настройки. Radio name="ordered" (value
 *  ordered|unordered) — работает в обычной server-форме без клиентского состояния. */
export function ListTypeToggle({ ordered, lang }: { ordered: boolean; lang: Lang }) {
  const opts = [
    { value: 'ordered', on: ordered, Icon: ListOrdered, label: t('orderedLabel', lang), hint: t('orderedHint', lang) },
    { value: 'unordered', on: !ordered, Icon: List, label: t('unorderedLabel', lang), hint: t('unorderedHint', lang) },
  ] as const
  return (
    <div className="inline-flex rounded-md border border-border bg-surface-2 p-0.5">
      {opts.map(({ value, on, Icon, label, hint }) => (
        <Tooltip key={value} label={`${label} — ${hint}`}>
          <label
            aria-label={label}
            className="grid size-9 cursor-pointer place-items-center rounded-[0.3125rem] text-ink-2 transition-colors hover:text-ink has-[:checked]:bg-accent has-[:checked]:text-white"
          >
            <input type="radio" name="ordered" value={value} defaultChecked={on} className="sr-only" />
            <Icon size={16} />
          </label>
        </Tooltip>
      ))}
    </div>
  )
}
