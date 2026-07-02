'use client'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'

/** Значение-пустышка для «нет модели» (Radix не разрешает пустое value у Item). */
export const NONE = '__none__'

/** id — идентификатор модели (моно), price — уже готовая строка цены, priceClass —
 *  цветовой класс (зелёный дёшево / жёлтый средне / красный дорого). */
export type Option = { value: string; id: string; price?: string; priceClass?: string }

export function ModelSelect({
  name,
  defaultValue,
  options,
  placeholder,
  allowEmpty,
}: {
  name: string
  defaultValue?: string
  options: Option[]
  placeholder?: string
  allowEmpty?: boolean
}) {
  return (
    <Select name={name} defaultValue={defaultValue || (allowEmpty ? NONE : undefined)}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {allowEmpty && <SelectItem value={NONE}>—</SelectItem>}
        {options.map((o) => (
          <SelectItem
            key={o.value}
            value={o.value}
            trailing={o.price ? <span className={`tabular-nums text-[11.5px] ${o.priceClass ?? ''}`}>{o.price}</span> : undefined}
          >
            <span className="font-mono text-[12px]">{o.id}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
