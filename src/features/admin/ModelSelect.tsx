'use client'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'

/** Значение-пустышка для «нет модели» (Radix не разрешает пустое value у Item). */
export const NONE = '__none__'

export function ModelSelect({
  name,
  defaultValue,
  options,
  placeholder,
  allowEmpty,
}: {
  name: string
  defaultValue?: string
  options: string[]
  placeholder?: string
  allowEmpty?: boolean
}) {
  return (
    <Select name={name} defaultValue={defaultValue || (allowEmpty ? NONE : undefined)}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowEmpty && <SelectItem value={NONE}>—</SelectItem>}
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
