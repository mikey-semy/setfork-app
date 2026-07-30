'use client'

import { useState } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import type { SearchMode, SearchSettings } from '@/shared/settings/search'
import { setSearchSettings } from './actions'
import { FormSaveBar } from '@/features/settings/FormSaveBar'

const field = 'w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-[14px] text-ink outline-hidden focus:border-border-strong'
const lbl = 'mb-1.5 block text-[12.5px] font-semibold text-ink-2'

export function SearchSettingsForm({ current, ru }: { current: SearchSettings; ru: boolean }) {
  const [mode, setMode] = useState<SearchMode>(current.mode)
  const vector = mode !== 'keyword'

  const options: { value: SearchMode; label: string; hint: string }[] = [
    { value: 'keyword', label: ru ? 'По ключевым словам' : 'Keyword', hint: ru ? 'ILIKE по названию/описанию' : 'ILIKE over title/desc' },
    { value: 'semantic', label: ru ? 'По смыслу (RAG)' : 'Semantic (RAG)', hint: ru ? 'вектор pgvector' : 'pgvector cosine' },
    { value: 'hybrid', label: ru ? 'Гибридный' : 'Hybrid', hint: ru ? 'вектор + добор по словам' : 'vector + keyword' },
  ]

  return (
    <form action={setSearchSettings} className="flex flex-col gap-5">
      <input type="hidden" name="mode" value={mode} />
      <div>
        <label className={lbl}>{ru ? 'Режим' : 'Mode'}</label>
        <Select value={mode} onValueChange={(v) => setMode(v as SearchMode)}>
          <SelectTrigger className="w-[280px]">
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
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={lbl}>{ru ? 'Порог схожести (0–1)' : 'Similarity threshold (0–1)'}</label>
          <input
            type="number"
            name="minScore"
            step="any"
            min="0"
            max="1"
            defaultValue={current.minScore}
            disabled={!vector}
            className={`${field} disabled:opacity-50`}
          />
          <p className="mt-1 text-[12px] text-muted">
            {ru ? 'Ниже порога результаты отбрасываются. 0 — без фильтра.' : 'Results below the score are dropped. 0 = no filter.'}
          </p>
        </div>
        <div>
          <label className={lbl}>{ru ? 'Лимит результатов' : 'Result limit'}</label>
          <input
            type="number"
            name="limit"
            step="1"
            min="1"
            max="100"
            defaultValue={current.limit}
            disabled={!vector}
            className={`${field} disabled:opacity-50`}
          />
          <p className="mt-1 text-[12px] text-muted">
            {ru ? 'Сколько семантических совпадений брать (top-K).' : 'How many semantic matches to take (top-K).'}
          </p>
        </div>
      </div>

      <FormSaveBar ru={ru} />
    </form>
  )
}
