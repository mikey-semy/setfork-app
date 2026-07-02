'use client'

import { useState, useTransition } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import type { SearchMode } from '@/shared/settings/search'
import { setSearchMode } from './actions'

export function SearchModeSelect({ current, ru }: { current: SearchMode; ru: boolean }) {
  const [value, setValue] = useState<SearchMode>(current)
  const [pending, start] = useTransition()
  const [saved, setSaved] = useState(false)

  const options: { value: SearchMode; label: string; hint: string }[] = [
    { value: 'keyword', label: ru ? 'По ключевым словам' : 'Keyword', hint: ru ? 'ILIKE по названию/описанию' : 'ILIKE over title/desc' },
    { value: 'semantic', label: ru ? 'По смыслу (RAG)' : 'Semantic (RAG)', hint: ru ? 'вектор pgvector' : 'pgvector cosine' },
    { value: 'hybrid', label: ru ? 'Гибридный' : 'Hybrid', hint: ru ? 'вектор + добор по словам' : 'vector + keyword' },
  ]

  const onChange = (v: string) => {
    const mode = v as SearchMode
    setValue(mode)
    setSaved(false)
    start(async () => {
      await setSearchMode(mode)
      setSaved(true)
    })
  }

  return (
    <div className="flex items-center gap-3">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-[260px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              <span className="flex flex-col">
                <span>{o.label}</span>
                <span className="text-[11px] text-muted">{o.hint}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {pending ? (
        <Loader2 size={15} className="animate-spin text-muted" />
      ) : saved ? (
        <span className="inline-flex items-center gap-1 text-[12.5px] text-[var(--ok)]">
          <Check size={14} /> {ru ? 'Сохранено' : 'Saved'}
        </span>
      ) : null}
    </div>
  )
}
