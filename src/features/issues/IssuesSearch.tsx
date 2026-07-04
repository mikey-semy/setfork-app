'use client'

import { useState } from 'react'
import { SearchField } from '@/shared/ui/SearchField'

/** Поиск issues: контролируемый SearchField с кнопкой ×, но отправка — нативной
    GET-формой (name="q"), так что работает и без JS. */
export function IssuesSearch({ initial, placeholder }: { initial: string; placeholder: string }) {
  const [q, setQ] = useState(initial)
  return <SearchField name="q" value={q} onValueChange={setQ} placeholder={placeholder} />
}
