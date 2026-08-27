'use client'

import { type Lang } from '@/shared/i18n'
import { useState } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Input } from '@/shared/ui/input'
import { Field } from '@/shared/ui/Field'
import type { SearchMode, SearchSettings } from '@/shared/settings/search'
import { setSearchSettings } from './actions'
import { FormSaveBar } from '@/shared/ui/FormSaveBar'

export function SearchSettingsForm({ current, lang }: { current: SearchSettings; lang: Lang }) {
  const ru = lang === 'ru'
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
      <Field label={ru ? 'Режим' : 'Mode'}>
        <Select value={mode} onValueChange={(v) => setMode(v as SearchMode)}>
          <SelectTrigger className="w-panel">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                <span className="flex flex-col">
                  <span>{o.label}</span>
                  <span className="text-caption text-muted">{o.hint}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field
          label={ru ? 'Порог схожести (0–1)' : 'Similarity threshold (0–1)'}
          hint={ru ? 'Ниже порога результаты отбрасываются. 0 — без фильтра.' : 'Results below the score are dropped. 0 = no filter.'}
        >
          <Input
            type="number"
            name="minScore"
            step="any"
            min="0"
            max="1"
            defaultValue={current.minScore}
            disabled={!vector}
          />
        </Field>
        <Field
          label={ru ? 'Лимит результатов' : 'Result limit'}
          hint={ru ? 'Сколько семантических совпадений брать (top-K).' : 'How many semantic matches to take (top-K).'}
        >
          <Input
            type="number"
            name="limit"
            step="1"
            min="1"
            max="100"
            defaultValue={current.limit}
            disabled={!vector}
          />
        </Field>
      </div>

      <FormSaveBar lang={lang} />
    </form>
  )
}
