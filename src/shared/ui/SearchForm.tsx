'use client'

import { useState } from 'react'
import { SearchField } from '@/shared/ui/SearchField'

/**
 * Поиск в списке (задачи, предложения): контролируемый SearchField с кнопкой ×,
 * но отправка — нативной GET-формой (name="q"), так что работает и без JS.
 *
 * Живёт в shared, а не в features/issues: к задачам он не привязан ничем, а
 * второму потребителю пришлось бы либо тянуть чужую фичу (нарушение границ),
 * либо завести копию.
 */
export function SearchForm({ initial, placeholder }: { initial: string; placeholder: string }) {
  const [q, setQ] = useState(initial)
  return <SearchField name="q" value={q} onValueChange={setQ} placeholder={placeholder} />
}
