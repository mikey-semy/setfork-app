'use client'

import { useState } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'

/** Выбор версии для релиза: Radix Select + hidden input для нативного сабмита формы. */
export function VersionSelect({
  versions,
  current,
  currentLabel,
}: {
  versions: number[]
  current: number
  currentLabel: string
}) {
  const [v, setV] = useState(String(current))
  return (
    <>
      <input type="hidden" name="version" value={v} />
      <Select value={v} onValueChange={setV}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {versions.map((n) => (
            <SelectItem key={n} value={String(n)}>
              v{n}
              {n === current ? ` ${currentLabel}` : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  )
}
